import bcrypt from 'bcrypt';
import db from '../../db/connection.js';
import { signToken, signRefreshToken } from '../../services/jwt.js';

export const customerLogin = async (req, res, next) => {
  try {
    const { email, password } = req.body;
    
    // Check customers table
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
    
    // Generate UUID if DB doesn't (we removed DEFAULT UUID from the schema)
    // Actually we need `uuid` package. We installed it previously.
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
      .select('staff.*', 'restaurants.slug as restaurant_slug')
      .limit(1);

    if (!staff || staff.access === 'revoked') {
      return res.status(401).json({ error: 'Invalid email or password' });
    }

    const isValid = await bcrypt.compare(password, staff.password_hash);
    if (!isValid) {
      return res.status(401).json({ error: 'Invalid email or password' });
    }

    const permissions = [];
    if (staff.role === 'restaurant_admin') {
      permissions.push('menu:read', 'menu:write', 'order:read', 'order:update', 'session:read', 'session:write', 'staff:read', 'staff:write');
    } else if (staff.role === 'waiter') {
      permissions.push('menu:read', 'order:read', 'order:update', 'session:read', 'session:write');
    } else if (staff.role === 'chef') {
      permissions.push('menu:read', 'order:read', 'order:update');
    }

    const userPayload = {
      id: staff.id,
      name: staff.name,
      email: staff.email,
      role: staff.role,
      restaurantId: staff.restaurant_id,
      restaurantSlug: staff.restaurant_slug,
      permissions
    };

    const token = signToken(userPayload);
    const refreshToken = signRefreshToken(userPayload);

    res.json({ token, refreshToken, user: userPayload });
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

    // Try staff login first
    const [staff] = await db('staff')
      .where('staff.email', email)
      .andWhere('staff.deleted_at', null)
      .join('restaurants', 'staff.restaurant_id', 'restaurants.id')
      .select('staff.*', 'restaurants.slug as restaurant_slug')
      .limit(1);

    if (staff && staff.access !== 'revoked') {
      const isValid = await bcrypt.compare(password, staff.password_hash);
      if (isValid) {
        const permissions = [];
        if (staff.role === 'restaurant_admin') {
          permissions.push('menu:read', 'menu:write', 'order:read', 'order:update', 'session:read', 'session:write', 'staff:read', 'staff:write');
        } else if (staff.role === 'waiter') {
          permissions.push('menu:read', 'order:read', 'order:update', 'session:read', 'session:write');
        } else if (staff.role === 'chef') {
          permissions.push('menu:read', 'order:read', 'order:update');
        }

        const userPayload = {
          id: staff.id,
          name: staff.name,
          email: staff.email,
          role: staff.role,
          restaurantId: staff.restaurant_id,
          restaurantSlug: staff.restaurant_slug,
          permissions
        };

        const token = signToken(userPayload);
        const refreshToken = signRefreshToken(userPayload);

        return res.json({ token, refreshToken, user: userPayload });
      }
    }

    // Try platform admin login
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

    // No valid user found
    return res.status(401).json({ error: 'Invalid email or password' });
  } catch (error) {
    next(error);
  }
};

export const refreshToken = async (req, res, next) => {
  try {
    const { refreshToken: token } = req.body;

    if (!token) return res.status(401).json({ error: 'No token' });

    const { verifyToken } = await import('../../services/jwt.js');
    try {
      const decoded = verifyToken(token);
      
      const payload = {
        id: decoded.id,
        name: decoded.name,
        email: decoded.email,
        role: decoded.role,
        permissions: decoded.permissions,
        restaurantId: decoded.restaurantId,
        restaurantSlug: decoded.restaurantSlug
      };
      
      const newToken = signToken(payload);
      const newRefreshToken = signRefreshToken(payload);
      res.json({ token: newToken, refreshToken: newRefreshToken, user: payload });
    } catch (e) {
      res.status(403).json({ error: 'Invalid refresh token' });
    }
  } catch (error) {
    next(error);
  }
};
