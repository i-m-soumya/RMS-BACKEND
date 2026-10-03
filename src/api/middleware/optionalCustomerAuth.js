import { verifyToken } from '../../services/jwt.js';
import db from '../../db/connection.js';

export async function optionalCustomerAuth(req, res, next) {
  const authHeader = req.headers.authorization || '';
  const token = authHeader.startsWith('Bearer ') ? authHeader.slice(7) : null;
  if (!token) {
    req.customerUser = null;
    return next();
  }

  try {
    const user = verifyToken(token);
    if (user.role !== 'customer' || !user.id || !user.mobile) {
      return res.status(401).json({ error: 'Customer token is invalid' });
    }
    const [customer] = await db('customers').where({ id: user.id, phone: user.mobile }).whereNull('deleted_at').limit(1);
    if (!customer) return res.status(401).json({ error: 'Customer account is no longer active' });
    req.customerUser = user;
    next();
  } catch (error) {
    return res.status(error.name === 'TokenExpiredError' ? 401 : 401).json({ error: 'Customer token expired or invalid' });
  }
}
