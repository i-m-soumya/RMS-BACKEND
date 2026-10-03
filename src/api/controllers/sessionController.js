import db from '../../db/connection.js';
import { v4 as uuidv4 } from 'uuid';
import { insertUsingKnownColumns } from '../../db/tableMeta.js';
import { broadcastTablesChanged } from '../../socket/index.js';
import { applySinceFilter, buildSinceCursor } from '../../services/reconnectState.js';

const TABLE_STATUS = {
  available: 'idle',
  occupied: 'active',
  reserved: 'idle',
  inactive: 'inactive'
};

export function generateJoinCode() {
  return String(1000 + Math.floor(Math.random() * 9000));
}

export function resolveJoinCodeForSession(session) {
  const value = session?.join_code;
  if (typeof value === 'string' && value.trim()) {
    return value;
  }
  if (typeof value === 'number' && Number.isFinite(value)) {
    return String(value);
  }

  return generateJoinCode();
}

async function ensureSessionJoinCode(sessionId, restaurantId) {
  const [session] = await db('sessions')
    .where({ id: sessionId, restaurant_id: restaurantId })
    .select('id', 'join_code')
    .limit(1);

  if (session && session.join_code) {
    return session.join_code;
  }

  let joinCode = generateJoinCode();
  for (let attempt = 0; attempt < 8; attempt += 1) {
    const [existing] = await db('sessions')
      .where({ restaurant_id: restaurantId, join_code: joinCode })
      .whereNot({ id: sessionId })
      .select('id')
      .limit(1);

    if (!existing) {
      await db('sessions')
        .where({ id: sessionId, restaurant_id: restaurantId })
        .update({ join_code: joinCode, updated_at: new Date() });
      return joinCode;
    }

    joinCode = generateJoinCode();
  }

  return joinCode;
}

export const getTableBoard = async (req, res, next) => {
  try {
    const restaurantId = req.user.restaurantId;
    if (!restaurantId) {
      return res.status(403).json({ error: 'Restaurant context is required' });
    }

    const tables = await db('tables')
      .leftJoin('floors', 'tables.floor_id', 'floors.id')
      .where('tables.restaurant_id', restaurantId)
      .where('tables.is_active', 1)
      .select(
        'tables.id as table_id',
        'tables.table_number',
        'tables.seating_capacity',
        'tables.capacity',
        'tables.status as table_status',
        'tables.floor_id',
        'floors.name as floor',
        'floors.display_order as floor_display_order'
      )
      .orderByRaw('COALESCE(floors.display_order, 2147483647) asc')
      .orderBy('tables.table_number', 'asc');

    const sessions = await db('sessions')
      .leftJoin('staff', 'sessions.opened_by_staff_id', 'staff.id')
      .leftJoin('customers', 'sessions.opened_by_customer_id', 'customers.id')
      .where('sessions.restaurant_id', restaurantId)
      .whereIn('sessions.status', ['active', 'bill_requested'])
      .select(
        'sessions.id as session_id',
        'sessions.table_id',
        'sessions.status',
        'sessions.opened_at',
        'sessions.created_at',
        'sessions.opened_by_staff_id',
        'staff.name as staff_name',
        'customers.name as customer_name'
      )
      .orderBy('sessions.opened_at', 'asc');

    const memberCounts = sessions.length === 0
      ? []
      : await db('session_members')
        .whereIn('session_id', sessions.map((session) => session.session_id))
        .whereNull('left_at')
        .groupBy('session_id')
        .select('session_id')
        .count({ count: '*' });
    const membersBySession = new Map(memberCounts.map((row) => [row.session_id, Number(row.count)]));
    const sessionsByTable = new Map();

    sessions.forEach((session) => {
      const tableSessions = sessionsByTable.get(session.table_id) || [];
      tableSessions.push({
        session_id: session.session_id,
        owner_display: session.opened_by_staff_id ? session.staff_name : (session.customer_name || 'Guest'),
        status: session.status,
        opened_at: session.opened_at || session.created_at,
        session_members: membersBySession.get(session.session_id) || 0
      });
      sessionsByTable.set(session.table_id, tableSessions);
    });

    res.json({
      data: tables.map((table) => ({
        table_id: table.table_id,
        table_number: table.table_number,
        floor_id: table.floor_id,
        floor: table.floor || 'Unassigned',
        display_order: table.floor_display_order,
        seating_capacity: table.seating_capacity || table.capacity,
        status: sessionsByTable.get(table.table_id)?.some((session) => session.status === 'bill_requested')
          ? 'bill_requested'
          : (sessionsByTable.has(table.table_id) ? 'active' : (TABLE_STATUS[table.table_status] || 'idle')),
        sessions: sessionsByTable.get(table.table_id) || []
      }))
    });
  } catch (error) {
    next(error);
  }
};

