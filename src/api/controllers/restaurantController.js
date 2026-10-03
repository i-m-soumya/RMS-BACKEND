import db from '../../db/connection.js';
import { filterCurrentlyAvailableItems } from './adminController.js';
import { v4 as uuidv4 } from 'uuid';
import { insertUsingKnownColumns } from '../../db/tableMeta.js';

async function findRestaurantBySlug(slug) {
  let [restaurant] = await db('restaurants').where({ slug }).limit(1);
  if (!restaurant) {
    [restaurant] = await db('restaurants').where({ id: slug }).limit(1);
  }
  return restaurant || null;
}

function getGuestTokenFromRequest(req) {
  const cookieHeader = req.headers.cookie || '';
  const cookieToken = cookieHeader
    .split(';')
    .map((cookie) => cookie.trim())
    .find((cookie) => cookie.startsWith('guest_token='));

  if (cookieToken) {
    return decodeURIComponent(cookieToken.split('=')[1]);
  }

  const queryToken = req.query?.guest_token || req.query?.guestToken || req.headers['x-guest-token'];
  if (queryToken) {
    return String(queryToken);
  }

  return null;
}

async function getPublicRestaurantPayload(restaurant) {
  return {
    id: restaurant.id,
    name: restaurant.name,
    slug: restaurant.slug,
    logo_url: restaurant.logo_url || null,
    welcome_message: restaurant.welcome_message || null,
    status: restaurant.status,
  };
}

export function getPublicRestaurantAvailability(status) {
  return status === 'active'
    ? { available: true }
    : { available: false, status: 410, code: 'RESTAURANT_UNAVAILABLE' };
}

async function resolveActiveSessionForRestaurantTable(restaurantId, tableId) {
  const [session] = await db('sessions')
    .where({ restaurant_id: restaurantId, table_id: tableId })
    .whereIn('status', ['active', 'bill_requested'])
    .orderBy('opened_at', 'desc')
    .limit(1);

  return session || null;
}

async function findRestaurantTable(restaurantId, tableNumber) {
  const numericTableNumber = String(tableNumber ?? '').trim();
  if (!numericTableNumber) {
    return null;
  }

  const hasIsActiveColumn = await db.schema.hasColumn('tables', 'is_active');
  const hasDeletedAtColumn = await db.schema.hasColumn('tables', 'deleted_at');

  const query = db('tables')
    .where({ restaurant_id: restaurantId })
    .whereRaw('LOWER(CAST(table_number AS CHAR)) = ?', [numericTableNumber.toLowerCase()])
    .limit(1);

  if (hasIsActiveColumn) {
    query.where('is_active', 1);
  }

  if (hasDeletedAtColumn) {
    query.whereNull('deleted_at');
  }

  const [table] = await query;
  return table || null;
}

export const getRestaurant = async (req, res, next) => {
  try {
    const { slug } = req.params;
    const restaurant = await findRestaurantBySlug(slug);

    if (!restaurant) {
      return res.status(404).json({ code: 'RESTAURANT_NOT_FOUND', message: 'Restaurant not found' });
    }

    const availability = getPublicRestaurantAvailability(restaurant.status);
    if (!availability.available) {
      return res.status(availability.status).json({ code: availability.code, message: 'Restaurant is currently unavailable' });
    }

    res.json(await getPublicRestaurantPayload(restaurant));
  } catch (error) {
    next(error);
  }
};

