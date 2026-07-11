import db from '../../db/connection.js';
import { v4 as uuidv4 } from 'uuid';
import { insertUsingKnownColumns } from '../../db/tableMeta.js';

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
    let customerId = req.user ? req.user.id : null;

    if (!customerId) {
      customerId = uuidv4();
      await insertUsingKnownColumns('customers', {
        id: customerId,
        name: 'Guest User',
        is_registered: 0,
        created_at: new Date(),
        updated_at: new Date()
      });
    }

    let targetTableId = tableId;
    const [tableByNumber] = await db('tables').where({ table_number: tableId }).limit(1);
    if (tableByNumber) {
      targetTableId = tableByNumber.id;
    }

    const [table] = await db('tables').where({ id: targetTableId }).limit(1);
    if (!table) {
      return res.status(404).json({ error: 'Table not found' });
    }
    
    // Reuse an open session when available, otherwise let the customer start one.
    let [session] = await db('sessions')
      .where({ table_id: targetTableId })
      .whereIn('status', ['active', 'bill_requested'])
      .orderBy('created_at', 'desc')
      .limit(1);

    if (!session) {
      const sessionId = uuidv4();

      await insertUsingKnownColumns('sessions', {
        id: sessionId,
        restaurant_id: table.restaurant_id,
        table_id: table.id,
        status: 'active',
        created_at: new Date(),
        updated_at: new Date()
      });

      await db('tables').where({ id: table.id }).update({
        status: 'active',
        updated_at: new Date()
      });

      [session] = await db('sessions').where({ id: sessionId }).limit(1);
    }

    // Generate guest token
    const guestToken = uuidv4();

    // Since our DB uses customer_guest_tokens (instead of session_customers)
    await db('customer_guest_tokens').insert({
      id: uuidv4(),
      customer_id: customerId,
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
