import bcrypt from 'bcrypt';
import { randomUUID } from 'crypto';
import db from '../../db/connection.js';
import { signToken, signRefreshToken, verifyToken } from '../../services/jwt.js';
import {
  createStaffSession,
  rotateStaffSessionToken,
  logoutStaffSession,
  logoutStaffSessionByRefreshToken,
  findActiveStaffSessionByRefreshToken,
} from '../../services/staffSessions.js';
import {
  MAX_FAILED_LOGINS,
  isStaffLocked,
  recordFailedLogin,
  resetFailedLoginAttempts,
} from '../../services/staffLoginSecurity.js';

function permissionsForStaffRole(role) {
  if (role === 'restaurant_admin') {
    return ['menu:read', 'menu:write', 'order:read', 'order:update', 'session:read', 'session:write', 'staff:read', 'staff:write'];
  }
  if (role === 'waiter') {
    return ['menu:read', 'order:read', 'order:update', 'session:read', 'session:write'];
  }
  return ['menu:read', 'order:read', 'order:update'];
}

async function issueStaffSession(staff, req) {
  const sessionId = randomUUID();
  const userPayload = {
    id: staff.id,
    name: staff.name,
    email: staff.email,
    role: staff.role,
    restaurantId: staff.restaurant_id,
    restaurantSlug: staff.restaurant_slug,
    permissions: permissionsForStaffRole(staff.role),
    staffSessionId: sessionId,
  };
  const token = signToken(userPayload);
  const refreshToken = signRefreshToken(userPayload);
  await db('staff').where({ id: staff.id }).update({ last_login_at: new Date() });
  await createStaffSession({ staffId: staff.id, token, refreshToken, req, sessionId });
  return { token, refreshToken, user: userPayload };
}

function buildFailedLoginPayload(failureState, message = 'Invalid email or password') {
  return {
    error: message,
    code: failureState.isLocked ? 'ACCOUNT_LOCKED' : 'INVALID_CREDENTIALS',
    failedAttempts: failureState.failedAttempts,
    remainingAttempts: failureState.remainingAttempts,
    ...(failureState.warning ? { warning: failureState.warning } : {}),
    ...(failureState.lockoutUntil ? { lockoutUntil: failureState.lockoutUntil.toISOString() } : {}),
  };
}

export const customerLogin = async (req, res, next) => {
  try {
    const { email, password } = req.body;
    const [customer] = await db('customers').where({ email }).limit(1);

    if (!customer || !customer.password_hash) {
      return res.status(401).json({ error: 'Invalid email or password' });
    }

    const isValid = await bcrypt.compare(password, customer.password_hash);

    if (!isValid) {
      return res.status(401).json({ error: 'Invalid email or password' });
    }

    const userPayload = {
      id: customer.id,
      name: customer.name,
      role: 'customer',
      permissions: ['menu:read', 'order:create', 'order:read', 'session:read']
    };

    const token = signToken(userPayload);
    const refreshToken = signRefreshToken(userPayload);

    res.json({ token, refreshToken, user: userPayload });
  } catch (error) {
    next(error);
  }
};

export const customerRegister = async (req, res, next) => {
  try {
    const { email, password, name, phone } = req.body;

    const [existing] = await db('customers')
      .where({ email })
      .orWhere({ phone })
      .limit(1);

    if (existing) {
      return res.status(409).json({ error: 'Email or phone already registered' });
    }

    const password_hash = await bcrypt.hash(password, 10);
    const { v4: uuidv4 } = await import('uuid');
    const newId = uuidv4();

    await db('customers').insert({
      id: newId,
      email,
      phone,
      name,
      password_hash,
      is_registered: 1
    });

    const userPayload = {
      id: newId,
      name,
      role: 'customer',
      permissions: ['menu:read', 'order:create', 'order:read', 'session:read']
    };

    const token = signToken(userPayload);
    const refreshToken = signRefreshToken(userPayload);

    res.status(201).json({ token, refreshToken, user: userPayload });
  } catch (error) {
    next(error);
  }
};

export const staffLogin = async (req, res, next) => {
  try {
    const { email, password } = req.body;

    const [staff] = await db('staff')
      .where('staff.email', email)
      .andWhere('staff.deleted_at', null)
      .join('restaurants', 'staff.restaurant_id', 'restaurants.id')
      .select('staff.*', 'restaurants.slug as restaurant_slug', 'restaurants.status as restaurant_status')
      .limit(1);

    if (!staff) {
      return res.status(401).json({ error: 'Invalid email or password' });
    }
    if (staff.access === 'revoked') {
      return res.status(403).json({ error: 'This staff account is not available for login', code: 'ACCOUNT_REVOKED' });
    }

    if (await isStaffLocked(staff.id)) {
      return res.status(423).json({
        error: 'This account has been temporarily locked due to multiple failed login attempts.',
        code: 'ACCOUNT_LOCKED',
        failedAttempts: MAX_FAILED_LOGINS,
        remainingAttempts: 0,
      });
    }

    const isValid = await bcrypt.compare(password, staff.password_hash);
    if (!isValid) {
      const failureState = await recordFailedLogin(staff.id);
      if (failureState.isLocked) {
        return res.status(423).json(buildFailedLoginPayload({
          ...failureState,
          isLocked: true,
        }, 'This account has been temporarily locked due to multiple failed login attempts.'));
      }

      return res.status(401).json(buildFailedLoginPayload(failureState));
    }

    await resetFailedLoginAttempts(staff.id);
    if (staff.restaurant_status === 'suspended') {
      return res.status(403).json({ error: 'Restaurant access is suspended', code: 'RESTAURANT_SUSPENDED', reason: 'restaurant_suspended' });
    }

    res.json(await issueStaffSession(staff, req));
  } catch (error) {
    next(error);
  }
};