export const getRestaurantMenu = async (req, res, next) => {
  try {
    const { slug } = req.params;
    const restaurant = await findRestaurantBySlug(slug);

    if (!restaurant) {
      return res.status(404).json({ code: 'RESTAURANT_NOT_FOUND', message: 'Restaurant not found' });
    }

    if (restaurant.status !== 'active') {
      return res.status(410).json({ code: 'RESTAURANT_UNAVAILABLE', message: 'Restaurant is currently unavailable' });
    }

    const categories = await db('menu_categories')
      .where({ restaurant_id: restaurant.id })
      .where('is_active', 1)
      .whereNull('deleted_at')
      .orderBy('display_order', 'asc');

    const items = await db('menu_items')
      .where({ restaurant_id: restaurant.id })
      .where('is_available', 1)
      .whereNull('deleted_at');
    const availableItems = await filterCurrentlyAvailableItems(items, new Date(), db);

    const itemIds = availableItems.map((item) => item.id);
    const addonRows = itemIds.length
      ? await db('menu_item_addon_map as map')
        .join('menu_addons as addon', 'addon.id', 'map.addon_id')
        .where('map.restaurant_id', restaurant.id)
        .whereIn('map.menu_item_id', itemIds)
        .whereNull('map.deleted_at')
        .where('addon.restaurant_id', restaurant.id)
        .where('addon.is_available', 1)
        .whereNull('addon.deleted_at')
        .select('map.menu_item_id', 'addon.id', 'addon.name', 'addon.price')
      : [];
    const addonsByItem = new Map();
    addonRows.forEach((addon) => {
      const itemAddons = addonsByItem.get(addon.menu_item_id) || [];
      itemAddons.push({ id: addon.id, name: addon.name, price: Number(addon.price) });
      addonsByItem.set(addon.menu_item_id, itemAddons);
    });

    const map = await db('menu_item_categories as mic')
      .join('menu_items as mapped_item', 'mapped_item.id', 'mic.menu_item_id')
      .where('mic.restaurant_id', restaurant.id)
      .where('mic.is_active', 1)
      .whereNull('mic.deleted_at')
      .whereNull('mapped_item.deleted_at')
      .select('mic.category_id', 'mic.menu_item_id');

    const menu = categories.map((cat) => {
      const catItemIds = map.filter((m) => m.category_id === cat.id).map((m) => m.menu_item_id);
      return {
        ...cat,
        items: availableItems.filter((item) => catItemIds.includes(item.id)).map((item) => ({
          ...item,
          addons: addonsByItem.get(item.id) || [],
        })),
      };
    });

    res.json(menu);
  } catch (error) {
    next(error);
  }
};

export const getTable = async (req, res, next) => {
  try {
    const { slug, tableNumber } = req.params;
    const restaurant = await findRestaurantBySlug(slug);

    if (!restaurant) {
      return res.status(404).json({ code: 'RESTAURANT_NOT_FOUND', message: 'Restaurant not found' });
    }

    if (restaurant.status !== 'active') {
      return res.status(410).json({ code: 'RESTAURANT_UNAVAILABLE', message: 'Restaurant is currently unavailable' });
    }

    const table = await findRestaurantTable(restaurant.id, tableNumber);

    if (!table) {
      return res.status(404).json({ code: 'TABLE_NOT_FOUND', message: 'Table not found' });
    }

    res.json({
      ...table,
      table_id: table.id,
      table_number: table.table_number,
      is_active: Number(table.is_active ?? 1),
    });
  } catch (error) {
    next(error);
  }
};

export const getTableSession = async (req, res, next) => {
  try {
    const { slug, tableNumber } = req.params;
    const restaurant = await findRestaurantBySlug(slug);

    if (!restaurant) {
      return res.status(404).json({ code: 'RESTAURANT_NOT_FOUND', message: 'Restaurant not found' });
    }

    const table = await findRestaurantTable(restaurant.id, tableNumber);

    if (!table) {
      return res.status(404).json({ code: 'TABLE_NOT_FOUND', message: 'Table not found' });
    }

    const session = await resolveActiveSessionForRestaurantTable(restaurant.id, table.id);

    if (!session) {
      return res.json({ session: null });
    }

    return res.json({
      session: {
        id: session.id,
        status: session.status,
        opened_at: session.opened_at,
      },
    });
  } catch (error) {
    next(error);
  }
};

