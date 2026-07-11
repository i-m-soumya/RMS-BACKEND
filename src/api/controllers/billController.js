import { v4 as uuidv4 } from 'uuid';
import db from '../../db/connection.js';
import { insertUsingKnownColumns } from '../../db/tableMeta.js';

function toBillItem(orderItem, menuItem) {
  const price = Number(menuItem?.price || orderItem.unit_price_snapshot || 0);
  const qty = Number(orderItem.quantity || 1);
  const itemTotal = Number(orderItem.subtotal || price * qty);

  return {
    orderItemId: orderItem.id,
    menuItem: {
      id: menuItem?.id || orderItem.menu_item_id,
      name: menuItem?.name || orderItem.item_name_snapshot || 'Item',
      description: menuItem?.description || '',
      price,
      originalPrice: Number(menuItem?.mrp || orderItem.mrp_snapshot || price),
      image: menuItem?.image_url || null,
      tags: menuItem?.dietary_type ? [menuItem.dietary_type] : []
    },
    quantity: qty,
    selectedAddons: [],
    itemTotal,
    status: orderItem.status || 'pending',
    orderedAt: orderItem.created_at
  };
}

async function getSessionOrderItems(sessionId) {
  const orders = await db('orders').where({ session_id: sessionId });
  if (!orders.length) return [];

  const orderIds = orders.map((o) => o.id);
  const orderItems = await db('order_items').whereIn('order_id', orderIds);
  if (!orderItems.length) return [];

  const menuItemIds = [...new Set(orderItems.map((i) => i.menu_item_id).filter(Boolean))];
  const menuItems = menuItemIds.length ? await db('menu_items').whereIn('id', menuItemIds) : [];
  const menuById = new Map(menuItems.map((m) => [m.id, m]));

  return orderItems.map((oi) => toBillItem(oi, menuById.get(oi.menu_item_id)));
}

export const getBillBySession = async (req, res, next) => {
  try {
    const { sessionId } = req.params;
    const items = await getSessionOrderItems(sessionId);

    const subtotal = items.reduce((sum, i) => sum + Number(i.itemTotal || 0), 0);
    const tax = Number((subtotal * 0.05).toFixed(2));
    const serviceCharge = Number((subtotal * 0.05).toFixed(2));
    const total = Number((subtotal + tax + serviceCharge).toFixed(2));

    res.json({
      items,
      summary: { subtotal, tax, serviceCharge, total }
    });
  } catch (error) {
    next(error);
  }
};

export const createBill = async (req, res, next) => {
  try {
    const { sessionId, restaurantId } = req.body;

    if (!sessionId) {
      return res.status(400).json({ error: 'sessionId is required' });
    }

    const [session] = await db('sessions').where({ id: sessionId }).limit(1);
    if (!session) {
      return res.status(404).json({ error: 'Session not found' });
    }

    const effectiveRestaurantId = restaurantId || session.restaurant_id;
    const items = await getSessionOrderItems(sessionId);

    const subtotal = items.reduce((sum, i) => sum + Number(i.itemTotal || 0), 0);
    const gstAmount = Number((subtotal * 0.05).toFixed(2));
    const total = Number((subtotal + gstAmount).toFixed(2));
    const billId = uuidv4();

    await insertUsingKnownColumns('bills', {
      id: billId,
      session_id: sessionId,
      restaurant_id: effectiveRestaurantId,
      subtotal,
      gst_amount: gstAmount,
      total,
      status: 'generated',
      total_amount: total,
      total_tax_amount: gstAmount,
      payment_status: 'pending',
      created_at: new Date(),
      updated_at: new Date()
    });

    await insertUsingKnownColumns('sessions', {
      id: sessionId,
      status: 'bill_requested',
      bill_requested_at: new Date(),
      updated_at: new Date()
    });

    res.status(201).json({
      billId,
      sessionId,
      items,
      summary: {
        subtotal,
        tax: gstAmount,
        serviceCharge: 0,
        total
      }
    });
  } catch (error) {
    next(error);
  }
};
