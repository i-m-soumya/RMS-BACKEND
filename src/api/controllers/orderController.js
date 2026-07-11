import { v4 as uuidv4 } from 'uuid';
import db from '../../db/connection.js';
import { getTableColumns, insertUsingKnownColumns } from '../../db/tableMeta.js';

async function getOrCreateGuestCustomer() {
  const customerId = uuidv4();
  await insertUsingKnownColumns('customers', {
    id: customerId,
    name: 'Guest User',
    is_registered: 0,
    created_at: new Date(),
    updated_at: new Date()
  });
  return customerId;
}

async function resolveSession({ sessionId, tableId }) {
  if (sessionId) {
    const [session] = await db('sessions').where({ id: sessionId }).limit(1);
    return session || null;
  }

  if (tableId) {
    const [session] = await db('sessions')
      .where({ table_id: tableId })
      .whereIn('status', ['active', 'bill_requested'])
      .orderBy('created_at', 'desc')
      .limit(1);
    return session || null;
  }

  return null;
}

export const createOrder = async (req, res, next) => {
  try {
    const { sessionId, tableId, restaurantId, cartItems = [] } = req.body;

    if (!Array.isArray(cartItems) || cartItems.length === 0) {
      return res.status(400).json({ error: 'cartItems must contain at least one item' });
    }

    const session = await resolveSession({ sessionId, tableId });
    if (!session) {
      return res.status(404).json({ error: 'Active session not found' });
    }

    const effectiveRestaurantId = restaurantId || session.restaurant_id;
    const [table] = await db('tables').where({ id: session.table_id }).limit(1);

    const customerId = req.user?.id || (await getOrCreateGuestCustomer());
    const orderId = uuidv4();
    const total = cartItems.reduce((sum, i) => sum + Number(i.itemTotal || 0), 0);

    const orderColumns = await getTableColumns('orders');
    const orderPayload = {
      id: orderId,
      session_id: session.id,
      restaurant_id: effectiveRestaurantId,
      customer_id: customerId,
      status: 'pending',
      total,
      placed_by: 'customer',
      table_label: table?.table_number || table?.name || 'N/A',
      is_direct_order: 0,
      created_at: new Date(),
      updated_at: new Date()
    };

    if (orderColumns.has('idempotency_key')) {
      orderPayload.idempotency_key = req.headers['x-idempotency-key'] || null;
    }

    await insertUsingKnownColumns('orders', orderPayload);

    for (const cartItem of cartItems) {
      const itemId = uuidv4();
      const menuItem = cartItem.menuItem || {};
      const quantity = Number(cartItem.quantity || 1);
      const unitPrice = Number(menuItem.price || 0);
      const lineTotal = Number(cartItem.itemTotal || quantity * unitPrice);

      await insertUsingKnownColumns('order_items', {
        id: itemId,
        order_id: orderId,
        menu_item_id: menuItem.id,
        quantity,
        notes: cartItem.specialInstructions || null,
        status: 'pending',
        subtotal: lineTotal,
        item_name_snapshot: menuItem.name || 'Item',
        mrp_snapshot: Number(menuItem.originalPrice || unitPrice),
        unit_price_snapshot: unitPrice,
        discount_amount_snapshot: 0,
        discount_percentage_snapshot: 0,
        created_at: new Date(),
        updated_at: new Date()
      });
    }

    await db('tables').where({ id: session.table_id }).update({
      status: 'active',
      updated_at: new Date()
    });

    res.status(201).json({
      orderId,
      status: 'pending',
      total,
      createdAt: new Date().toISOString()
    });
  } catch (error) {
    next(error);
  }
};

export const getSessionOrders = async (req, res, next) => {
  try {
    const { id } = req.params;

    const sessionOrders = await db('orders')
      .where({ session_id: id })
      .orderBy('created_at', 'desc');

    if (sessionOrders.length === 0) {
      return res.json([]);
    }

    const orderIds = sessionOrders.map((o) => o.id);
    const items = await db('order_items').whereIn('order_id', orderIds);
    const menuItemIds = [...new Set(items.map((i) => i.menu_item_id).filter(Boolean))];
    const menuItems = menuItemIds.length ? await db('menu_items').whereIn('id', menuItemIds) : [];

    const menuById = new Map(menuItems.map((mi) => [mi.id, mi]));

    const responseItems = items.map((item) => {
      const menuItem = menuById.get(item.menu_item_id) || {};
      return {
        orderItemId: item.id,
        menuItem: {
          id: menuItem.id || item.menu_item_id,
          name: menuItem.name || item.item_name_snapshot || 'Item',
          description: menuItem.description || '',
          price: Number(menuItem.price || item.unit_price_snapshot || 0),
          originalPrice: Number(menuItem.mrp || item.mrp_snapshot || menuItem.price || 0),
          image: menuItem.image_url || null,
          tags: menuItem.dietary_type ? [menuItem.dietary_type] : []
        },
        quantity: Number(item.quantity || 1),
        selectedAddons: [],
        itemTotal: Number(item.subtotal || (item.unit_price_snapshot || 0) * (item.quantity || 1)),
        status: item.status || 'pending',
        orderedAt: item.created_at
      };
    });

    res.json(responseItems);
  } catch (error) {
    next(error);
  }
};