export const createGuestToken = async (req, res, next) => {
  try {
    const { slug, tableNumber } = req.params;
    const restaurant = await findRestaurantBySlug(slug);

    if (!restaurant) {
      return res.status(404).json({ code: 'RESTAURANT_NOT_FOUND', message: 'Restaurant not found' });
    }
    if (restaurant.status !== 'active') {
      return res.status(410).json({ code: 'RESTAURANT_UNAVAILABLE', message: 'Restaurant is currently unavailable' });
    }

    const table = await findRestaurantTable(restaurant.id, tableNumber);

    if (!table) {
      return res.status(404).json({ code: 'TABLE_NOT_FOUND', message: 'Table not found' });
    }

    const guestToken = getGuestTokenFromRequest(req);
    const now = new Date();
    const session = await resolveActiveSessionForRestaurantTable(restaurant.id, table.id);
    if (!session || session.status !== 'active') {
      return res.status(409).json({ code: 'TABLE_SESSION_NOT_OPEN', message: 'Ask your waiter to open this table before placing an order.' });
    }

    let customerId = guestToken
      ? (await db('customer_guest_tokens').where({ token: guestToken, restaurant_id: restaurant.id, session_id: session.id }).where('expires_at', '>', now).select('customer_id').limit(1)).at(0)?.customer_id
      : null;

    if (guestToken) {
      const [existingToken] = await db('customer_guest_tokens')
        .where({ token: guestToken, restaurant_id: restaurant.id, session_id: session.id })
        .where('expires_at', '>', now)
        .limit(1);

      if (existingToken) {
        const [member] = await db('session_members')
          .where({ session_id: session.id, customer_id: existingToken.customer_id })
          .limit(1);

        if (!member) {
          await db('session_members').insert({
            id: uuidv4(),
            session_id: session.id,
            restaurant_id: restaurant.id,
            customer_id: existingToken.customer_id,
            is_registered: 0,
            joined_at: now,
          });
        }

        return res.json({ token: existingToken.token, customer_id: existingToken.customer_id, session_id: session.id });
      }
    }

    const newCustomerId = customerId || uuidv4();
    if (!customerId) {
      await db('customers').insert({
        id: newCustomerId,
        is_registered: 0,
        name: null,
        email: null,
        phone: null,
        password_hash: null,
        created_at: now,
        updated_at: now,
      });
    }

    const newToken = uuidv4();
    await db('customer_guest_tokens').insert({
      id: uuidv4(),
      customer_id: newCustomerId,
      token: newToken,
      restaurant_id: restaurant.id,
      session_id: session.id,
      ip_address: req.ip || null,
      is_merged: 0,
      merged_at: null,
      expires_at: new Date(Date.now() + 24 * 60 * 60 * 1000),
      created_at: now,
    });

    const [existingMember] = await db('session_members')
      .where({ session_id: session.id, customer_id: newCustomerId })
      .limit(1);

    if (!existingMember) {
      await db('session_members').insert({
        id: uuidv4(),
        session_id: session.id,
        restaurant_id: restaurant.id,
        customer_id: newCustomerId,
        is_registered: 0,
        joined_at: now,
      });
    }

    return res.status(201).json({ token: newToken, customer_id: newCustomerId, session_id: session.id });
  } catch (error) {
    next(error);
  }
};

async function getGuestCustomer(req, restaurantId) {
  const guestToken = getGuestTokenFromRequest(req);
  if (!guestToken) {
    return { customerId: null, token: null };
  }

  const [guest] = await db('customer_guest_tokens')
    .where({ token: guestToken, restaurant_id: restaurantId })
    .where('expires_at', '>', new Date())
    .limit(1);

  if (!guest) {
    return { customerId: null, token: null };
  }

  return { customerId: guest.customer_id, token: guest.token };
}