export const platformAdminLogin = async (req, res, next) => {
  try {
    const { email, password } = req.body;

    const [admin] = await db('platform_admins').where('email', email).limit(1);

    if (!admin || !admin.is_active) {
      return res.status(401).json({ error: 'Invalid email or password' });
    }

    const isValid = await bcrypt.compare(password, admin.password_hash);
    if (!isValid) {
      return res.status(401).json({ error: 'Invalid email or password' });
    }

    const userPayload = {
      id: admin.id,
      name: admin.name,
      email: admin.email,
      role: 'platform_admin',
      permissions: ['platform:read', 'platform:write']
    };

    const token = signToken(userPayload);
    const refreshToken = signRefreshToken(userPayload);

    res.json({ token, refreshToken, user: userPayload });
  } catch (error) {
    next(error);
  }
};

export const consoleLogin = async (req, res, next) => {
  try {
    const { email, password } = req.body;

    const [staff] = await db('staff')
      .where('staff.email', email)
      .andWhere('staff.deleted_at', null)
      .join('restaurants', 'staff.restaurant_id', 'restaurants.id')
      .select('staff.*', 'restaurants.slug as restaurant_slug', 'restaurants.status as restaurant_status')
      .limit(1);

    if (staff && staff.access === 'revoked') {
      return res.status(403).json({ error: 'This staff account is not available for login', code: 'ACCOUNT_REVOKED', reason: 'account_revoked' });
    }

    if (staff) {
      if (await isStaffLocked(staff.id)) {
        return res.status(423).json({
          error: 'This account has been temporarily locked due to multiple failed login attempts.',
          code: 'ACCOUNT_LOCKED',
          failedAttempts: MAX_FAILED_LOGINS,
          remainingAttempts: 0,
          reason: 'account_locked',
        });
      }

      const isValid = await bcrypt.compare(password, staff.password_hash);
      if (isValid) {
        await resetFailedLoginAttempts(staff.id);
        if (staff.restaurant_status === 'suspended') {
          return res.status(403).json({ error: 'Restaurant access is suspended', code: 'RESTAURANT_SUSPENDED', reason: 'restaurant_suspended' });
        }
        return res.json(await issueStaffSession(staff, req));
      }

      const failureState = await recordFailedLogin(staff.id);
      if (failureState.isLocked) {
        return res.status(423).json(buildFailedLoginPayload({
          ...failureState,
          isLocked: true,
        }, 'This account has been temporarily locked due to multiple failed login attempts.'));
      }

      return res.status(401).json(buildFailedLoginPayload(failureState));
    }

    const [admin] = await db('platform_admins').where('email', email).limit(1);

    if (admin && admin.is_active) {
      const isValid = await bcrypt.compare(password, admin.password_hash);
      if (isValid) {
        const userPayload = {
          id: admin.id,
          name: admin.name,
          email: admin.email,
          role: 'platform_admin',
          permissions: ['platform:read', 'platform:write']
        };

        const token = signToken(userPayload);
        const refreshToken = signRefreshToken(userPayload);

        return res.json({ token, refreshToken, user: userPayload });
      }
    }

    return res.status(401).json({ error: 'Invalid email or password', code: 'INVALID_CREDENTIALS', failedAttempts: 0, remainingAttempts: MAX_FAILED_LOGINS });
  } catch (error) {
    next(error);
  }
};

export const refreshToken = async (req, res, next) => {
  try {
    const { refreshToken: token } = req.body;

    if (!token) return res.status(401).json({ error: 'No token', reason: 'session_expired' });

    try {
      const decoded = verifyToken(token);
      const payload = {
        id: decoded.id,
        name: decoded.name,
        email: decoded.email,
        role: decoded.role,
        permissions: decoded.permissions,
        restaurantId: decoded.restaurantId,
        restaurantSlug: decoded.restaurantSlug,
        staffSessionId: decoded.staffSessionId,
      };

      const newToken = signToken(payload);
      const newRefreshToken = signRefreshToken(payload);

      if (['restaurant_admin', 'waiter', 'chef'].includes(decoded.role)) {
        const session = await findActiveStaffSessionByRefreshToken(token);
        if (!decoded.staffSessionId || !session || !(await rotateStaffSessionToken(decoded.staffSessionId, newToken, newRefreshToken))) {
          return res.status(401).json({ error: 'Staff session is expired or no longer active', reason: 'session_expired' });
        }
      }

      res.json({ token: newToken, refreshToken: newRefreshToken, user: payload });
    } catch (e) {
      res.status(401).json({ error: 'Invalid refresh token', reason: 'session_expired' });
    }
  } catch (error) {
    next(error);
  }
};

export const logout = async (req, res, next) => {
  try {
    const authHeader = req.headers.authorization;
    const token = authHeader?.startsWith('Bearer ') ? authHeader.slice(7) : null;
    const refreshTokenFromBody = req.body?.refreshToken || req.headers['x-refresh-token'];

    if (token && req.user?.role && ['restaurant_admin', 'waiter', 'chef'].includes(req.user.role)) {
      await logoutStaffSession(token);
    }

    if (refreshTokenFromBody && req.user?.role && ['restaurant_admin', 'waiter', 'chef'].includes(req.user.role)) {
      await logoutStaffSessionByRefreshToken(refreshTokenFromBody);
    }

    res.status(204).send();
  } catch (error) {
    next(error);
  }
};
