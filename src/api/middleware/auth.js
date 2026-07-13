import jwt from 'jsonwebtoken';
import db from '../../db/connection.js';

export const authenticateToken = async (req, res, next) => {
  const authHeader = req.headers['authorization'];
  const token = authHeader && authHeader.split(' ')[1];

  if (!token) {
    return res.status(401).json({ error: 'Access token missing or invalid' });
  }

  if (!process.env.JWT_SECRET && process.env.NODE_ENV === 'production') {
    return res.status(500).json({ error: 'Server JWT configuration is missing' });
  }

  jwt.verify(token, process.env.JWT_SECRET || 'rms-dev-secret-change-in-prod', async (err, user) => {
    if (err) {
      return res.status(403).json({ error: 'Token expired or invalid' });
    }

    // Re-check account status from database
    if (user.role === 'platform_admin') {
      // Verify platform admin is still active
      const [admin] = await db('platform_admins').where('id', user.id).select('is_active').limit(1);
      if (!admin || !admin.is_active) {
        return res.status(403).json({ error: 'Account is no longer active' });
      }
    } else if (['restaurant_admin', 'waiter', 'chef'].includes(user.role)) {
      // Verify staff member is not deleted, revoked, or in suspended restaurant
      const [staff] = await db('staff')
        .where('staff.id', user.id)
        .andWhere('staff.deleted_at', null)
        .andWhere('staff.access', 'active')
        .join('restaurants', 'staff.restaurant_id', 'restaurants.id')
        .andWhere('restaurants.status', 'active')
        .select('staff.id')
        .limit(1);

      if (!staff) {
        return res.status(403).json({ error: 'Account is no longer active or has been revoked' });
      }
    } else if (user.role === 'customer') {
      // Optional: verify customer is not deleted
      const [customer] = await db('customers').where('id', user.id).select('id').limit(1);
      if (!customer) {
        return res.status(403).json({ error: 'Account is no longer active' });
      }
    }

    req.user = user;
    next();
  });
};