export const createCustomerOrder = async (req, res, next) => {
  try {
    const { slug } = req.params;
    const restaurant = await findRestaurantBySlug(slug);

    if (!restaurant) {
      return res.status(404).json({ code: 'RESTAURANT_NOT_FOUND', message: 'Restaurant not found' });
    }

    const guest = await getGuestCustomer(req, restaurant.id);
    if (!guest.customerId) {
      return res.status(401).json({ code: 'GUEST_TOKEN_REQUIRED', message: 'Guest token is required to place an order.' });
    }

    const { items = [] } = req.body || {};
    if (!Array.isArray(items) || items.length === 0) {
      return res.status(400).json({ code: 'INVALID_ORDER', message: 'At least one menu item is required.' });
    }

    const [table] = await db('tables').where({ restaurant_id: restaurant.id, table_number: req.body?.table_number || req.query?.table_number || req.query?.tableNumber }).where('is_active', 1).whereNull('deleted_at').limit(1);
    const session = await resolveActiveSessionForRestaurantTable(restaurant.id, table?.id || req.body?.table_id || null);
    if (!session) {
      return res.status(409).json({ code: 'SESSION_NOT_ACTIVE', message: 'This table does not have an active session.' });
    }

    const menuItemIds = [...new Set(items.map((item) => item.menu_item_id).filter(Boolean))];
    const menuItems = menuItemIds.length
      ? await db('menu_items')
        .where({ restaurant_id: restaurant.id })
        .whereIn('id', menuItemIds)
        .where('is_available', 1)
        .whereNull('deleted_at')
      : [];

    const menuById = new Map(menuItems.map((menuItem) => [menuItem.id, menuItem]));
    const addonIds = [...new Set(items.flatMap((item) => (item.addons || []).map((addon) => addon.addon_id)).filter(Boolean))];
    const addOnRows = addonIds.length
      ? await db('menu_items')
        .where({ restaurant_id: restaurant.id, is_available: 1 })
        .whereIn('id', addonIds)
        .whereNull('deleted_at')
      : [];
    const addonById = new Map(addOnRows.map((addon) => [addon.id, addon]));

    const orderItems = [];
    let total = 0;
    const invalidItems = [];

    for (const item of items) {
      const menuItem = menuById.get(item.menu_item_id);
      if (!menuItem) {
        invalidItems.push({ menu_item_id: item.menu_item_id, reason: 'This item is unavailable.' });
        continue;
      }

      const addonTotal = (item.addons || []).reduce((sum, addon) => {
        const targetAddOn = addonById.get(addon.addon_id);
        if (!targetAddOn) {
          invalidItems.push({ menu_item_id: item.menu_item_id, reason: `Add-on ${addon.addon_id} is unavailable.` });
          return sum;
        }
        return sum + Number(targetAddOn.price) * Number(addon.quantity || 1);
      }, 0);

      const quantity = Math.max(1, Number(item.quantity || 1));
      const subtotal = (Number(menuItem.price) + addonTotal) * quantity;
      total += subtotal;

      orderItems.push({ menuItem, quantity, notes: item.notes || null, addons: item.addons || [], subtotal });
    }

    if (invalidItems.length > 0 || orderItems.length === 0) {
      return res.status(422).json({ code: 'ORDER_ITEM_INVALID', message: 'One or more menu items could not be added.', details: invalidItems });
    }

    const orderId = uuidv4();
    const now = new Date();

    await db.transaction(async (trx) => {
      await trx('orders').insert({
        id: orderId,
        restaurant_id: restaurant.id,
        session_id: session.id,
        customer_id: guest.customerId,
        placed_by: 'customer',
        placed_by_staff_id: null,
        status: 'pending',
        table_label: table?.table_number || 'N/A',
        is_direct_order: 0,
        created_at: now,
        updated_at: now,
      });

      for (const entry of orderItems) {
        const orderItemId = uuidv4();
        await trx('order_items').insert({
          id: orderItemId,
          order_id: orderId,
          menu_item_id: entry.menuItem.id,
          item_name_snapshot: entry.menuItem.name,
          mrp_snapshot: entry.menuItem.mrp,
          unit_price_snapshot: entry.menuItem.price,
          discount_amount_snapshot: entry.menuItem.discount_amount ?? 0,
          discount_percentage_snapshot: entry.menuItem.discount_percentage ?? 0,
          quantity: entry.quantity,
          notes: entry.notes,
          status: 'pending',
          subtotal: entry.subtotal,
          created_at: now,
          updated_at: now,
        });

        for (const addon of entry.addons || []) {
          const targetAddOn = addonById.get(addon.addon_id);
          if (!targetAddOn) continue;

          await trx('order_item_addons').insert({
            id: uuidv4(),
            order_item_id: orderItemId,
            addon_id: targetAddOn.id,
            addon_name_snapshot: targetAddOn.name,
            addon_price_snapshot: targetAddOn.price,
            quantity: Number(addon.quantity || 1),
            created_at: now,
          });
        }
      }

      const waiters = await trx('staff').where({ restaurant_id: restaurant.id, role: 'waiter', access: 'active' }).select('id');
      if (waiters.length) {
        await trx('notifications').insert({
          id: uuidv4(),
          restaurant_id: restaurant.id,
          recipient_type: 'staff',
          recipient_staff_id: waiters[0].id,
          recipient_customer_id: null,
          type: 'order_new',
          title: 'New customer order',
          body: `A new customer order was placed at table ${table?.table_number || 'N/A'}.`,
          reference_type: 'order',
          reference_id: orderId,
          channel: 'in_app',
          is_read: 0,
          status: 'pending',
          expires_at: new Date(Date.now() + 7 * 24 * 60 * 60 * 1000),
          created_at: now,
          updated_at: now,
        });
      }
    });

    res.status(201).json({ order_id: orderId, status: 'pending', total, created_at: now.toISOString() });
  } catch (error) {
    next(error);
  }
};

