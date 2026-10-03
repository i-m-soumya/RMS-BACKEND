import { v4 as uuidv4 } from 'uuid';
import db from '../../db/connection.js';
import { insertUsingKnownColumns } from '../../db/tableMeta.js';
import { broadcastTablesChanged } from '../../socket/index.js';
import { emitNotification } from '../../services/notifications.js';

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

function itemStatusForBill(status) {
  return status !== 'rejected';
}

function billableItems(items) {
  return items.filter((item) => itemStatusForBill(item.status));
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

  export const getWaiterBillPreview = async (req, res, next) => {
    try {
      const restaurantId = req.user.restaurantId;
      const { session_id: sessionId } = req.params;
      if (!restaurantId) return res.status(403).json({ error: 'Restaurant context is required' });

      const [session] = await db('sessions').where({ id: sessionId, restaurant_id: restaurantId }).select('id').limit(1);
      if (!session) return res.status(404).json({ error: 'Session not found' });

      const orders = await db('orders')
        .where({ session_id: sessionId, restaurant_id: restaurantId })
        .select('id', 'status', 'created_at', 'rejection_reason')
        .orderBy('created_at', 'desc');
      const orderIds = orders.map((order) => order.id);
      const items = orderIds.length
        ? await db('order_items').whereIn('order_id', orderIds).select('id', 'order_id', 'item_name_snapshot', 'quantity', 'subtotal', 'status', 'rejection_reason')
        : [];
      const itemIds = items.map((item) => item.id);
      const addons = itemIds.length
        ? await db('order_item_addons').whereIn('order_item_id', itemIds).select('order_item_id', 'addon_name_snapshot', 'addon_price_snapshot', 'quantity')
        : [];
      const itemsByOrder = new Map();
      items.forEach((item) => {
        const orderItems = itemsByOrder.get(item.order_id) || [];
        orderItems.push({
          id: item.id,
          name: item.item_name_snapshot,
          quantity: Number(item.quantity),
          subtotal: Number(item.subtotal),
          status: item.status,
          rejection_reason: item.rejection_reason,
          addons: addons.filter((addon) => addon.order_item_id === item.id).map((addon) => ({
            name: addon.addon_name_snapshot,
            price: Number(addon.addon_price_snapshot),
            quantity: Number(addon.quantity)
          }))
        });
        itemsByOrder.set(item.order_id, orderItems);
      });

      const orderData = orders.map((order) => ({
        id: order.id,
        status: order.status,
        created_at: order.created_at,
        rejection_reason: order.rejection_reason,
        items: itemsByOrder.get(order.id) || []
      }));
      const included = orderData.filter((order) => order.status === 'served');
      const pending = orderData.filter((order) => ['pending', 'confirmed', 'preparing', 'ready'].includes(order.status));
      const rejected = orderData.filter((order) => ['rejected', 'excluded_from_bill'].includes(order.status));
      const subtotal = Number(included.reduce((sum, order) => sum + billableItems(order.items).reduce((itemSum, item) => itemSum + item.subtotal, 0), 0).toFixed(2));
      const [taxConfig] = await db('restaurant_tax_config').where({ restaurant_id: restaurantId }).select('gst_rate', 'cgst_rate', 'sgst_rate').limit(1);
      const gstRate = Number(taxConfig?.gst_rate || 0);
      const cgstRate = Number(taxConfig?.cgst_rate || 0);
      const sgstRate = Number(taxConfig?.sgst_rate || 0);
      const cgstAmount = Number((subtotal * cgstRate / 100).toFixed(2));
      const sgstAmount = Number((subtotal * sgstRate / 100).toFixed(2));

      res.json({
        data: {
          session_id: sessionId,
          included,
          pending,
          rejected,
          subtotal,
          gst: {
            rate: gstRate,
            cgst_rate: cgstRate,
            cgst_amount: cgstAmount,
            sgst_rate: sgstRate,
            sgst_amount: sgstAmount,
            total: Number((cgstAmount + sgstAmount).toFixed(2))
          },
          total: Number((subtotal + cgstAmount + sgstAmount).toFixed(2))
        }
      });
    } catch (error) {
      next(error);
    }
  };

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

function getFinancialYear(date = new Date()) {
  const year = date.getFullYear();
  const startYear = date.getMonth() >= 3 ? year : year - 1;
  return `${String(startYear).slice(-2)}-${String(startYear + 1).slice(-2)}`;
}

export const generateWaiterBill = async (req, res, next) => {
  try {
    const restaurantId = req.user.restaurantId;
    const staffId = req.user.id;
    const { session_id: sessionId } = req.params;
    const requestedIncludedOrderIds = Array.isArray(req.body?.included_order_ids) ? req.body.included_order_ids : null;
    if (!restaurantId) return res.status(403).json({ error: 'Restaurant context is required' });

    const result = await db.transaction(async (trx) => {
      const [session] = await trx('sessions')
        .where({ id: sessionId, restaurant_id: restaurantId })
        .forUpdate()
        .limit(1);
      if (!session) {
        const error = new Error('Session not found');
        error.status = 404;
        throw error;
      }
      if (session.status === 'closed') {
        const error = new Error('Session is already closed');
        error.status = 409;
        throw error;
      }

      const [restaurant] = await trx('restaurants').where({ id: restaurantId }).limit(1);
      const [taxConfig] = await trx('restaurant_tax_config').where({ restaurant_id: restaurantId }).limit(1);
      const orders = await trx('orders').where({ session_id: sessionId, restaurant_id: restaurantId }).orderBy('created_at', 'asc');
      const orderIds = orders.map((order) => order.id);
      const items = orderIds.length ? await trx('order_items').whereIn('order_id', orderIds).orderBy('created_at', 'asc') : [];
      const itemIds = items.map((item) => item.id);
      const addons = itemIds.length ? await trx('order_item_addons').whereIn('order_item_id', itemIds) : [];
      const includedIds = new Set(requestedIncludedOrderIds || orders.filter((order) => order.status === 'served').map((order) => order.id));
      const includedOrders = orders.filter((order) => includedIds.has(order.id) && order.status === 'served');
      const subtotal = Number(includedOrders.reduce((sum, order) => sum + billableItems(items.filter((item) => item.order_id === order.id)).reduce((itemSum, item) => itemSum + Number(item.subtotal || 0), 0), 0).toFixed(2));
      const cgstRate = Number(taxConfig?.cgst_rate || 0);
      const sgstRate = Number(taxConfig?.sgst_rate || 0);
      const cgstAmount = Number((subtotal * cgstRate / 100).toFixed(2));
      const sgstAmount = Number((subtotal * sgstRate / 100).toFixed(2));
      const totalTaxAmount = Number((cgstAmount + sgstAmount).toFixed(2));
      const totalAmount = Number((subtotal + totalTaxAmount).toFixed(2));
      const financialYear = getFinancialYear();
      let [sequence] = await trx('invoice_sequences').where({ restaurant_id: restaurantId, financial_year: financialYear }).forUpdate().limit(1);
      if (!sequence) {
        await trx('invoice_sequences').insert({ id: uuidv4(), restaurant_id: restaurantId, financial_year: financialYear, last_sequence_number: 0, created_at: new Date(), updated_at: new Date() });
        [sequence] = await trx('invoice_sequences').where({ restaurant_id: restaurantId, financial_year: financialYear }).forUpdate().limit(1);
      }
      const sequenceNumber = Number(sequence.last_sequence_number) + 1;
      await trx('invoice_sequences').where({ id: sequence.id }).update({ last_sequence_number: sequenceNumber, updated_at: new Date() });
      const invoiceNumber = `${String(restaurant.slug || restaurantId).toUpperCase().slice(0, 12)}-${financialYear}-${String(sequenceNumber).padStart(5, '0')}`;
      const billId = uuidv4();

      await trx('bills').insert({
        id: billId,
        restaurant_id: restaurantId,
        session_id: sessionId,
        parent_bill_id: null,
        bill_version: 1,
        is_active: 1,
        generated_by_staff_id: staffId,
        invoice_number: invoiceNumber,
        financial_year: financialYear,
        restaurant_name_snapshot: restaurant.name,
        restaurant_legal_name_snapshot: restaurant.legal_name,
        restaurant_address_snapshot: restaurant.registered_address || restaurant.address,
        restaurant_gstin_snapshot: restaurant.gstin,
        restaurant_sac_code_snapshot: restaurant.sac_code,
        subtotal,
        gst_rate_snapshot: Number(taxConfig?.gst_rate || 0),
        cgst_rate_snapshot: cgstRate,
        sgst_rate_snapshot: sgstRate,
        igst_rate_snapshot: Number(taxConfig?.igst_rate || 0),
        cgst_amount: cgstAmount,
        sgst_amount: sgstAmount,
        igst_amount: 0,
        total_tax_amount: totalTaxAmount,
        total_amount: totalAmount,
        payment_status: 'pending',
        created_at: new Date(),
        updated_at: new Date()
      });

      for (const order of orders) {
        const isIncluded = includedOrders.some((includedOrder) => includedOrder.id === order.id);
        await trx('bill_orders').insert({ id: uuidv4(), bill_id: billId, order_id: order.id, inclusion_status: isIncluded ? 'included' : 'excluded', excluded_reason: isIncluded ? null : (order.status === 'rejected' ? 'Order rejected' : 'Not served at bill generation'), created_at: new Date() });
        if (!isIncluded) continue;
        for (const item of items.filter((candidate) => candidate.order_id === order.id && itemStatusForBill(candidate.status))) {
          const itemAddons = addons.filter((addon) => addon.order_item_id === item.id);
          const addonsTotal = Number(itemAddons.reduce((sum, addon) => sum + Number(addon.addon_price_snapshot || 0) * Number(addon.quantity || 1), 0).toFixed(2));
          const lineId = uuidv4();
          await trx('bill_line_items').insert({ id: lineId, bill_id: billId, order_id: order.id, order_item_id: item.id, item_name: item.item_name_snapshot, mrp: item.mrp_snapshot, unit_price: item.unit_price_snapshot, discount_amount: item.discount_amount_snapshot || 0, discount_percentage: item.discount_percentage_snapshot || 0, quantity: item.quantity, item_subtotal: item.subtotal, addons_total: addonsTotal, line_total: Number(item.subtotal || 0) + addonsTotal, created_at: new Date() });
          for (const addon of itemAddons) {
            await trx('bill_line_item_addons').insert({ id: uuidv4(), bill_line_item_id: lineId, addon_name: addon.addon_name_snapshot, addon_price: addon.addon_price_snapshot, quantity: addon.quantity, addon_line_total: Number(addon.addon_price_snapshot) * Number(addon.quantity), created_at: new Date() });
          }
        }
      }

      await trx('sessions').where({ id: sessionId, restaurant_id: restaurantId }).update({ status: 'closed', closed_at: new Date(), updated_at: new Date() });
      await trx('staff_activity_log').insert({ id: uuidv4(), restaurant_id: restaurantId, staff_id: staffId, action_type: 'bill_generated', reference_type: 'bill', reference_id: billId, created_at: new Date() });
      return { bill_id: billId, invoice_number: invoiceNumber, subtotal, total_tax_amount: totalTaxAmount, total_amount: totalAmount };
    });

    const [restaurant] = await db('restaurants').where({ id: restaurantId }).select('slug').limit(1);
    broadcastTablesChanged(restaurant?.slug);

    await emitNotification({
      restaurantId,
      eventType: 'bill:requested',
      payload: {
        session_id: sessionId,
        bill_id: result.bill_id,
      },
      targetRole: 'waiter',
    });

    res.status(201).json({ data: result });
  } catch (error) {
    next(error);
  }
};

export const recordBillPayment = async (req, res, next) => {
  try {
    const restaurantId = req.user.restaurantId;
    const method = String(req.body?.paymentMethod || '').toLowerCase();
    if (!['cash', 'upi', 'card'].includes(method)) return res.status(400).json({ error: 'paymentMethod must be cash, upi, or card' });
    const result = await db.transaction(async (trx) => {
      const bill = await trx('bills').where({ id: req.params.bill_id, restaurant_id: restaurantId }).forUpdate().first();
      if (!bill) { const error = new Error('Bill not found'); error.status = 404; throw error; }
      if (!bill.is_active) { const error = new Error('Only the active bill can be paid'); error.status = 409; throw error; }
      if (bill.payment_status === 'paid') { const error = new Error('Bill is already paid'); error.status = 409; throw error; }
      await trx('bills').where({ id: bill.id }).update({ payment_status: 'paid', payment_method: method, paid_at: new Date(), updated_at: new Date() });
      return { bill_id: bill.id, payment_status: 'paid', payment_method: method };
    });
    return res.json({ data: result });
  } catch (error) { return next(error); }
};

export const getBillVersions = async (req, res, next) => {
  try {
    const restaurantId = req.user.restaurantId;
    const bill = await db('bills').where({ id: req.params.bill_id, restaurant_id: restaurantId }).select('id', 'session_id').first();
    if (!bill) return res.status(404).json({ error: 'Bill not found' });
    const versions = await db('bills').where({ session_id: bill.session_id, restaurant_id: restaurantId }).select('id', 'parent_bill_id', 'bill_version', 'invoice_number', 'is_active', 'payment_status', 'payment_method', 'subtotal', 'total_tax_amount', 'total_amount', 'created_at').orderBy('bill_version', 'asc');
    return res.json({ data: versions });
  } catch (error) { return next(error); }
};

export const amendBill = async (req, res, next) => {
  try {
    const restaurantId = req.user.restaurantId;
    const staffId = req.user.id;
    const selectedOrderIds = Array.isArray(req.body?.included_order_ids) ? req.body.included_order_ids : null;
    const result = await db.transaction(async (trx) => {
      const source = await trx('bills').where({ id: req.params.bill_id, restaurant_id: restaurantId }).forUpdate().first();
      if (!source) { const error = new Error('Bill not found'); error.status = 404; throw error; }
      if (!source.is_active) { const error = new Error('Only the active bill can be amended'); error.status = 409; throw error; }
      if (source.payment_status === 'paid') { const error = new Error('Paid bills cannot be amended'); error.status = 409; throw error; }
      const orders = await trx('orders').where({ session_id: source.session_id, restaurant_id: restaurantId });
      const included = orders.filter((order) => (selectedOrderIds ? selectedOrderIds.includes(order.id) : order.status === 'served'));
      const orderIds = included.map((order) => order.id);
      const items = orderIds.length ? await trx('order_items').whereIn('order_id', orderIds) : [];
      const itemIds = items.map((item) => item.id);
      const addons = itemIds.length ? await trx('order_item_addons').whereIn('order_item_id', itemIds) : [];
      const subtotal = Number(items.reduce((sum, item) => sum + Number(item.subtotal || 0), 0).toFixed(2));
      const tax = await trx('restaurant_tax_config').where({ restaurant_id: restaurantId }).first();
      const cgstRate = Number(tax?.cgst_rate || 0); const sgstRate = Number(tax?.sgst_rate || 0);
      const cgstAmount = Number((subtotal * cgstRate / 100).toFixed(2)); const sgstAmount = Number((subtotal * sgstRate / 100).toFixed(2));
      const billId = uuidv4(); const now = new Date();
      await trx('bills').where({ id: source.id }).update({ is_active: 0, updated_at: now });
      const version = Number(source.bill_version) + 1;
      // invoice_number is globally unique in the live schema, so amendments require a version suffix.
      const invoiceNumber = `${source.invoice_number}-V${version}`.slice(0, 30);
      await trx('bills').insert({ ...source, id: billId, parent_bill_id: source.id, bill_version: version, is_active: 1, generated_by_staff_id: staffId, invoice_number: invoiceNumber, subtotal, cgst_rate_snapshot: cgstRate, sgst_rate_snapshot: sgstRate, cgst_amount: cgstAmount, sgst_amount: sgstAmount, total_tax_amount: cgstAmount + sgstAmount, total_amount: subtotal + cgstAmount + sgstAmount, payment_status: 'pending', payment_method: null, paid_at: null, created_at: now, updated_at: now });
      for (const order of orders) {
        const isIncluded = included.some((candidate) => candidate.id === order.id);
        await trx('bill_orders').insert({ id: uuidv4(), bill_id: billId, order_id: order.id, inclusion_status: isIncluded ? 'included' : 'excluded', excluded_reason: isIncluded ? null : 'Not included in amended bill', created_at: now });
      }
      for (const item of items) {
        const itemAddons = addons.filter((addon) => addon.order_item_id === item.id); const addonTotal = itemAddons.reduce((sum, addon) => sum + Number(addon.addon_price_snapshot) * Number(addon.quantity || 1), 0); const lineId = uuidv4();
        await trx('bill_line_items').insert({ id: lineId, bill_id: billId, order_id: item.order_id, order_item_id: item.id, item_name: item.item_name_snapshot, mrp: item.mrp_snapshot, unit_price: item.unit_price_snapshot, discount_amount: item.discount_amount_snapshot || 0, discount_percentage: item.discount_percentage_snapshot || 0, quantity: item.quantity, item_subtotal: item.subtotal, addons_total: addonTotal, line_total: Number(item.subtotal) + addonTotal, created_at: now });
        for (const addon of itemAddons) await trx('bill_line_item_addons').insert({ id: uuidv4(), bill_line_item_id: lineId, addon_name: addon.addon_name_snapshot, addon_price: addon.addon_price_snapshot, quantity: addon.quantity, addon_line_total: Number(addon.addon_price_snapshot) * Number(addon.quantity || 1), created_at: now });
      }
      return { bill_id: billId, invoice_number: invoiceNumber, bill_version: version };
    });
    return res.status(201).json({ data: result });
  } catch (error) { return next(error); }
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

    const [restaurant] = await db('restaurants').where({ id: effectiveRestaurantId }).select('slug').limit(1);
    broadcastTablesChanged(restaurant?.slug);

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
