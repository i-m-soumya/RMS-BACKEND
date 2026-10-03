import { v4 as uuidv4 } from 'uuid';
import db from '../../db/connection.js';
import { STAFF_SESSION_IDLE_TIMEOUT_DAYS } from '../../config/auth.js';
import { emitNotification } from '../../services/notifications.js';
import { broadcastItemOutOfStock, broadcastOrderRejected } from '../../socket/index.js';

function getDateBounds(dateValue) {
  const date = dateValue || new Date().toISOString().slice(0, 10);
  const start = new Date(`${date}T00:00:00`);
  const end = new Date(`${date}T23:59:59.999`);
  return { date, start, end };
}

function sessionLastUsedAt(session) {
  if (session.invalidated_at) return new Date(session.invalidated_at);
  if (session.status === 'active') {
    return new Date(new Date(session.expires_at).getTime() - STAFF_SESSION_IDLE_TIMEOUT_DAYS * 24 * 60 * 60 * 1000);
  }
  return new Date(session.created_at);
}

export const updateKitchenOrderItemStatus = async (req, res, next) => {
  try {
    const { id } = req.params;
    const { status } = req.body;
    const staffId = req.user.id;
    const restaurantId = req.user.restaurantId;
    const attributionColumn = status === 'preparing' ? 'preparing_by_staff_id' : 'ready_by_staff_id';
    const actionType = status === 'preparing' ? 'order_item_preparing' : 'order_item_ready';

    await db.transaction(async (trx) => {
      const [item] = await trx('order_items as oi')
        .join('orders as o', 'o.id', 'oi.order_id')
        .where('oi.id', id)
        .where('o.restaurant_id', restaurantId)
        .select('oi.id', 'oi.status')
        .limit(1);

      if (!item) {
        const error = new Error('Order item not found');
        error.status = 404;
        throw error;
      }

      await trx('order_items').where({ id }).update({
        status,
        [attributionColumn]: staffId,
        updated_at: new Date(),
      });

      await trx('staff_activity_log').insert({
        id: uuidv4(),
        restaurant_id: restaurantId,
        staff_id: staffId,
        action_type: actionType,
        reference_type: 'order_item',
        reference_id: id,
        notes: `Marked order item ${status}`,
        created_at: new Date(),
      });
    });

    const [itemDetail] = await db('order_items as oi')
      .join('orders as o', 'o.id', 'oi.order_id')
      .join('sessions as s', 's.id', 'o.session_id')
      .join('tables as t', 't.id', 's.table_id')
      .where('oi.id', id)
      .where('o.restaurant_id', restaurantId)
      .select('o.id as order_id', 'o.session_id', 't.table_number', 'oi.status as item_status');

    await emitNotification({
      restaurantId,
      eventType: status === 'preparing' ? 'order:item_preparing' : 'order:item_ready',
      payload: {
        order_id: itemDetail?.order_id,
        session_id: itemDetail?.session_id,
        item_id: id,
        table_number: itemDetail?.table_number,
        status: status === 'preparing' ? 'preparing' : 'ready',
      },
      targetRole: 'waiter',
    });

    return res.json({ success: true, status });
  } catch (error) {
    next(error);
  }
};

async function restaurantSlug(restaurantId) { return (await db('restaurants').where({ id: restaurantId }).select('slug').first())?.slug; }

export const rejectChefOrder = async (req, res, next) => {
  try {
    const restaurantId = req.user.restaurantId; const staffId = req.user.id; const orderId = req.params.orderId;
    const result = await db.transaction(async (trx) => {
      const order = await trx('orders').where({ id: orderId, restaurant_id: restaurantId }).forUpdate().first();
      if (!order) { const error = new Error('Order not found'); error.status = 404; throw error; }
      if (!['confirmed', 'preparing', 'ready'].includes(order.status)) { const error = new Error('Only active kitchen orders can be rejected'); error.status = 409; throw error; }
      const reason = req.body?.reason?.trim() || null; const now = new Date();
      await trx('orders').where({ id: orderId }).update({ status: 'rejected', rejected_by: 'chef', rejected_by_staff_id: staffId, rejection_reason: reason, rejected_at: now, updated_at: now });
      await trx('order_items').where({ order_id: orderId }).whereNot('status', 'served').update({ status: 'rejected', rejected_by_staff_id: staffId, rejection_reason: reason, updated_at: now });
      await trx('staff_activity_log').insert({ id: uuidv4(), restaurant_id: restaurantId, staff_id: staffId, action_type: 'order_rejected', reference_type: 'order', reference_id: orderId, notes: reason, created_at: now });
      return { customerId: order.customer_id, sessionId: order.session_id, reason };
    });
    const slug = await restaurantSlug(restaurantId);
    await emitNotification({ restaurantId, eventType: 'order:rejected', payload: { order_id: orderId, session_id: result.sessionId, reason: result.reason }, targetCustomerId: result.customerId });
    await emitNotification({ restaurantId, eventType: 'order:rejected', payload: { order_id: orderId, session_id: result.sessionId, reason: result.reason }, targetRole: 'waiter' });
    broadcastOrderRejected(slug, { order_id: orderId, session_id: result.sessionId, customer_id: result.customerId, reason: result.reason });
    return res.json({ success: true, order_id: orderId, status: 'rejected' });
  } catch (error) { return next(error); }
};