export const getOrderStatus = async (req, res, next) => {
  try {
    const { slug, orderId } = req.params;
    const restaurant = await findRestaurantBySlug(slug);

    if (!restaurant) {
      return res.status(404).json({ code: 'RESTAURANT_NOT_FOUND', message: 'Restaurant not found' });
    }

    const guest = await getGuestCustomer(req, restaurant.id);
    if (!guest.customerId) {
      return res.status(401).json({ code: 'GUEST_TOKEN_REQUIRED', message: 'Guest token is required to view order status.' });
    }

    const [order] = await db('orders')
      .where({ id: orderId, restaurant_id: restaurant.id, customer_id: guest.customerId })
      .limit(1);

    if (!order) {
      return res.status(404).json({ code: 'ORDER_NOT_FOUND', message: 'Order not found' });
    }

    const items = await db('order_items').where({ order_id: order.id }).orderBy('created_at', 'asc');
    const itemIds = items.map((item) => item.id);
    const addons = itemIds.length ? await db('order_item_addons').whereIn('order_item_id', itemIds) : [];

    res.json({
      order: {
        id: order.id,
        status: order.status,
        confirmed_at: order.confirmed_at,
        preparing_at: order.preparing_at,
        ready_at: order.ready_at,
        served_at: order.served_at,
        rejected_at: order.rejected_at,
      },
      items: items.map((item) => ({
        id: item.id,
        menu_item_id: item.menu_item_id,
        status: item.status,
        quantity: Number(item.quantity),
        notes: item.notes,
        rejection_reason: item.rejection_reason,
        subtotal: Number(item.subtotal),
        addons: addons.filter((addon) => addon.order_item_id === item.id).map((addon) => ({
          id: addon.id,
          addon_name_snapshot: addon.addon_name_snapshot,
          quantity: Number(addon.quantity),
          addon_price_snapshot: Number(addon.addon_price_snapshot),
        })),
      })),
    });
  } catch (error) {
    next(error);
  }
};

export const getCustomerOrders = async (req, res, next) => {
  try {
    const { slug } = req.params;
    const restaurant = await findRestaurantBySlug(slug);

    if (!restaurant) {
      return res.status(404).json({ code: 'RESTAURANT_NOT_FOUND', message: 'Restaurant not found' });
    }

    const guest = await getGuestCustomer(req, restaurant.id);
    if (!guest.customerId) {
      return res.status(401).json({ code: 'GUEST_TOKEN_REQUIRED', message: 'Guest token is required to view orders.' });
    }

    const orders = await db('orders')
      .where({ restaurant_id: restaurant.id, customer_id: guest.customerId })
      .whereIn('status', ['pending', 'confirmed', 'preparing', 'ready', 'served'])
      .orderBy('created_at', 'desc');

    res.json({ orders });
  } catch (error) {
    next(error);
  }
};

export const requestBill = async (req, res, next) => {
  try {
    const { slug } = req.params;
    const restaurant = await findRestaurantBySlug(slug);

    if (!restaurant) {
      return res.status(404).json({ code: 'RESTAURANT_NOT_FOUND', message: 'Restaurant not found' });
    }

    const guest = await getGuestCustomer(req, restaurant.id);
    if (!guest.customerId) {
      return res.status(401).json({ code: 'GUEST_TOKEN_REQUIRED', message: 'Guest token is required to request the bill.' });
    }

    const [table] = await db('tables')
      .where({ restaurant_id: restaurant.id })
      .where('is_active', 1)
      .whereNull('deleted_at')
      .limit(1);

    const session = table ? await resolveActiveSessionForRestaurantTable(restaurant.id, table.id) : null;
    if (!session) {
      return res.status(409).json({ code: 'SESSION_NOT_ACTIVE', message: 'No active session available for this table.' });
    }

    if (session.status === 'bill_requested') {
      return res.json({ success: true, status: 'bill_requested', already_requested: true });
    }

    await db('sessions')
      .where({ id: session.id, restaurant_id: restaurant.id })
      .update({ status: 'bill_requested', bill_requested_at: new Date(), updated_at: new Date() });

    const waiters = await db('staff').where({ restaurant_id: restaurant.id, role: 'waiter', access: 'active' }).select('id');
    if (waiters.length) {
      await db('notifications').insert({
        id: uuidv4(),
        restaurant_id: restaurant.id,
        recipient_type: 'staff',
        recipient_staff_id: waiters[0].id,
        recipient_customer_id: null,
        type: 'bill_requested',
        title: 'Bill requested',
        body: `A customer at table ${table?.table_number || 'N/A'} requested the bill.`,
        reference_type: 'session',
        reference_id: session.id,
        channel: 'in_app',
        is_read: 0,
        status: 'pending',
        expires_at: new Date(Date.now() + 7 * 24 * 60 * 60 * 1000),
        created_at: new Date(),
        updated_at: new Date(),
      });
    }

    return res.json({ success: true, status: 'bill_requested', already_requested: false });
  } catch (error) {
    next(error);
  }
};
