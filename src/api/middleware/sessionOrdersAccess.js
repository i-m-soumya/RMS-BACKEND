import db from '../../db/connection.js';
import { verifyToken } from '../../services/jwt.js';

function querySessionGuestAccess({ sessionId, now, token, customerId }) {
  const query = db('customer_guest_tokens as guest_token')
    .join('sessions as session', 'guest_token.session_id', 'session.id')
    .join('restaurants as restaurant', 'session.restaurant_id', 'restaurant.id')
    .where('guest_token.session_id', sessionId)
    .whereColumn('guest_token.restaurant_id', 'session.restaurant_id')
    .where('guest_token.expires_at', '>', now)
    .where('restaurant.status', 'active');

  if (token) {
    query.where('guest_token.token', token);
  } else {
    query.where('guest_token.customer_id', customerId);
  }

  return query
    .select(
      'session.id as sessionId',
      'session.restaurant_id as restaurantId',
      'guest_token.customer_id as customerId'
    )
    .first();
}

export function createSessionOrdersAccess({
  findGuestSessionAccess,
  findCustomerSessionAccess,
  verifyCustomerToken = verifyToken,
}) {
  return async function requireSessionOrdersAccess(req, res, next) {
    const authorization = req.headers.authorization || '';
    const tokenMatch = authorization.match(/^Bearer\s+(.+)$/i);
    if (!tokenMatch) {
      return res.status(401).json({ error: 'A session access token is required' });
    }

    const token = tokenMatch[1];
    const sessionId = req.params.id;
    const now = new Date();

    try {
      const guestAccess = await findGuestSessionAccess(token, sessionId, now);
      if (guestAccess) {
        req.sessionAccess = guestAccess;
        return next();
      }

      let customer;
      try {
        customer = verifyCustomerToken(token);
      } catch {
        return res.status(401).json({ error: 'Session access token expired or invalid' });
      }

      if (customer?.role !== 'customer' || !customer.id) {
        return res.status(403).json({ error: 'Customer access is required for this session' });
      }

      const customerAccess = await findCustomerSessionAccess(customer.id, sessionId, now);
      if (!customerAccess) {
        return res.status(403).json({ error: 'Customer is not a member of this session' });
      }

      req.sessionAccess = customerAccess;
      return next();
    } catch (error) {
      return next(error);
    }
  };
}

export const requireSessionOrdersAccess = createSessionOrdersAccess({
  findGuestSessionAccess: (token, sessionId, now) => querySessionGuestAccess({ token, sessionId, now }),
  findCustomerSessionAccess: (customerId, sessionId, now) => querySessionGuestAccess({ customerId, sessionId, now }),
});