export const rejectChefOrderItem = async (req, res, next) => {
  try {
    const restaurantId = req.user.restaurantId; const staffId = req.user.id; const itemId = req.params.orderItemId;
    const result = await db.transaction(async (trx) => {
      const item = await trx('order_items as oi').join('orders as o', 'o.id', 'oi.order_id').where({ 'oi.id': itemId, 'o.restaurant_id': restaurantId }).select('oi.*', 'o.customer_id', 'o.session_id', 'o.id as order_id').forUpdate().first();
      if (!item) { const error = new Error('Order item not found'); error.status = 404; throw error; }
      if (['served', 'rejected'].includes(item.status)) { const error = new Error('Order item is already terminal'); error.status = 409; throw error; }
      const reason = req.body?.reason?.trim() || 'Rejected by chef - auto marked out of stock'; const now = new Date();
      const menuItem = await trx('menu_items').where({ id: item.menu_item_id, restaurant_id: restaurantId }).forUpdate().first();
      await trx('order_items').where({ id: itemId }).update({ status: 'rejected', rejected_by_staff_id: staffId, rejection_reason: reason, updated_at: now });
      if (menuItem?.is_available) {
        await trx('menu_items').where({ id: menuItem.id }).update({ is_available: 0, updated_at: now });
        await trx('menu_item_availability_log').insert({ id: uuidv4(), menu_item_id: menuItem.id, restaurant_id: restaurantId, changed_by_staff_id: staffId, changed_by_role: 'chef', trigger_type: 'chef_rejection', previous_value: 1, new_value: 0, reason, order_item_id: itemId, created_at: now });
      }
      const remaining = await trx('order_items').where({ order_id: item.order_id }).whereNot('status', 'rejected').whereNot('status', 'served').count({ total: '*' }).first();
      if (Number(remaining.total) === 0) await trx('orders').where({ id: item.order_id }).update({ status: 'rejected', rejected_by: 'chef', rejected_by_staff_id: staffId, rejection_reason: reason, rejected_at: now, updated_at: now });
      await trx('staff_activity_log').insert({ id: uuidv4(), restaurant_id: restaurantId, staff_id: staffId, action_type: 'order_item_rejected', reference_type: 'order_item', reference_id: itemId, notes: reason, created_at: now });
      return { customerId: item.customer_id, sessionId: item.session_id, orderId: item.order_id, menuItemId: item.menu_item_id, reason, becameUnavailable: Boolean(menuItem?.is_available) };
    });
    const slug = await restaurantSlug(restaurantId);
    await emitNotification({ restaurantId, eventType: 'item:out_of_stock', payload: { order_id: result.orderId, item_id: itemId, reason: result.reason }, targetCustomerId: result.customerId });
    await emitNotification({ restaurantId, eventType: 'item:out_of_stock', payload: { order_id: result.orderId, item_id: itemId, reason: result.reason }, targetRole: 'waiter' });
    broadcastItemOutOfStock(slug, { order_id: result.orderId, item_id: itemId, menu_item_id: result.menuItemId, customer_id: result.customerId });
    return res.json({ success: true, order_item_id: itemId, status: 'rejected' });
  } catch (error) { return next(error); }
};

