import jwt from 'jsonwebtoken';
import db from '../../db/connection.js';
import { getJwtSecret } from '../../config/runtime.js';
import { findActiveStaffSession, touchStaffSession } from '../../services/staffSessions.js';

function authFailure(res, statusCode, message, reason) {
  return res.status(statusCode).json({ error: message, reason });
}

export function isRestaurantAccessAllowed(status) {
  return status === 'active';
}

export const authenticateToken = async (req, res, next) => {
  const authHeader = req.headers['authorization'];
  const token = authHeader && authHeader.split(' ')[1];

  if (!token) {
    return authFailure(res, 401, 'Access token missing or invalid', 'session_expired');
  }

  const jwtSecret = getJwtSecret();
  if (!jwtSecret && process.env.NODE_ENV === 'production') {
    return res.status(500).json({ error: 'Server JWT configuration is missing' });
  }

  jwt.verify(token, jwtSecret || 'rms-dev-secret-change-in-prod', async (err, user) => {
    if (err) {
      return authFailure(res, err.name === 'TokenExpiredError' ? 401 : 403, 'Token expired or invalid', 'session_expired');
    }

    try {
      if (user.role === 'platform_admin') {
        const [admin] = await db('platform_admins').where('id', user.id).select('is_active').limit(1);
        if (!admin || !admin.is_active) {
          return authFailure(res, 403, 'Account is no longer active', 'account_revoked');
        }
      } else if (['restaurant_admin', 'waiter', 'chef'].includes(user.role)) {
        const session = await findActiveStaffSession(token);
        if (!session) {
          return authFailure(res, 401, 'Staff session is expired or no longer active', 'session_expired');
        }

        const [staff] = await db('staff')
          .where('staff.id', user.id)
          .andWhere('staff.deleted_at', null)
          .andWhere('staff.access', 'active')
          .join('restaurants', 'staff.restaurant_id', 'restaurants.id')
          .andWhere('restaurants.status', 'active')
          .select('staff.id')
          .limit(1);

        if (!staff) {
          const [revokedStaff] = await db('staff')
            .where('staff.id', user.id)
            .andWhere('staff.deleted_at', null)
            .select('staff.access', 'staff.restaurant_id')
            .limit(1);

          if (revokedStaff && revokedStaff.access === 'revoked') {
            return authFailure(res, 403, 'Staff account has been revoked', 'account_revoked');
          }

          return authFailure(res, 403, 'Restaurant access has been suspended', 'restaurant_suspended');
        }

        await touchStaffSession(session);
        req.staffSession = session;
      } else if (user.role === 'customer') {
        const [customer] = await db('customers').where('id', user.id).select('id').limit(1);
        if (!customer) {
          return authFailure(res, 403, 'Account is no longer active', 'account_revoked');
        }
      }

      req.user = user;
      next();
    } catch (error) {
      next(error);
    }
  });
};
