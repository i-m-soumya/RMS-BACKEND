import { v4 as uuidv4 } from 'uuid';
import db from '../../db/connection.js';
import { getTableColumns, insertUsingKnownColumns } from '../../db/tableMeta.js';
import { broadcastKitchenOrderCreated, broadcastOrderStatusChanged } from '../../socket/index.js';
import { assertOtpVerified } from '../../services/otpService.js';
import { applySinceFilter, buildSinceCursor } from '../../services/reconnectState.js';
import { isItemCurrentlyAvailable } from './adminController.js';
import { emitNotification } from '../../services/notifications.js';

async function insertUsingKnownColumnsWithTransaction(trx, tableName, data) {
  const columns = await getTableColumns(tableName);
  const payload = Object.fromEntries(Object.entries(data).filter(([key, value]) => columns.has(key) && value !== undefined));
  return trx(tableName).insert(payload);
}

async function getOrCreateGuestCustomer(trx = db) {
  const customerId = uuidv4();
  await insertUsingKnownColumnsWithTransaction(trx, 'customers', {
    id: customerId,
    name: 'Guest User',
    is_registered: 0,
    created_at: new Date(),
    updated_at: new Date()
  });
  return customerId;
}

async function getOrCreateVerifiedCustomer(mobile, trx = db) {
  const normalizedMobile = String(mobile).replace(/\D/g, '');
  const [existingCustomer] = await trx('customers')
    .where({ phone: normalizedMobile })
    .whereNull('deleted_at')
    .select('id')
    .limit(1);

  if (existingCustomer) {
    await trx('customers').where({ id: existingCustomer.id }).update({
      is_registered: 1,
      updated_at: new Date(),
    });
    return existingCustomer.id;
  }

  const customerId = uuidv4();
  await insertUsingKnownColumnsWithTransaction(trx, 'customers', {
    id: customerId,
    phone: normalizedMobile,
    name: null,
    is_registered: 1,
    created_at: new Date(),
    updated_at: new Date(),
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

export const updateOrderStatus = async (req, res, next) => {
  try {
    const restaurantId = req.user?.restaurantId;
    const { order_id: orderId } = req.params;
    const { status } = req.body || {};

    if (!restaurantId) {
      return res.status(403).json({ error: 'Restaurant context is required' });
    }

    if (!status || !['confirmed', 'preparing', 'ready'].includes(String(status).toLowerCase())) {
      return res.status(400).json({ error: 'A valid status is required' });
    }

    const [existingOrder] = await db('orders')
      .where({ id: orderId, restaurant_id: restaurantId })
      .select('id', 'status', 'updated_at')
      .limit(1);

    if (!existingOrder) {
      return res.status(404).json({ error: 'Order not found' });
    }

    const normalizedStatus = String(status).toLowerCase();
    const currentStatus = String(existingOrder.status || '').toLowerCase();

    if (normalizedStatus === 'preparing' && currentStatus !== 'confirmed') {
      return res.status(409).json({ error: 'Only confirmed orders can move to preparing' });
    }

    if (normalizedStatus === 'ready' && currentStatus !== 'preparing') {
      return res.status(409).json({ error: 'Only preparing orders can move to ready' });
    }

    const updatedAt = new Date();
    await db('orders')
      .where({ id: orderId, restaurant_id: restaurantId })
      .update({ status: normalizedStatus, updated_at: updatedAt });
    await db('order_items').where({ order_id: orderId }).update({
      status: normalizedStatus,
      updated_at: updatedAt
    });

    const [updatedOrder] = await db('orders')
      .where({ id: orderId, restaurant_id: restaurantId })
      .select('id', 'status', 'created_at', 'updated_at', 'restaurant_id', 'session_id')
      .limit(1);

    const [orderTable] = await db('sessions')
      .join('tables', 'sessions.table_id', 'tables.id')
      .where('sessions.id', updatedOrder.session_id)
      .select('tables.table_number')
      .limit(1);
    const [restaurantRow] = await db('restaurants')
      .where({ id: updatedOrder.restaurant_id })
      .select('slug')
      .limit(1);

    broadcastOrderStatusChanged(restaurantRow?.slug, {
      orderId: updatedOrder.id,
      sessionId: updatedOrder.session_id,
      status: updatedOrder.status,
      table_number: orderTable?.table_number ?? null,
      created_at: updatedOrder.created_at,
      updated_at: updatedOrder.updated_at,
    });

    res.json({
      success: true,
      data: updatedOrder,
      status: updatedOrder.status,
    });
  } catch (error) {
    next(error);
  }
};

export const getPendingWaiterOrders = async (req, res, next) => {
  try {
    const restaurantId = req.user.restaurantId;
    if (!restaurantId) {
      return res.status(403).json({ error: 'Restaurant context is required' });
    }

    const orders = await db('orders')
      .join('sessions', 'orders.session_id', 'sessions.id')
      .join('tables', 'sessions.table_id', 'tables.id')
      .where({
        'orders.restaurant_id': restaurantId,
        'orders.status': 'pending',
        'orders.placed_by': 'customer'
      })
      .select(
        'orders.id as order_id',
        'orders.session_id',
        'orders.created_at',
        'orders.rejection_reason',
        'sessions.join_code',
        'sessions.opened_at as session_opened_at',
        'sessions.table_id as table_id',
        'tables.table_number'
      )
      .orderBy('orders.created_at', 'asc');

    if (orders.length === 0) {
      return res.json({ data: [] });
    }

    const tableIds = [...new Set(orders.map((order) => order.table_id))];
    const sessionRows = await db('sessions')
      .where({ restaurant_id: restaurantId })
      .whereIn('table_id', tableIds)
      .select('id', 'table_id', 'opened_at', 'created_at')
      .orderBy('opened_at', 'asc');
    const sessionOrdinalById = new Map();
    const sessionCountByTable = new Map();
    sessionRows.forEach((session) => {
      const ordinal = (sessionCountByTable.get(session.table_id) || 0) + 1;
      sessionCountByTable.set(session.table_id, ordinal);
      sessionOrdinalById.set(session.id, ordinal);
    });

    const orderIds = orders.map((order) => order.order_id);
    const items = await db('order_items')
      .whereIn('order_id', orderIds)
      .select('id', 'order_id', 'item_name_snapshot', 'quantity', 'notes');
    const itemIds = items.map((item) => item.id);
    const addons = itemIds.length
      ? await db('order_item_addons')
        .whereIn('order_item_id', itemIds)
        .select('order_item_id', 'addon_name_snapshot', 'quantity')
      : [];

    const itemsByOrder = new Map();
    items.forEach((item) => {
      const orderItems = itemsByOrder.get(item.order_id) || [];
      orderItems.push({
        item_id: item.id,
        name: item.item_name_snapshot,
        quantity: Number(item.quantity),
        notes: item.notes,
        addons: addons
          .filter((addon) => addon.order_item_id === item.id)
          .map((addon) => ({ name: addon.addon_name_snapshot, quantity: Number(addon.quantity) }))
      });
      itemsByOrder.set(item.order_id, orderItems);
    });

    res.json({
      data: orders.map((order) => ({
        order_id: order.order_id,
        session_id: order.session_id,
        table_id: order.table_id,
        table_number: order.table_number,
        session_ordinal: sessionOrdinalById.get(order.session_id) || 1,
        join_code: order.join_code,
        session_opened_at: order.session_opened_at,
        created_at: order.created_at,
        items: itemsByOrder.get(order.order_id) || []
      }))
    });
  } catch (error) {
    next(error);
  }
};

export const confirmWaiterOrder = async (req, res, next) => {
  try {
    const restaurantId = req.user.restaurantId;
    const staffId = req.user.id;
    const { order_id: orderId } = req.params;
    if (!restaurantId) {
      return res.status(403).json({ error: 'Restaurant context is required' });
    }

    await db.transaction(async (trx) => {
      const [order] = await trx('orders')
        .where({ id: orderId, restaurant_id: restaurantId, status: 'pending', placed_by: 'customer' })
        .select('id')
        .limit(1);
      if (!order) {
        const error = new Error('Pending customer order not found');
        error.status = 404;
        throw error;
      }

      await trx('orders').where({ id: orderId }).update({
        status: 'confirmed',
        confirmed_at: new Date(),
        updated_at: new Date()
      });
      await trx('order_items').where({ order_id: orderId, status: 'pending' }).update({
        status: 'confirmed',
        updated_at: new Date()
      });
      await trx('staff_activity_log').insert({
        id: uuidv4(),
        restaurant_id: restaurantId,
        staff_id: staffId,
        action_type: 'order_confirmed',
        reference_type: 'order',
        reference_id: orderId,
        created_at: new Date()
      });
    });

    const [statusContext] = await db('orders')
      .join('sessions', 'orders.session_id', 'sessions.id')
      .join('restaurants', 'orders.restaurant_id', 'restaurants.id')
      .where('orders.id', orderId)
      .select('orders.restaurant_id', 'sessions.id as session_id', 'restaurants.slug')
      .limit(1);
    broadcastOrderStatusChanged(statusContext?.slug, {
      orderId,
      sessionId: statusContext?.session_id,
      status: 'confirmed'
    });

    await emitNotification({
      restaurantId: statusContext?.restaurant_id,
      eventType: 'order:confirmed',
      payload: {
        order_id: orderId,
        session_id: statusContext?.session_id,
        status: 'confirmed',
      },
      targetRole: 'chef',
    });

    res.json({ success: true, order_id: orderId, status: 'confirmed' });
  } catch (error) {
    next(error);
  }
};

export const createWaiterDirectOrder = async (req, res, next) => {
  try {
    const restaurantId = req.user.restaurantId;
    const staffId = req.user.id;
    const { session_id: sessionId } = req.params;
    const { items: requestedItems } = req.body;
    if (!restaurantId) return res.status(403).json({ error: 'Restaurant context is required' });

    const result = await db.transaction(async (trx) => {
      const [session] = await trx('sessions').where({ id: sessionId, restaurant_id: restaurantId }).forUpdate().limit(1);
      if (!session) {
        const error = new Error('Session not found');
        error.status = 404;
        throw error;
      }
      if (session.status !== 'active') {
        const error = new Error('Orders can only be added to an active session');
        error.status = 409;
        throw error;
      }
      const [table] = await trx('tables').where({ id: session.table_id, restaurant_id: restaurantId }).select('table_number').limit(1);

      const menuItemIds = [...new Set(requestedItems.map((item) => item.menu_item_id))];
      const menuItems = await trx('menu_items')
        .where('restaurant_id', restaurantId)
        .whereIn('id', menuItemIds)
        .where('is_available', 1)
        .whereNull('deleted_at');
      const menuById = new Map(menuItems.map((item) => [item.id, item]));
      const details = [];
      const errors = [];
      requestedItems.forEach((requestedItem, index) => {
        const menuItem = menuById.get(requestedItem.menu_item_id);
        if (!menuItem) {
          errors.push({ path: ['items', index, 'menu_item_id'], message: 'Menu item is unavailable or invalid' });
          return;
        }
        if (requestedItem.spice_level && !menuItem.spice_level) {
          errors.push({ path: ['items', index, 'spice_level'], message: 'Spice selection is not applicable to this item' });
          return;
        }
        details.push({ requestedItem, menuItem, index });
      });
      const availability = await Promise.all(details.map(async ({ requestedItem }) => ({
        id: requestedItem.menu_item_id,
        available: await isItemCurrentlyAvailable(requestedItem.menu_item_id, new Date(), trx),
      })));
      availability.filter((item) => !item.available).forEach((item) => {
        const index = requestedItems.findIndex((requestedItem) => requestedItem.menu_item_id === item.id);
        errors.push({ path: ['items', index, 'menu_item_id'], message: 'Menu item is currently unavailable' });
      });
      const addonIds = [...new Set(requestedItems.flatMap((item) => item.addon_ids || []))];
      const addonRows = addonIds.length
        ? await trx('menu_addons')
          .where({ restaurant_id: restaurantId, is_available: 1 })
          .whereIn('id', addonIds)
          .whereNull('deleted_at')
        : [];
      const addonById = new Map(addonRows.map((addon) => [addon.id, addon]));
      const mapRows = addonIds.length ? await trx('menu_item_addon_map').where({ restaurant_id: restaurantId }).whereIn('addon_id', addonIds).whereNull('deleted_at') : [];
      const mappedAddons = new Set(mapRows.map((row) => `${row.menu_item_id}:${row.addon_id}`));
      details.forEach(({ requestedItem, index }) => {
        (requestedItem.addon_ids || []).forEach((addonId) => {
          if (!addonById.has(addonId) || !mappedAddons.has(`${requestedItem.menu_item_id}:${addonId}`)) {
            errors.push({ path: ['items', index, 'addon_ids'], message: `Add-on ${addonId} is not available for this item` });
          }
        });
      });
      if (errors.length) {
        const error = new Error('One or more order items could not be added');
        error.status = 422;
        error.code = 'DIRECT_ORDER_ITEM_VALIDATION_ERROR';
        error.details = errors;
        throw error;
      }

      const customerId = await getOrCreateGuestCustomer(trx);
      const orderId = uuidv4();
      const now = new Date();
      const orderItems = [];
      let total = 0;
      for (const { requestedItem, menuItem } of details) {
        const addonRowsForItem = (requestedItem.addon_ids || []).map((addonId) => addonById.get(addonId));
        const addonTotal = addonRowsForItem.reduce((sum, addon) => sum + Number(addon.price), 0);
        const subtotal = Number((Number(menuItem.price) * requestedItem.quantity).toFixed(2));
        total += subtotal + addonTotal * requestedItem.quantity;
        orderItems.push({ requestedItem, menuItem, addonRows: addonRowsForItem, subtotal });
      }
      const orderPayload = {
        id: orderId,
        restaurant_id: restaurantId,
        session_id: sessionId,
        customer_id: customerId,
        placed_by: 'waiter',
        placed_by_staff_id: staffId,
        status: 'confirmed',
        confirmed_at: now,
        table_label: table?.table_number || session.table_id,
        is_direct_order: 1,
        total: Number(total.toFixed(2)),
        created_at: now,
        updated_at: now,
      };
      await insertUsingKnownColumnsWithTransaction(trx, 'orders', orderPayload);
      for (const { requestedItem, menuItem, addonRows, subtotal } of orderItems) {
        const orderItemId = uuidv4();
        await insertUsingKnownColumnsWithTransaction(trx, 'order_items', {
          id: orderItemId,
          order_id: orderId,
          menu_item_id: menuItem.id,
          item_name_snapshot: menuItem.name,
          mrp_snapshot: menuItem.mrp,
          unit_price_snapshot: menuItem.price,
          discount_amount_snapshot: menuItem.discount_amount,
          discount_percentage_snapshot: menuItem.discount_percentage,
          quantity: requestedItem.quantity,
          spice_level: requestedItem.spice_level || null,
          notes: requestedItem.notes || null,
          status: 'confirmed',
          subtotal,
          created_at: now,
          updated_at: now,
        });
        for (const addon of addonRows) {
          await insertUsingKnownColumnsWithTransaction(trx, 'order_item_addons', {
            id: uuidv4(), order_item_id: orderItemId, addon_id: addon.id,
            addon_name_snapshot: addon.name, addon_price_snapshot: addon.price,
            quantity: 1, created_at: now,
          });
        }
      }
      await trx('staff_activity_log').insert({ id: uuidv4(), restaurant_id: restaurantId, staff_id: staffId, action_type: 'direct_order_placed', reference_type: 'order', reference_id: orderId, notes: 'Waiter placed a direct order', created_at: now });
      return { order_id: orderId, status: 'confirmed', total: Number(total.toFixed(2)) };
    });
    const [context] = await db('orders as o').join('restaurants as r', 'r.id', 'o.restaurant_id').where('o.id', result.order_id).select('r.slug', 'o.session_id');
    broadcastKitchenOrderCreated(context?.slug, { orderId: result.order_id, sessionId: context?.session_id, status: 'confirmed' });
    res.status(201).json({ data: result });
  } catch (error) {
    next(error);
  }
};

export const rejectWaiterOrder = async (req, res, next) => {
  try {
    const restaurantId = req.user.restaurantId;
    const staffId = req.user.id;
    const { order_id: orderId } = req.params;
    const result = await db.transaction(async (trx) => {
      const [order] = await trx('orders').where({ id: orderId, restaurant_id: restaurantId }).forUpdate().first();
      if (!order) { const error = new Error('Order not found'); error.status = 404; throw error; }
      if (order.status !== 'pending') { const error = new Error('Only pending orders can be rejected'); error.status = 409; throw error; }
      const now = new Date();
      const reason = req.body?.reason?.trim() || null;
      await trx('orders').where({ id: orderId, restaurant_id: restaurantId }).update({ status: 'rejected', rejected_by: 'waiter', rejected_by_staff_id: staffId, rejection_reason: reason, rejected_at: now, updated_at: now });
      await trx('order_items').where({ order_id: orderId }).update({ status: 'rejected', rejection_reason: reason, rejected_by_staff_id: staffId, updated_at: now });
      await trx('staff_activity_log').insert({ id: uuidv4(), restaurant_id: restaurantId, staff_id: staffId, action_type: 'order_rejected', reference_type: 'order', reference_id: orderId, notes: reason, created_at: now });
      return { order_id: orderId, customer_id: order.customer_id, session_id: order.session_id };
    });
    await emitNotification({ restaurantId, eventType: 'order:rejected', payload: { order_id: result.order_id, session_id: result.session_id, reason: req.body?.reason?.trim() || null }, targetCustomerId: result.customer_id });
    return res.json({ success: true, order_id: orderId, status: 'rejected' });
  } catch (error) { return next(error); }
};

export const createOrder = async (req, res, next) => {
  try {
    const { sessionId, tableId, restaurantId, cartItems = [], mobile, otpVerificationToken } = req.body;

    if (req.customerUser) {
      if (mobile && mobile !== req.customerUser.mobile) {
        const error = new Error('Order mobile does not match the verified customer token');
        error.status = 422;
        error.code = 'CUSTOMER_MOBILE_MISMATCH';
        throw error;
      }
    } else {
      assertOtpVerified(mobile, otpVerificationToken);
    }

    if (!Array.isArray(cartItems) || cartItems.length === 0) {
      return res.status(400).json({ error: 'cartItems must contain at least one item' });
    }

    const session = await resolveSession({ sessionId, tableId });
    if (!session) {
      return res.status(404).json({ error: 'Active session not found' });
    }

    if (session.status !== 'active') {
      return res.status(409).json({ code: 'SESSION_NOT_ACTIVE', error: 'This table session is not accepting orders.' });
    }

    if ((restaurantId && restaurantId !== session.restaurant_id) || (tableId && tableId !== session.table_id)) {
      return res.status(403).json({ error: 'The order restaurant and table must match the active session.' });
    }

    const effectiveRestaurantId = session.restaurant_id;
    const [table] = await db('tables').where({ id: session.table_id }).limit(1);

    const customerId = req.customerUser?.id || req.user?.id || (await getOrCreateVerifiedCustomer(mobile));
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
      status: 'occupied',
      updated_at: new Date()
    });

    const [restaurantRow] = await db('restaurants').where({ id: effectiveRestaurantId }).select('slug').limit(1);
    const restaurantSlug = restaurantRow?.slug;
    const [tableRow] = await db('tables').where({ id: session.table_id }).select('table_number').limit(1);

    if (restaurantSlug) {
      broadcastKitchenOrderCreated(restaurantSlug, {
        order_id: orderId,
        table_number: tableRow?.table_number ?? null,
        status: 'pending',
        created_at: new Date().toISOString(),
        notes: req.body?.notes || null,
        items: cartItems.map((item) => ({
          name: item.menuItem?.name || 'Item',
          quantity: Number(item.quantity || 1),
          notes: item.specialInstructions || null,
        }))
      });

      await emitNotification({
        restaurantId: effectiveRestaurantId,
        eventType: 'order:new',
        payload: {
          order_id: orderId,
          session_id: session.id,
          table_number: tableRow?.table_number ?? null,
          created_at: new Date().toISOString(),
          items: cartItems.map((item) => ({
            name: item.menuItem?.name || 'Item',
            quantity: Number(item.quantity || 1),
            notes: item.specialInstructions || null,
          })),
        },
        targetRole: 'waiter',
      });
    }

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
    const { since } = req.query || {};

    const sessionOrders = await db('orders')
      .where({ session_id: id })
      .orderBy('created_at', 'desc');

    const cursor = buildSinceCursor(since);
    const filteredOrders = cursor ? applySinceFilter(sessionOrders, cursor) : sessionOrders;

    if (filteredOrders.length === 0) {
      return res.json([]);
    }

    const orderIds = filteredOrders.map((o) => o.id);
    const items = await db('order_items').whereIn('order_id', orderIds);
    const menuItemIds = [...new Set(items.map((i) => i.menu_item_id).filter(Boolean))];
    const menuItems = menuItemIds.length ? await db('menu_items').whereIn('id', menuItemIds) : [];

    const menuById = new Map(menuItems.map((mi) => [mi.id, mi]));

    const responseItems = items.map((item) => {
      const menuItem = menuById.get(item.menu_item_id) || {};
      const parentOrder = filteredOrders.find((order) => order.id === item.order_id);
      const effectiveStatus = parentOrder?.status === 'confirmed' && item.status === 'pending'
        ? 'confirmed'
        : item.status || parentOrder?.status || 'pending';
      return {
        orderId: item.order_id,
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
        status: effectiveStatus,
        orderedAt: item.created_at
      };
    });

    res.json(responseItems);
  } catch (error) {
    next(error);
  }
};