export const getStaffActivity = async (req, res, next) => {
  try {
    const { id } = req.params;
    const { date, start, end } = getDateBounds(req.query.date);
    const [staff] = await db('staff').where({ id }).select('id', 'restaurant_id', 'name', 'email', 'role').limit(1);
    if (!staff) return res.status(404).json({ error: 'Staff member not found' });
    if (req.user.role !== 'platform_admin' && (req.user.role !== 'restaurant_admin' || req.user.restaurantId !== staff.restaurant_id)) {
      return res.status(403).json({ error: 'Forbidden: Cannot access staff activity for another restaurant' });
    }

    const [sessions, actions] = await Promise.all([
      db('staff_sessions')
        .where({ staff_id: id })
        .where('created_at', '<=', end)
        .andWhere((query) => query.whereBetween('invalidated_at', [start, end]).orWhere((activeQuery) => activeQuery.where('status', 'active').andWhere('expires_at', '>=', start)))
        .select('id', 'status', 'created_at', 'invalidated_at', 'expires_at', 'device_info', 'ip_address')
        .orderBy('created_at', 'desc'),
      db('staff_activity_log as log')
        .where({ 'log.staff_id': id, 'log.restaurant_id': staff.restaurant_id })
        .whereBetween('log.created_at', [start, end])
        .leftJoin('order_items as oi', function joinOrderItem() {
          this.on('oi.id', '=', 'log.reference_id').andOn('log.reference_type', '=', db.raw('?', ['order_item']));
        })
        .leftJoin('orders as o', 'o.id', 'oi.order_id')

        .leftJoin('menu_items as mi', function joinMenuItem() {
          this.on('mi.id', '=', 'log.reference_id').andOn('log.reference_type', '=', db.raw('?', ['menu_item']));
        })
        .select(
          'log.id', 'log.action_type', 'log.reference_type', 'log.reference_id', 'log.notes', 'log.created_at',
          'oi.order_id', 'oi.menu_item_id', 'mi.name as menu_item_name', 'o.table_label',
        )
        .orderBy('log.created_at', 'desc'),
    ]);

    const firstUse = sessions.length ? sessions.reduce((first, session) => session.created_at < first ? session.created_at : first, sessions[0].created_at) : null;
    const lastUse = sessions.length
      ? sessions.reduce((last, session) => {
        const usedAt = sessionLastUsedAt(session);
        return usedAt > last ? usedAt : last;
      }, sessionLastUsedAt(sessions[0]))
      : null;
    const activeSessions = sessions.filter((session) => session.status === 'active' && new Date(session.expires_at) > new Date());
    const lastActive = activeSessions.length
      ? activeSessions.sort((left, right) => new Date(right.created_at) - new Date(left.created_at))[0].created_at
      : lastUse;
    const actionCounts = actions.reduce((counts, action) => ({
      ...counts,
      [action.action_type]: (counts[action.action_type] || 0) + 1,
    }), {});
    const summary = {
      first_use: firstUse,
      last_use: lastUse,
      last_active: lastActive,
      active_now: activeSessions.length > 0,
      session_count: sessions.length,
      action_count: actions.length,
      order_count: actions.filter((action) => ['order_confirmed', 'order_rejected', 'direct_order_placed'].includes(action.action_type)).length,
      dishes_prepared: actions.filter((action) => action.action_type === 'order_item_preparing').length,
      dishes_ready: actions.filter((action) => action.action_type === 'order_item_ready').length,
      action_counts: actionCounts,
    };

    return res.json({
      data: {
        staff,
        date,
        from: start,
        to: end,
        summary,
        sessions,
        actions: actions.map((action) => ({
          ...action,
          context: action.reference_type === 'order_item'
            ? `${action.menu_item_name || 'Order item'}${action.order_id ? ` · Order ${action.order_id}` : ''}${action.table_label ? ` · Table ${action.table_label}` : ''}`
            : action.reference_type === 'menu_item'
              ? action.menu_item_name || 'Menu item'
              : action.notes || action.reference_id || action.reference_type,
        })),
      },
    });
  } catch (error) {
    next(error);
  }
};

export const getChefShiftHistory = async (req, res, next) => {
  try {
    const restaurantId = req.user.restaurantId; const page = Number(req.query.page || 1); const pageSize = Number(req.query.pageSize || 20);
    const restaurant = await db('restaurants').where({ id: restaurantId }).select('timezone').first();
    const localDate = new Intl.DateTimeFormat('en-CA', { timeZone: restaurant?.timezone || 'UTC' }).format(new Date());
    const start = `${localDate} 00:00:00`; const end = `${localDate} 23:59:59.999`;
    const base = db('orders as o').where({ 'o.restaurant_id': restaurantId }).where((query) => query.whereBetween('o.served_at', [start, end]).orWhereBetween('o.rejected_at', [start, end])).whereIn('o.status', ['served', 'rejected']);
    const [{ totalCount }] = await base.clone().clearSelect().clearOrder().clear('limit').clear('offset').count({ totalCount: 'o.id' });
    const orders = await base.clone().leftJoin('staff as rejected_staff', 'rejected_staff.id', 'o.rejected_by_staff_id').select('o.id', 'o.table_label', 'o.status', 'o.served_at', 'o.rejected_at', 'o.rejection_reason', 'o.rejected_by', 'rejected_staff.name as rejected_by_name').orderByRaw('COALESCE(o.served_at, o.rejected_at) DESC').limit(pageSize).offset((page - 1) * pageSize);
    const items = orders.length ? await db('order_items').whereIn('order_id', orders.map((order) => order.id)).select('order_id', 'item_name_snapshot as name', 'quantity', 'status', 'rejection_reason') : [];
    return res.json({ entries: orders.map((order) => ({ ...order, items: items.filter((item) => item.order_id === order.id).map((item) => ({ ...item, quantity: Number(item.quantity) })) })), page, pageSize, totalCount: Number(totalCount), hasNextPage: page * pageSize < Number(totalCount) });
  } catch (error) { return next(error); }
};
