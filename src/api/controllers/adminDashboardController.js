import db from '../../db/connection.js';

function todayInTimeZone(timeZone) {
  return new Intl.DateTimeFormat('en-CA', {
    timeZone,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).format(new Date());
}

export async function getAdminDashboardSnapshot(req, res, next) {
  try {
    const restaurantId = req.user.restaurantId;
    const restaurant = await db('restaurants').where('id', restaurantId).select('timezone').first();
    const timeZone = restaurant?.timezone || 'UTC';
    const today = todayInTimeZone(timeZone);

    const [{ count: activeSessions }, { count: ordersInProgress }, [revenue], [topItem]] = await Promise.all([
      db('sessions').where({ restaurant_id: restaurantId, status: 'active' }).count({ count: '*' }).first(),
      // The live data exposes pending/confirmed order states; served/rejected are terminal states used by the app.
      db('orders').where('restaurant_id', restaurantId).whereNotIn('status', ['served', 'rejected']).countDistinct({ count: 'id' }).first(),
      db('bills').where({ restaurant_id: restaurantId, is_active: 1, payment_status: 'paid' }).whereRaw('DATE(CONVERT_TZ(paid_at, ?, ?)) = ?', ['+00:00', timeZone, today]).sum({ total: 'total_amount' }),
      db('order_items as oi')
        .join('orders as o', 'o.id', 'oi.order_id')
        .where('o.restaurant_id', restaurantId)
        .whereRaw('DATE(CONVERT_TZ(oi.created_at, ?, ?)) = ?', ['+00:00', timeZone, today])
        // TODO: rejected item status was not present in dev data; verify against production values.
        .whereNot('oi.status', 'rejected')
        .select('oi.item_name_snapshot as name', 'oi.menu_item_id')
        .sum({ quantity: 'oi.quantity' })
        .groupBy('oi.item_name_snapshot', 'oi.menu_item_id')
        .orderBy('quantity', 'desc')
        .orderBy('oi.menu_item_id', 'asc')
        .limit(1),
    ]);

    return res.json({
      activeSessions: Number(activeSessions || 0),
      ordersInProgress: Number(ordersInProgress || 0),
      revenueToday: Number(Number(revenue?.total || 0).toFixed(2)),
      topItemToday: topItem ? { name: topItem.name, quantity: Number(topItem.quantity || 0) } : null,
    });
  } catch (error) {
    next(error);
  }
}