export const getWaiterSessionDetail = async (req, res, next) => {
  try {
    const restaurantId = req.user.restaurantId;
    const { session_id: sessionId } = req.params;
    if (!restaurantId) {
      return res.status(403).json({ error: 'Restaurant context is required' });
    }

    const [session] = await db('sessions')
      .leftJoin('staff', 'sessions.opened_by_staff_id', 'staff.id')
      .leftJoin('customers as owner_customer', 'sessions.opened_by_customer_id', 'owner_customer.id')
      .where({ 'sessions.id': sessionId, 'sessions.restaurant_id': restaurantId })
      .select(
        'sessions.id',
        'sessions.status',
        'sessions.join_code',
        'sessions.opened_at',
        'sessions.table_id',
        'sessions.opened_by_staff_id',
        'staff.name as staff_name',
        'owner_customer.name as customer_name'
      )
      .limit(1);
    if (!session) {
      return res.status(404).json({ error: 'Session not found' });
    }

    const members = await db('session_members')
      .leftJoin('customers', 'session_members.customer_id', 'customers.id')
      .where({ 'session_members.session_id': sessionId, 'session_members.restaurant_id': restaurantId })
      .whereNull('session_members.left_at')
      .select('session_members.id', 'session_members.customer_id', 'session_members.joined_at', 'customers.name')
      .orderBy('session_members.joined_at', 'asc');

    const orders = await db('orders')
      .where({ session_id: sessionId, restaurant_id: restaurantId })
      .select('id', 'status', 'rejection_reason', 'created_at', 'placed_by', 'placed_by_staff_id')
      .orderBy('created_at', 'desc');
    const orderIds = orders.map((order) => order.id);
    const items = orderIds.length
      ? await db('order_items').whereIn('order_id', orderIds).select(
        'id', 'order_id', 'menu_item_id', 'item_name_snapshot', 'quantity', 'notes', 'status', 'rejection_reason', 'subtotal'
      )
      : [];
    const itemIds = items.map((item) => item.id);
    const addons = itemIds.length
      ? await db('order_item_addons').whereIn('order_item_id', itemIds).select(
        'id', 'order_item_id', 'addon_name_snapshot', 'addon_price_snapshot', 'quantity'
      )
      : [];
    const itemsByOrder = new Map();
    items.forEach((item) => {
      const orderItems = itemsByOrder.get(item.order_id) || [];
      orderItems.push({
        id: item.id,
        menu_item_id: item.menu_item_id,
        name: item.item_name_snapshot,
        quantity: Number(item.quantity),
        notes: item.notes,
        status: item.status,
        rejection_reason: item.rejection_reason,
        subtotal: Number(item.subtotal),
        addons: addons.filter((addon) => addon.order_item_id === item.id).map((addon) => ({
          id: addon.id,
          name: addon.addon_name_snapshot,
          price: Number(addon.addon_price_snapshot),
          quantity: Number(addon.quantity)
        }))
      });
      itemsByOrder.set(item.order_id, orderItems);
    });

    const joinCode = resolveJoinCodeForSession(session);
    if (!session.join_code) {
      await db('sessions').where({ id: sessionId, restaurant_id: restaurantId }).update({ join_code: joinCode, updated_at: new Date() });
    }

    res.json({
      data: {
        session: {
          id: session.id,
          table_id: session.table_id,
          status: session.status,
          join_code: joinCode,
          opened_at: session.opened_at,
          owner_display: session.opened_by_staff_id ? (session.staff_name || 'Staff') : (session.customer_name || 'Guest')
        },
        session_members: members.map((member) => ({
          id: member.id,
          customer_id: member.customer_id,
          name: member.name || 'Guest',
          joined_at: member.joined_at
        })),
        orders: orders.map((order) => ({
          id: order.id,
          status: order.status,
          rejection_reason: order.rejection_reason,
          created_at: order.created_at,
          placed_by: order.placed_by,
          total: (itemsByOrder.get(order.id) || []).reduce((sum, item) => sum + item.subtotal, 0),
          order_items: itemsByOrder.get(order.id) || []
        }))
      }
    });
  } catch (error) {
    next(error);
  }
};

