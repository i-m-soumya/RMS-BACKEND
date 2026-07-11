import db from '../../db/connection.js';

export const getSession = async (req, res, next) => {
  try {
    const { id } = req.params;
    const [session] = await db('sessions').where({ id }).limit(1);
    
    if (!session) {
      return res.status(404).json({ error: 'Session not found' });
    }
    
    res.json(session);
  } catch (error) {
    next(error);
  }
};

export const joinSessionByTable = async (req, res, next) => {
  try {
    const { tableId } = req.params;
    const customerId = req.user ? req.user.id : null;
    
    // Find active session for this table
    const [session] = await db('sessions')
      .where({ table_id: tableId, status: 'active' })
      .limit(1);
    
    if (!session) {
      return res.status(404).json({ error: 'No active session found for this table' });
    }

    // Generate guest token
    const { v4: uuidv4 } = await import('uuid');
    const guestToken = uuidv4();

    // Since our DB uses customer_guest_tokens (instead of session_customers)
    await db('customer_guest_tokens').insert({
      id: uuidv4(),
      customer_id: customerId || null,
      token: guestToken,
      restaurant_id: session.restaurant_id,
      session_id: session.id,
      expires_at: new Date(Date.now() + 2 * 60 * 60 * 1000) // 2 hours
    });

    res.status(201).json({ guestToken, sessionId: session.id, customerId });
  } catch (error) {
    next(error);
  }
};

// For staff to create a session for a table
export const createSession = async (req, res, next) => {
  try {
    const { restaurant_id, table_id } = req.body;

    if (req.user.role !== 'platform_admin' && req.user.restaurantId !== restaurant_id) {
      return res.status(403).json({ error: 'Forbidden: Cannot create session for another restaurant' });
    }
    
    // Check if table has an active session
    const [existingSession] = await db('sessions')
      .where({ table_id, status: 'active' })
      .limit(1);
      
    if (existingSession) {
      return res.status(409).json({ error: 'Table already has an active session' });
    }

    const [newSessionId] = await db('sessions').insert({
      restaurant_id,
      table_id,
      status: 'active'
    });

    // Update table status
    await db('tables').where({ id: table_id }).update({ status: 'active' });

    res.status(201).json({ sessionId: newSessionId });
  } catch (error) {
    next(error);
  }
};
