import db from '../../db/connection.js';
import { buildKitchenQueueResponse, getKitchenOrderNotes } from '../../services/kitchenQueue.js';

export const getKitchenQueue = async (req, res, next) => {
  try {
    const restaurantId = req.user?.restaurantId;
    if (!restaurantId) {
      return res.status(403).json({ error: 'Restaurant context is required' });
    }

    const orderRows = await db('orders')
      .join('sessions', 'orders.session_id', 'sessions.id')
      .join('tables', 'sessions.table_id', 'tables.id')
      .where('orders.restaurant_id', restaurantId)
      .whereIn('orders.status', ['confirmed', 'preparing', 'ready'])
      .select(
        'orders.id as order_id',
        'orders.status',
        'orders.created_at',
        'tables.table_number'
      )
      .orderBy('orders.created_at', 'asc');

    const orderIds = orderRows.map((order) => order.order_id);
    const items = orderIds.length
      ? await db('order_items')
          .whereIn('order_id', orderIds)
          .select('id', 'order_id', 'item_name_snapshot as name', 'quantity', 'notes', 'status', 'rejection_reason')
      : [];

    const grouped = orderRows.map((order) => ({
      order_id: order.order_id,
      table_number: order.table_number,
      status: order.status,
      created_at: order.created_at,
      notes: getKitchenOrderNotes(order),
      items: (items || [])
        .filter((item) => item.order_id === order.order_id)
        .map((item) => ({
          name: item.name || 'Item',
          id: item.id,
          quantity: Number(item.quantity ?? 1),
          notes: item.notes ?? null,
          status: item.status,
          rejection_reason: item.rejection_reason,
        })),
    }));

    return res.json(buildKitchenQueueResponse(grouped));
  } catch (error) {
    return next(error);
  }
};