export const resetWaiterSession = async (req, res, next) => {
  try {
    const restaurantId = req.user.restaurantId;
    const staffId = req.user.id;
    const { session_id: sessionId } = req.params;
    if (req.body?.confirm !== true) return res.status(400).json({ error: 'confirm: true is required' });
    const force = req.body?.force === true;
    const result = await db.transaction(async (trx) => {
      const [session] = await trx('sessions').where({ id: sessionId, restaurant_id: restaurantId }).forUpdate().first();
      if (!session) { const error = new Error('Session not found'); error.status = 404; throw error; }
      if (session.status === 'closed') { const error = new Error('Session is already closed'); error.status = 404; throw error; }
      const activeOrders = await trx('orders').where({ session_id: sessionId, restaurant_id: restaurantId }).whereIn('status', ['pending', 'confirmed', 'preparing', 'ready']).select('id');
      if (activeOrders.length && !force) { const error = new Error('Session has in-progress orders; force is required'); error.status = 409; throw error; }
      const now = new Date();
      await trx('sessions').where({ id: sessionId, restaurant_id: restaurantId }).update({ status: 'closed', closed_at: now, updated_at: now });
      await trx('customer_guest_tokens').where({ session_id: sessionId }).where('expires_at', '>', now).update({ expires_at: now });
      await trx('session_members').where({ session_id: sessionId }).whereNull('left_at').update({ left_at: now });
      await trx('staff_activity_log').insert({ id: uuidv4(), restaurant_id: restaurantId, staff_id: staffId, action_type: 'session_reset', reference_type: 'session', reference_id: sessionId, created_at: now });
      return { session_id: sessionId, status: 'closed' };
    });
    await broadcastTablesChanged((await db('restaurants').where({ id: restaurantId }).first())?.slug);
    return res.json({ data: result });
  } catch (error) { return next(error); }
};

export const getSession = async (req, res, next) => {
  try {
    const { id } = req.params;
    const { since } = req.query || {};
    const [session] = await db('sessions').where({ id }).limit(1);

    if (!session) {
      return res.status(404).json({ error: 'Session not found' });
    }

    const cursor = buildSinceCursor(since);
    if (cursor) {
      const filtered = applySinceFilter([session], cursor);
      return res.json(filtered[0] || null);
    }

    return res.json(session);
  } catch (error) {
    next(error);
  }
};

export const joinSessionByTable = async (req, res, next) => {
  try {
    const { tableId } = req.params;
    let customerId = req.user?.role === 'customer' ? req.user.id : null;

    let targetTableId = tableId;
    const [tableByNumber] = await db('tables').where({ table_number: tableId }).limit(1);
    if (tableByNumber) {
      targetTableId = tableByNumber.id;
    }

    const [table] = await db('tables').where({ id: targetTableId, is_active: 1 }).limit(1);
    if (!table) {
      return res.status(404).json({ error: 'Table not found' });
    }
    
    // Customers may join an open session, but only staff may start one.
    let [session] = await db('sessions')
      .where({ table_id: targetTableId, status: 'active' })
      .orderBy('created_at', 'desc')
      .limit(1);

    if (!session) {
      return res.status(409).json({
        code: 'TABLE_SESSION_NOT_OPEN',
        error: 'Ask the waiter to start this table session before ordering.',
      });
    }

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

    if (!session.join_code) {
      const joinCode = await ensureSessionJoinCode(session.id, session.restaurant_id);
      session.join_code = joinCode;
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

    const [restaurant] = await db('restaurants').where({ id: session.restaurant_id }).select('slug').limit(1);
    broadcastTablesChanged(restaurant?.slug);

    res.status(201).json({ guestToken, sessionId: session.id, customerId });
  } catch (error) {
    next(error);
  }
};

// For staff to create a session for a table
export const createSession = async (req, res, next) => {
  try {
    const table_id = req.params.table_id || req.body.table_id;
    const restaurantId = req.user.restaurantId;
    if (!restaurantId) {
      return res.status(403).json({ error: 'Restaurant context is required' });
    }

    const [table] = await db('tables')
      .where({ id: table_id, restaurant_id: restaurantId, is_active: 1 })
      .limit(1);
    if (!table) {
      return res.status(404).json({ error: 'Table not found' });
    }

    const sessionId = uuidv4();
    let createdSession;
    for (let attempt = 0; attempt < 8; attempt += 1) {
      const joinCode = generateJoinCode();
      try {
        await insertUsingKnownColumns('sessions', {
          id: sessionId,
          restaurant_id: restaurantId,
          table_id,
          opened_by_staff_id: req.user.id,
          opened_by_customer_id: null,
          status: 'active',
          opened_at: new Date(),
          created_at: new Date(),
          updated_at: new Date(),
          join_code: joinCode
        });
        [createdSession] = await db('sessions').where({ id: sessionId }).limit(1);
        break;
      } catch (error) {
        if (error.code !== 'ER_DUP_ENTRY' || attempt === 7) throw error;
      }
    }

    const [restaurant] = await db('restaurants').where({ id: restaurantId }).select('slug').limit(1);
    broadcastTablesChanged(restaurant?.slug);
    res.status(201).json({ data: createdSession });
  } catch (error) {
    next(error);
  }
};
