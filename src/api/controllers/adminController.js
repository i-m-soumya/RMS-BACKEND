import bcrypt from 'bcrypt';
import fs from 'fs/promises';
import path from 'path';
import { fileURLToPath } from 'url';
import { v4 as uuidv4 } from 'uuid';
import db from '../../db/connection.js';
import { sendStaffCredentialsEmail } from '../../services/emailService.js';
import {
  emitNotification,
  getUnreadNotificationCount as getUnreadCount,
  listNotificationsForStaff,
  markAllNotificationsRead as markAllNotificationsAsRead,
  markNotificationRead as markSingleNotificationRead,
} from '../../services/notifications.js';

const uploadsDirectory = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../../../uploads');
const imageExtensionByMimeType = {
  'image/jpeg': 'jpg',
  'image/png': 'png',
  'image/webp': 'webp',
};

const ITEM_SORT_COLUMNS = {
  name: 'mi.name',
  price: 'mi.price',
  created_at: 'mi.created_at',
};

function makeTempPassword() {
  const alphabet = 'ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnopqrstuvwxyz23456789!@#$';
  return Array.from({ length: 12 }, () => alphabet[Math.floor(Math.random() * alphabet.length)]).join('');
}

function computeDiscount(mrp, price) {
  const mrpValue = Number(mrp);
  const priceValue = Number(price);
  const discountAmount = Number((mrpValue - priceValue).toFixed(2));
  const discountPercentage = mrpValue === 0
    ? 0
    : Number((((mrpValue - priceValue) / mrpValue) * 100).toFixed(2));

  return {
    discountAmount,
    discountPercentage,
  };
}

function parseBooleanQuery(value) {
  if (value === undefined) return undefined;
  if (value === true || value === 'true' || value === '1' || value === 1) return 1;
  if (value === false || value === 'false' || value === '0' || value === 0) return 0;
  return undefined;
}

function hasDupEntryOnGeneratedUnique(error) {
  if (!error || error.code !== 'ER_DUP_ENTRY') return false;
  const message = String(error.sqlMessage || error.message || '').toLowerCase();
  return message.includes('name_restaurant_active') || message.includes('email_restaurant_active');
}

async function insertStaffActivityLog(trx, {
  restaurantId,
  staffId,
  actionType,
  referenceType,
  referenceId,
  notes = null,
}) {
  await trx('staff_activity_log').insert({
    id: uuidv4(),
    restaurant_id: restaurantId,
    staff_id: staffId,
    action_type: actionType,
    reference_type: referenceType,
    reference_id: referenceId,
    notes,
  });
}

async function getItemCategoriesByItemIds(restaurantId, itemIds) {
  if (!itemIds.length) return new Map();

  const rows = await db('menu_item_categories as mic')
    .join('menu_categories as mc', 'mc.id', 'mic.category_id')
    .where('mic.restaurant_id', restaurantId)
    .whereIn('mic.menu_item_id', itemIds)
    .andWhere('mic.is_active', 1)
    .whereNull('mic.deleted_at')
    .whereNull('mc.deleted_at')
    .select(
      'mic.menu_item_id',
      'mc.id as category_id',
      'mc.name as category_name',
      'mic.display_order',
    )
    .orderBy('mic.display_order', 'asc');

  const map = new Map();
  for (const row of rows) {
    if (!map.has(row.menu_item_id)) {
      map.set(row.menu_item_id, []);
    }
    map.get(row.menu_item_id).push({
      id: row.category_id,
      name: row.category_name,
      is_primary_category: false,
    });
  }

  return map;
}

async function getSchedulesByItemIds(restaurantId, itemIds) {
  if (!itemIds.length) return new Map();
  const rows = await db('menu_item_schedules')
    .where('restaurant_id', restaurantId)
    .whereIn('menu_item_id', itemIds)
    .where('is_active', 1)
    .select('menu_item_id', 'available_from', 'available_until', 'repeat_daily', 'is_active');
  return new Map(rows.map((row) => [row.menu_item_id, {
    available_from: row.available_from,
    available_until: row.available_until,
    repeat_daily: Boolean(row.repeat_daily),
    is_active: Boolean(row.is_active),
  }]));
}

async function upsertMenuItemSchedule(trx, restaurantId, menuItemId, schedule) {
  if (!schedule) {
    await trx('menu_item_schedules').where({ restaurant_id: restaurantId, menu_item_id: menuItemId }).update({ is_active: 0 });
    return;
  }
  await trx('menu_item_schedules')
    .insert({
      id: uuidv4(),
      menu_item_id: menuItemId,
      restaurant_id: restaurantId,
      available_from: schedule.available_from,
      available_until: schedule.available_until,
      repeat_daily: schedule.repeat_daily === false ? 0 : 1,
      is_active: 1,
    })
    .onConflict('menu_item_id')
    .merge({
      restaurant_id: restaurantId,
      available_from: schedule.available_from,
      available_until: schedule.available_until,
      repeat_daily: schedule.repeat_daily === false ? 0 : 1,
      is_active: 1,
    });
}

export function getRestaurantLocalTime(now, timezone = 'UTC') {
  try {
    return new Intl.DateTimeFormat('en-GB', { timeZone: timezone, hour: '2-digit', minute: '2-digit', hour12: false }).format(now);
  } catch {
    return new Intl.DateTimeFormat('en-GB', { timeZone: 'UTC', hour: '2-digit', minute: '2-digit', hour12: false }).format(now);
  }
}

export async function isItemCurrentlyAvailable(menuItemId, now = new Date(), database = db) {
  const [item] = await database('menu_items').where({ id: menuItemId }).whereNull('deleted_at').select('is_available', 'restaurant_id').limit(1);
  if (!item || !item.is_available) return false;
  let timezone = 'UTC';
  if (item.restaurant_id) {
    const [restaurant] = await database('restaurants').where({ id: item.restaurant_id }).select('timezone').limit(1);
    timezone = restaurant?.timezone || 'UTC';
  }
  const schedules = await database('menu_item_schedules').where({ menu_item_id: menuItemId, is_active: 1 });
  if (!schedules.length) return true;
  const current = `${getRestaurantLocalTime(now, timezone)}:00`;
  return schedules.some((schedule) => current >= String(schedule.available_from) && current <= String(schedule.available_until));
}

export async function filterCurrentlyAvailableItems(items, now = new Date(), database = db) {
  const results = await Promise.all(items.map(async (item) => ({ item, available: await isItemCurrentlyAvailable(item.id, now, database) })));
  return results.filter((entry) => entry.available).map((entry) => entry.item);
}

async function assertValidCategoryIds(trx, restaurantId, categoryIds) {
  const rows = await trx('menu_categories')
    .where('restaurant_id', restaurantId)
    .whereIn('id', categoryIds)
    .whereNull('deleted_at')
    .andWhere('is_active', 1)
    .select('id');

  if (rows.length !== categoryIds.length) {
    return false;
  }

  return true;
}

async function getMenuItemAddonIds(restaurantId, itemIds) {
  if (!itemIds.length) return new Map();
  const rows = await db('menu_item_addon_map as map')
    .join('menu_addons as addon', 'addon.id', 'map.addon_id')
    .where('map.restaurant_id', restaurantId)
    .whereIn('map.menu_item_id', itemIds)
    .whereNull('map.deleted_at')
    .whereNull('addon.deleted_at')
    .where('addon.is_available', 1)
    .select('map.menu_item_id', 'map.addon_id');
  const result = new Map();
  for (const row of rows) {
    if (!result.has(row.menu_item_id)) result.set(row.menu_item_id, []);
    result.get(row.menu_item_id).push(row.addon_id);
  }
  return result;
}

async function reconcileMenuItemAddons(trx, restaurantId, menuItemId, addonIds, itemType) {
  const selectedIds = itemType === 'regular' ? [...new Set(addonIds || [])] : [];
  const validRows = selectedIds.length
    ? await trx('menu_addons')
      .where('restaurant_id', restaurantId)
      .whereIn('id', selectedIds)
      .whereNull('deleted_at')
      .where('is_available', 1)
      .select('id')
    : [];
  if (validRows.length !== selectedIds.length) {
    const error = new Error('One or more selected add-ons are unavailable for this restaurant');
    error.status = 400;
    throw error;
  }

  const selected = new Set(selectedIds);
  const now = new Date();
  const existingRows = await trx('menu_item_addon_map')
    .where({ restaurant_id: restaurantId, menu_item_id: menuItemId })
    .select('id', 'addon_id', 'deleted_at');

  for (const row of existingRows) {
    if (!selected.has(row.addon_id) && row.deleted_at === null) {
      await trx('menu_item_addon_map').where({ id: row.id }).update({ deleted_at: now });
    } else if (selected.has(row.addon_id) && row.deleted_at !== null) {
      await trx('menu_item_addon_map').where({ id: row.id }).update({ deleted_at: null });
    }
  }

  const knownIds = new Set(existingRows.map((row) => row.addon_id));
  for (const addonId of selectedIds) {
    if (!knownIds.has(addonId)) {
      await trx('menu_item_addon_map').insert({
        id: uuidv4(),
        menu_item_id: menuItemId,
        addon_id: addonId,
        restaurant_id: restaurantId,
        deleted_at: null,
      });
    }
  }
}

export const listNotifications = async (req, res, next) => {
  try {
    const restaurantId = req.user.restaurantId;
    const staffId = req.user.id;
    const since = req.query?.since ?? null;

    const rows = await listNotificationsForStaff({ restaurantId, staffId, since });

    return res.json({
      data: rows.map((row) => ({
        id: row.id,
        message: row.payload?.message || row.event_type,
        scope: 'restaurant',
        restaurantSlug: req.user.restaurantSlug,
        unread: !row.is_read,
        created_at: row.created_at,
        createdAt: row.created_at,
        read_at: row.is_read ? row.created_at : null,
      })),
    });
  } catch (error) {
    next(error);
  }
};

export const getUnreadNotificationCount = async (req, res, next) => {
  try {
    const restaurantId = req.user.restaurantId;
    const staffId = req.user.id;
    const total = await getUnreadCount({ restaurantId, staffId });

    return res.json({ data: { count: Number(total || 0) } });
  } catch (error) {
    next(error);
  }
};

export const markNotificationRead = async (req, res, next) => {
  try {
    const restaurantId = req.user.restaurantId;
    const staffId = req.user.id;
    const { id } = req.params;
    const changed = await markSingleNotificationRead({ restaurantId, staffId, notificationId: id });
    return res.json({ success: true, id, count: Number(changed || 0) });
  } catch (error) {
    next(error);
  }
};

export const markAllNotificationsRead = async (req, res, next) => {
  try {
    const restaurantId = req.user.restaurantId;
    const staffId = req.user.id;
    const updated = await markAllNotificationsAsRead({ restaurantId, staffId });
    return res.json({ success: true, count: Number(updated || 0) });
  } catch (error) {
    next(error);
  }
};

export const listMenuAddons = async (req, res, next) => {
  try {
    const query = db('menu_addons as addon')
      .leftJoin('menu_item_addon_map as map', function join() { this.on('map.addon_id', 'addon.id').andOnNull('map.deleted_at'); })
      .where('addon.restaurant_id', req.user.restaurantId)
      .whereNull('addon.deleted_at')
      .modify((builder) => { if (req.query.search) builder.where('addon.name', 'like', `%${req.query.search}%`); })
      .groupBy('addon.id')
      .select('addon.*')
      .count({ linked_item_count: 'map.id' })
      .orderBy('addon.name', 'asc');
    const rows = await query;
    return res.json({ data: rows });
  } catch (error) { next(error); }
};

// Pairings store the admin-selected direction once; bidirectionality is derived at read time.
export const listMenuItemPairings = async (req, res, next) => {
  try {
    const restaurantId = req.user.restaurantId;
    const { itemId } = req.params;
    const item = await db('menu_items').where({ id: itemId, restaurant_id: restaurantId }).whereNull('deleted_at').first();
    if (!item) return res.status(404).json({ code: 'NOT_FOUND', message: 'Menu item not found' });
    const [outgoing, incoming] = await Promise.all([
      db('menu_item_pairings as pairing').join('menu_items as other', 'other.id', 'pairing.paired_with_item_id').where({ 'pairing.menu_item_id': itemId, 'pairing.restaurant_id': restaurantId }).whereNull('pairing.deleted_at').whereNull('other.deleted_at').select('pairing.id as pairingId', 'other.id as id', 'other.name', 'other.price', 'other.image_url as imageUrl', 'pairing.display_order as displayOrder'),
      db('menu_item_pairings as pairing').join('menu_items as other', 'other.id', 'pairing.menu_item_id').where({ 'pairing.paired_with_item_id': itemId, 'pairing.restaurant_id': restaurantId }).whereNull('pairing.deleted_at').whereNull('other.deleted_at').select('pairing.id as pairingId', 'other.id as id', 'other.name', 'other.price', 'other.image_url as imageUrl', 'pairing.display_order as displayOrder'),
    ]);
    return res.json({ data: [...outgoing, ...incoming].sort((a, b) => Number(a.displayOrder) - Number(b.displayOrder)).map((row) => ({ pairingId: row.pairingId, pairedItem: { id: row.id, name: row.name, price: row.price, imageUrl: row.imageUrl }, displayOrder: row.displayOrder })) });
  } catch (error) { next(error); }
};

export const createMenuItemPairing = async (req, res, next) => {
  try {
    const restaurantId = req.user.restaurantId;
    const { itemId } = req.params;
    const { pairedItemId, displayOrder } = req.body;
    if (itemId === pairedItemId) return res.status(400).json({ code: 'SELF_PAIRING', message: 'A menu item cannot be paired with itself' });
    const items = await db('menu_items').where('restaurant_id', restaurantId).whereIn('id', [itemId, pairedItemId]).whereNull('deleted_at').select('id');
    if (items.length !== 2) return res.status(400).json({ code: 'INVALID_PAIRED_ITEM', message: 'Both menu items must belong to this restaurant and be active' });
    const existing = await db('menu_item_pairings').where({ restaurant_id: restaurantId }).andWhere((query) => query.where({ menu_item_id: itemId, paired_with_item_id: pairedItemId }).orWhere({ menu_item_id: pairedItemId, paired_with_item_id: itemId })).first();
    if (existing?.deleted_at === null) return res.status(409).json({ code: 'PAIRING_EXISTS', message: 'These menu items are already paired' });
    if (existing) {
      const [restored] = await db('menu_item_pairings').where({ id: existing.id, restaurant_id: restaurantId }).update({ deleted_at: null, display_order: displayOrder }, ['*']);
      return res.status(201).json({ data: restored || { ...existing, deleted_at: null, display_order: displayOrder } });
    }
    const row = { id: uuidv4(), menu_item_id: itemId, paired_with_item_id: pairedItemId, restaurant_id: restaurantId, display_order: displayOrder };
    try { await db('menu_item_pairings').insert(row); } catch (error) {
      if (error.code === 'ER_DUP_ENTRY') { error.status = 409; error.code = 'PAIRING_EXISTS'; error.message = 'These menu items are already paired'; }
      throw error;
    }
    return res.status(201).json({ data: row });
  } catch (error) { next(error); }
};

export const deleteMenuItemPairing = async (req, res, next) => {
  try {
    const changed = await db('menu_item_pairings').where({ id: req.params.pairingId, restaurant_id: req.user.restaurantId }).whereNull('deleted_at').update({ deleted_at: new Date() });
    if (!changed) return res.status(404).json({ code: 'NOT_FOUND', message: 'Pairing not found' });
    return res.json({ success: true });
  } catch (error) { next(error); }
};

export const createMenuAddon = async (req, res, next) => {
  try {
    const { name, price, isAvailable, displayOrder } = req.body;
    const id = uuidv4();
    const row = { id, restaurant_id: req.user.restaurantId, name, price, is_available: isAvailable ? 1 : 0, display_order: displayOrder };
    await db('menu_addons').insert(row);
    return res.status(201).json({ data: { ...row, deleted_at: null } });
  } catch (error) {
    if (hasDupEntryOnGeneratedUnique(error)) { error.status = 409; error.code = 'ADDON_NAME_CONFLICT'; error.message = 'An add-on with this name already exists'; }
    next(error);
  }
};

export const updateMenuAddon = async (req, res, next) => {
  try {
    const { id } = req.params;
    const existing = await db('menu_addons').where({ id, restaurant_id: req.user.restaurantId }).whereNull('deleted_at').first();
    if (!existing) return res.status(404).json({ code: 'NOT_FOUND', message: 'Add-on not found' });
    const { name, price, isAvailable, displayOrder } = req.body;
    await db('menu_addons').where({ id, restaurant_id: req.user.restaurantId }).update({ name, price, is_available: isAvailable ? 1 : 0, display_order: displayOrder, updated_at: new Date() });
    const [row] = await db('menu_addons').where({ id }).select('*');
    return res.json({ data: row });
  } catch (error) {
    if (hasDupEntryOnGeneratedUnique(error)) { error.status = 409; error.code = 'ADDON_NAME_CONFLICT'; error.message = 'An add-on with this name already exists'; }
    next(error);
  }
};

export const deleteMenuAddon = async (req, res, next) => {
  try {
    const changed = await db('menu_addons').where({ id: req.params.id, restaurant_id: req.user.restaurantId }).whereNull('deleted_at').update({ deleted_at: new Date() });
    if (!changed) return res.status(404).json({ code: 'NOT_FOUND', message: 'Add-on not found' });
    return res.json({ success: true });
  } catch (error) { next(error); }
};

export const listMenuAddonItems = async (req, res, next) => {
  try {
    const addon = await db('menu_addons').where({ id: req.params.id, restaurant_id: req.user.restaurantId }).whereNull('deleted_at').first();
    if (!addon) return res.status(404).json({ code: 'NOT_FOUND', message: 'Add-on not found' });
    const rows = await db('menu_item_addon_map as map').join('menu_items as item', 'item.id', 'map.menu_item_id').where({ 'map.addon_id': addon.id, 'map.restaurant_id': req.user.restaurantId }).whereNull('map.deleted_at').whereNull('item.deleted_at').select('item.id', 'item.name').orderBy('item.name');
    return res.json({ data: rows });
  } catch (error) { next(error); }
};

export const updateMenuAddonItems = async (req, res, next) => {
  try {
    const { menuItemIds, action } = req.body;
    const addon = await db('menu_addons').where({ id: req.params.id, restaurant_id: req.user.restaurantId }).whereNull('deleted_at').first();
    if (!addon) return res.status(404).json({ code: 'NOT_FOUND', message: 'Add-on not found' });
    const uniqueItemIds = [...new Set(menuItemIds)];
    const validCount = await db('menu_items').where('restaurant_id', req.user.restaurantId).whereIn('id', uniqueItemIds).whereNull('deleted_at').count({ count: 'id' }).first();
    if (Number(validCount.count) !== uniqueItemIds.length) { const error = new Error('One or more menu items are invalid for this restaurant'); error.status = 400; throw error; }
    const changed = await db.transaction(async (trx) => {
      if (action === 'link') {
        let count = 0;
        for (const menuItemId of uniqueItemIds) {
          const active = await trx('menu_item_addon_map').where({ menu_item_id: menuItemId, addon_id: addon.id }).whereNull('deleted_at').first();
          if (!active) { const deleted = await trx('menu_item_addon_map').where({ menu_item_id: menuItemId, addon_id: addon.id }).whereNotNull('deleted_at').first(); if (deleted) await trx('menu_item_addon_map').where({ id: deleted.id }).update({ deleted_at: null }); else { await trx('menu_item_addon_map').insert({ id: uuidv4(), menu_item_id: menuItemId, addon_id: addon.id, restaurant_id: req.user.restaurantId }); } count += 1; }
        }
        return count;
      }
      return trx('menu_item_addon_map').where({ addon_id: addon.id, restaurant_id: req.user.restaurantId }).whereIn('menu_item_id', uniqueItemIds).whereNull('deleted_at').update({ deleted_at: new Date() });
    });
    return res.json({ success: true, action, changed });
  } catch (error) { next(error); }
};

function imageUrlForRequest(req, filename) {
  return `${req.protocol}://${req.get('host')}/uploads/${filename}`;
}

async function persistImage(req, file, restaurantId, entityType) {
  const extension = imageExtensionByMimeType[file.mimetype];
  const filename = `${restaurantId}_${entityType}_${uuidv4()}.${extension}`;
  await fs.mkdir(uploadsDirectory, { recursive: true });
  await fs.writeFile(path.join(uploadsDirectory, filename), file.buffer);
  return imageUrlForRequest(req, filename);
}

async function getMenuItemImages(restaurantId, itemIds) {
  if (!itemIds.length) return new Map();

  const rows = await db('menu_item_images')
    .where('restaurant_id', restaurantId)
    .whereIn('menu_item_id', itemIds)
    .whereNull('deleted_at')
    .select('id', 'menu_item_id', 'image_url', 'display_order', 'is_primary', 'created_at')
    .orderBy('display_order', 'asc')
    .orderBy('created_at', 'asc');

  const map = new Map();
  for (const row of rows) {
    if (!map.has(row.menu_item_id)) map.set(row.menu_item_id, []);
    map.get(row.menu_item_id).push({
      id: row.id,
      image_url: row.image_url,
      display_order: Number(row.display_order),
      is_primary: Boolean(row.is_primary),
      created_at: row.created_at,
    });
  }
  return map;
}

function primaryImageUrl(images) {
  return images.find((image) => image.is_primary)?.image_url || images[0]?.image_url || null;
}

export const listMenuCategories = async (req, res, next) => {
  try {
    const restaurantId = req.user.restaurantId;

    const rows = await db('menu_categories as mc')
      .leftJoin('menu_item_categories as mic', function joinActiveMappings() {
        this.on('mic.category_id', '=', 'mc.id')
          .andOn('mic.restaurant_id', '=', 'mc.restaurant_id')
          .andOn(db.raw('mic.is_active = 1'))
          .andOn(db.raw('mic.deleted_at is null'));
      })
      .leftJoin('menu_items as mi', function joinActiveItems() {
        this.on('mi.id', '=', 'mic.menu_item_id')
          .andOn('mi.restaurant_id', '=', 'mc.restaurant_id')
          .andOn(db.raw('mi.deleted_at is null'));
      })
      .where('mc.restaurant_id', restaurantId)
      .whereNull('mc.deleted_at')
      .groupBy('mc.id')
      .select(
        'mc.id',
        'mc.name',
        'mc.description',
        'mc.image_url',
        'mc.display_order',
        'mc.is_active',
        'mc.created_at',
        'mc.updated_at',
      )
      .countDistinct({ item_count: 'mi.id' })
      .orderBy('mc.display_order', 'asc');

    res.json({ data: rows.map((row) => ({
      ...row,
      is_active: Boolean(row.is_active),
      item_count: Number(row.item_count || 0),
    })) });
  } catch (error) {
    next(error);
  }
};

export const createMenuCategory = async (req, res, next) => {
  try {
    const restaurantId = req.user.restaurantId;
    const { name, description, image_url, display_order } = req.body;

    const categoryId = uuidv4();
    const now = new Date();

    let resolvedOrder = display_order;
    if (resolvedOrder === undefined) {
      const maxRow = await db('menu_categories')
        .where('restaurant_id', restaurantId)
        .whereNull('deleted_at')
        .max({ max_display_order: 'display_order' })
        .first();
      resolvedOrder = Number(maxRow?.max_display_order || 0) + 1;
    }

    await db('menu_categories').insert({
      id: categoryId,
      restaurant_id: restaurantId,
      name,
      description: description || null,
      image_url: image_url || null,
      display_order: resolvedOrder,
      is_active: 1,
      created_at: now,
      updated_at: now,
    });

    const [category] = await db('menu_categories')
      .where({ id: categoryId })
      .select('id', 'name', 'description', 'image_url', 'display_order', 'is_active', 'created_at', 'updated_at')
      .limit(1);

    res.status(201).json({ data: { ...category, item_count: 0, is_active: Boolean(category.is_active) } });
  } catch (error) {
    if (hasDupEntryOnGeneratedUnique(error)) {
      return res.status(409).json({ error: 'A category with this name already exists for this restaurant' });
    }
    next(error);
  }
};

export const updateMenuCategory = async (req, res, next) => {
  try {
    const restaurantId = req.user.restaurantId;
    const { id } = req.params;
    const { name, description, image_url } = req.body;

    const updated = await db('menu_categories')
      .where({ id, restaurant_id: restaurantId })
      .whereNull('deleted_at')
      .update({
        ...(name !== undefined && { name }),
        ...(description !== undefined && { description }),
        ...(image_url !== undefined && { image_url }),
        updated_at: new Date(),
      });

    if (!updated) {
      return res.status(404).json({ error: 'Category not found' });
    }

    const [category] = await db('menu_categories')
      .where({ id, restaurant_id: restaurantId })
      .whereNull('deleted_at')
      .select('id', 'name', 'description', 'image_url', 'display_order', 'is_active', 'created_at', 'updated_at')
      .limit(1);

    return res.json({ data: { ...category, is_active: Boolean(category.is_active) } });
  } catch (error) {
    if (hasDupEntryOnGeneratedUnique(error)) {
      return res.status(409).json({ error: 'A category with this name already exists for this restaurant' });
    }
    next(error);
  }
};

export const reorderMenuCategories = async (req, res, next) => {
  try {
    const restaurantId = req.user.restaurantId;
    const { order } = req.body;

    const categories = await db('menu_categories')
      .where('restaurant_id', restaurantId)
      .whereNull('deleted_at')
      .select('id');

    const existingIds = new Set(categories.map((row) => row.id));
    if (order.length !== categories.length || order.some((id) => !existingIds.has(id))) {
      return res.status(400).json({ error: 'Order array must contain all active category IDs exactly once' });
    }

    await db.transaction(async (trx) => {
      const now = new Date();
      for (let index = 0; index < order.length; index += 1) {
        await trx('menu_categories')
          .where({ id: order[index], restaurant_id: restaurantId })
          .whereNull('deleted_at')
          .update({ display_order: index + 1, updated_at: now });
      }
    });

    return res.json({ success: true });
  } catch (error) {
    next(error);
  }
};

export const deleteMenuCategory = async (req, res, next) => {
  try {
    const restaurantId = req.user.restaurantId;
    const { id } = req.params;

    const [category] = await db('menu_categories')
      .where({ id, restaurant_id: restaurantId })
      .whereNull('deleted_at')
      .select('id')
      .limit(1);

    if (!category) {
      return res.status(404).json({ error: 'Category not found' });
    }

    const [{ count }] = await db('menu_item_categories as mic')
      .join('menu_items as mi', 'mi.id', 'mic.menu_item_id')
      .where('mic.restaurant_id', restaurantId)
      .andWhere('mic.category_id', id)
      .andWhere('mic.is_primary_category', 1)
      .andWhere('mic.is_active', 1)
      .whereNull('mic.deleted_at')
      .whereNull('mi.deleted_at')
      .countDistinct({ count: 'mi.id' });

    if (Number(count) > 0) {
      return res.status(409).json({ error: `${count} active items use this as their primary category` });
    }

    await db('menu_categories')
      .where({ id, restaurant_id: restaurantId })
      .whereNull('deleted_at')
      .update({
        deleted_at: new Date(),
        is_active: 0,
        updated_at: new Date(),
      });

    return res.json({ success: true });
  } catch (error) {
    next(error);
  }
};

export const listMenuItems = async (req, res, next) => {
  try {
    const restaurantId = req.user.restaurantId;
    const {
      search,
      category_id,
      dietary_type,
      item_type,
      is_available,
      page,
      limit,
      sort_by,
      sort_dir,
    } = req.query;

    const base = db('menu_items as mi')
      .where('mi.restaurant_id', restaurantId)
      .whereNull('mi.deleted_at');

    if (search) {
      base.andWhere((builder) => {
        builder
          .where('mi.name', 'like', `%${search}%`)
          .orWhere('mi.description', 'like', `%${search}%`);
      });
    }

    if (dietary_type) {
      base.andWhere('mi.dietary_type', dietary_type);
    }

    if (item_type) {
      base.andWhere('mi.item_type', item_type);
    }

    const availableFilter = parseBooleanQuery(is_available);
    if (availableFilter !== undefined) {
      base.andWhere('mi.is_available', availableFilter);
    }

    if (category_id) {
      base.andWhereExists(
        db('menu_item_categories as mic')
          .whereRaw('mic.menu_item_id = mi.id')
          .andWhere('mic.restaurant_id', restaurantId)
          .andWhere('mic.category_id', category_id)
          .andWhere('mic.is_active', 1)
          .whereNull('mic.deleted_at'),
      );
    }

    const countResult = await base.clone().count({ total: 'mi.id' }).first();
    const total = Number(countResult?.total || 0);
    const offset = (page - 1) * limit;

    const rows = await base
      .clone()
      .select(
        'mi.id',
        'mi.name',
        'mi.description',
        'mi.mrp',
        'mi.price',
        'mi.discount_amount',
        'mi.discount_percentage',
        'mi.image_url',
        'mi.item_type',
        'mi.dietary_type',
        'mi.spice_level',
        'mi.is_available',
        'mi.is_featured',
        'mi.display_order',
        'mi.created_at',
        'mi.updated_at',
      )
      .orderBy(ITEM_SORT_COLUMNS[sort_by] || ITEM_SORT_COLUMNS.created_at, sort_dir)
      .offset(offset)
      .limit(limit);

    const categoryMap = await getItemCategoriesByItemIds(restaurantId, rows.map((row) => row.id));
    const imageMap = await getMenuItemImages(restaurantId, rows.map((row) => row.id));
    const scheduleMap = await getSchedulesByItemIds(restaurantId, rows.map((row) => row.id));
    const addonMap = await getMenuItemAddonIds(restaurantId, rows.map((row) => row.id));

    res.json({
      data: rows.map((row) => ({
        ...row,
        image_url: primaryImageUrl(imageMap.get(row.id) || []),
        images: imageMap.get(row.id) || [],
        schedule: scheduleMap.get(row.id) || null,
        addon_ids: addonMap.get(row.id) || [],
        is_available: Boolean(row.is_available),
        is_featured: Boolean(row.is_featured),
        categories: categoryMap.get(row.id) || [],
      })),
      meta: {
        page,
        limit,
        total,
        totalPages: Math.ceil(total / limit) || 1,
      },
    });
  } catch (error) {
    next(error);
  }
};

export const createMenuItem = async (req, res, next) => {
  try {
    const restaurantId = req.user.restaurantId;
    const actorStaffId = req.user.id;
    const {
      name,
      description,
      category_ids,
      mrp,
      price,
      item_type,
      dietary_type,
      spice_level,
      is_available,
      schedule,
      addon_ids,
    } = req.body;

    const itemId = uuidv4();
    const now = new Date();

    const savedItem = await db.transaction(async (trx) => {
      const categoryIds = [...new Set(category_ids || [])];
      const categoriesOk = await assertValidCategoryIds(trx, restaurantId, categoryIds);
      if (!categoriesOk) {
        const error = new Error('One or more category_ids are invalid for this restaurant');
        error.status = 400;
        throw error;
      }

      const { discountAmount, discountPercentage } = computeDiscount(mrp, price);

      await trx('menu_items').insert({
        id: itemId,
        restaurant_id: restaurantId,
        name,
        description: description || null,
        mrp,
        price,
        discount_amount: discountAmount,
        discount_percentage: discountPercentage,
        item_type,
        dietary_type,
        spice_level: spice_level || null,
        is_available: is_available ? 1 : 0,
        created_at: now,
        updated_at: now,
      });

      for (let index = 0; index < categoryIds.length; index += 1) {
        const categoryId = categoryIds[index];
        await trx('menu_item_categories').insert({
          id: uuidv4(),
          menu_item_id: itemId,
          category_id: categoryId,
          restaurant_id: restaurantId,
          display_order: index,
          is_primary_category: 0,
          is_active: 1,
          created_at: now,
        });
      }

      await upsertMenuItemSchedule(trx, restaurantId, itemId, item_type === 'scheduled' ? schedule : null);
      await reconcileMenuItemAddons(trx, restaurantId, itemId, addon_ids, item_type);

      await insertStaffActivityLog(trx, {
        restaurantId,
        staffId: actorStaffId,
        actionType: 'menu_item_created',
        referenceType: 'menu_item',
        referenceId: itemId,
        notes: `Created menu item ${name}`,
      });

      const [item] = await trx('menu_items')
        .where({ id: itemId, restaurant_id: restaurantId })
        .select('*')
        .limit(1);

      return item;
    });

    const categoryMap = await getItemCategoriesByItemIds(restaurantId, [itemId]);
    const scheduleMap = await getSchedulesByItemIds(restaurantId, [itemId]);
    return res.status(201).json({
      data: {
        ...savedItem,
        image_url: null,
        images: [],
        schedule: scheduleMap.get(itemId) || null,
        addon_ids: addon_ids || [],
        is_available: Boolean(savedItem.is_available),
        is_featured: Boolean(savedItem.is_featured),
        categories: categoryMap.get(itemId) || [],
      },
    });
  } catch (error) {
    next(error);
  }
};

export const updateMenuItem = async (req, res, next) => {
  try {
    const restaurantId = req.user.restaurantId;
    const actorStaffId = req.user.id;
    const { id } = req.params;
    const {
      name,
      description,
      category_ids,
      mrp,
      price,
      item_type,
      dietary_type,
      spice_level,
      is_available,
      schedule,
      addon_ids,
    } = req.body;

    await db.transaction(async (trx) => {
      const [existing] = await trx('menu_items')
        .where({ id, restaurant_id: restaurantId })
        .whereNull('deleted_at')
        .select('*')
        .limit(1);

      if (!existing) {
        const error = new Error('Menu item not found');
        error.status = 404;
        throw error;
      }

      const nextMrp = mrp !== undefined ? Number(mrp) : Number(existing.mrp);
      const nextPrice = price !== undefined ? Number(price) : Number(existing.price);
      if (nextPrice > nextMrp) {
        const error = new Error('price must be less than or equal to mrp');
        error.status = 400;
        throw error;
      }
      const { discountAmount, discountPercentage } = computeDiscount(nextMrp, nextPrice);

      const itemUpdate = {
        ...(name !== undefined && { name }),
        ...(description !== undefined && { description }),
        ...(mrp !== undefined && { mrp }),
        ...(price !== undefined && { price }),
        ...(item_type !== undefined && { item_type }),
        ...(dietary_type !== undefined && { dietary_type }),
        ...(spice_level !== undefined && { spice_level }),
        ...(is_available !== undefined && { is_available: is_available ? 1 : 0 }),
        discount_amount: discountAmount,
        discount_percentage: discountPercentage,
        updated_at: new Date(),
      };

      await trx('menu_items')
        .where({ id, restaurant_id: restaurantId })
        .whereNull('deleted_at')
        .update(itemUpdate);

      if (category_ids !== undefined && (item_type || existing.item_type) !== 'addon_only') {
        const categoryIds = [...new Set(category_ids)];
        const categoriesOk = await assertValidCategoryIds(trx, restaurantId, categoryIds);
        if (!categoriesOk) {
          const error = new Error('One or more category_ids are invalid for this restaurant');
          error.status = 400;
          throw error;
        }

        const existingMappings = await trx('menu_item_categories')
          .where({ menu_item_id: id, restaurant_id: restaurantId })
          .select('id', 'category_id', 'is_active', 'deleted_at');

        const mappingByCategoryId = new Map(existingMappings.map((row) => [row.category_id, row]));
        const now = new Date();

        for (let index = 0; index < categoryIds.length; index += 1) {
          const categoryId = categoryIds[index];
          const mapping = mappingByCategoryId.get(categoryId);

          if (mapping) {
            await trx('menu_item_categories')
              .where({ id: mapping.id })
              .update({
                deleted_at: null,
                is_active: 1,
                is_primary_category: 0,
                display_order: index,
              });
          } else {
            await trx('menu_item_categories').insert({
              id: uuidv4(),
              menu_item_id: id,
              category_id: categoryId,
              restaurant_id: restaurantId,
              display_order: index,
              is_primary_category: 0,
              is_active: 1,
              created_at: now,
            });
          }
        }

        const desiredIds = new Set(categoryIds);
        const removeMappings = existingMappings.filter((row) => !desiredIds.has(row.category_id) && row.deleted_at === null && Number(row.is_active) === 1);

        for (const mapping of removeMappings) {
          await trx('menu_item_categories')
            .where({ id: mapping.id })
            .update({
              is_active: 0,
              is_primary_category: 0,
              deleted_at: now,
            });
        }
      }

      if ((item_type || existing.item_type) === 'addon_only') {
        await trx('menu_item_categories')
          .where({ menu_item_id: id, restaurant_id: restaurantId })
          .whereNull('deleted_at')
          .update({ is_active: 0, is_primary_category: 0, deleted_at: new Date() });
      }

      await trx('menu_item_categories')
        .where({ menu_item_id: id, restaurant_id: restaurantId })
        .update({ is_primary_category: 0 });

      if (item_type !== undefined || schedule !== undefined) {
        const nextItemType = item_type || existing.item_type;
        await upsertMenuItemSchedule(trx, restaurantId, id, nextItemType === 'scheduled' ? schedule : null);
      }

      if (addon_ids !== undefined || item_type !== undefined) {
        await reconcileMenuItemAddons(trx, restaurantId, id, addon_ids, item_type || existing.item_type);
      }

      await insertStaffActivityLog(trx, {
        restaurantId,
        staffId: actorStaffId,
        actionType: 'menu_item_updated',
        referenceType: 'menu_item',
        referenceId: id,
        notes: `Updated menu item ${name || existing.name}`,
      });
    });

    const [item] = await db('menu_items')
      .where({ id, restaurant_id: restaurantId })
      .whereNull('deleted_at')
      .select('*')
      .limit(1);

    const categoryMap = await getItemCategoriesByItemIds(restaurantId, [id]);
    const imageMap = await getMenuItemImages(restaurantId, [id]);
    const scheduleMap = await getSchedulesByItemIds(restaurantId, [id]);
    const addonMap = await getMenuItemAddonIds(restaurantId, [id]);
    const images = imageMap.get(id) || [];

    return res.json({
      data: {
        ...item,
        image_url: primaryImageUrl(images),
        images,
        schedule: scheduleMap.get(id) || null,
        addon_ids: addonMap.get(id) || [],
        is_available: Boolean(item.is_available),
        is_featured: Boolean(item.is_featured),
        categories: categoryMap.get(id) || [],
      },
    });
  } catch (error) {
    next(error);
  }
};

export const getMenuItemSchedule = async (req, res, next) => {
  try {
    const restaurantId = req.user.restaurantId;
    const { id } = req.params;
    const scheduleMap = await getSchedulesByItemIds(restaurantId, [id]);
    return res.json({ data: scheduleMap.get(id) || null });
  } catch (error) {
    next(error);
  }
};

export const createMenuItemSchedule = async (req, res, next) => {
  try {
    const restaurantId = req.user.restaurantId;
    const itemId = req.params.itemId;
    const [item] = await db('menu_items').where({ id: itemId, restaurant_id: restaurantId }).whereNull('deleted_at').select('id').limit(1);
    if (!item) return res.status(404).json({ error: 'Menu item not found' });
    await db('menu_item_schedules').insert({ id: uuidv4(), menu_item_id: itemId, restaurant_id: restaurantId, available_from: req.body.availableFrom, available_until: req.body.availableUntil, repeat_daily: req.body.repeatDaily, is_active: 1 }).onConflict('menu_item_id').merge({ available_from: req.body.availableFrom, available_until: req.body.availableUntil, repeat_daily: req.body.repeatDaily, is_active: 1 });
    return res.status(201).json({ data: await db('menu_item_schedules').where({ menu_item_id: itemId, restaurant_id: restaurantId }).first() });
  } catch (error) { next(error); }
};

export const updateMenuItemSchedule = async (req, res, next) => {
  try {
    const where = { id: req.params.id, restaurant_id: req.user.restaurantId };
    if (!await db('menu_item_schedules').where(where).first()) return res.status(404).json({ error: 'Schedule not found' });
    await db('menu_item_schedules').where(where).update({ available_from: req.body.availableFrom, available_until: req.body.availableUntil, repeat_daily: req.body.repeatDaily, updated_at: new Date() });
    return res.json({ data: await db('menu_item_schedules').where(where).first() });
  } catch (error) { next(error); }
};

export const deactivateMenuItemSchedule = async (req, res, next) => {
  try {
    const where = { id: req.params.id, restaurant_id: req.user.restaurantId };
    if (!await db('menu_item_schedules').where(where).update({ is_active: 0, updated_at: new Date() })) return res.status(404).json({ error: 'Schedule not found' });
    return res.json({ data: await db('menu_item_schedules').where(where).first() });
  } catch (error) { next(error); }
};

export const listMenuItemSchedules = async (req, res, next) => {
  try {
    const query = db('menu_item_schedules').where({ menu_item_id: req.params.itemId, restaurant_id: req.user.restaurantId });
    if (req.query.activeOnly === 'true') query.andWhere('is_active', 1);
    return res.json({ data: await query.orderBy('created_at', 'desc') });
  } catch (error) { next(error); }
};

export const setMenuItemAvailability = async (req, res, next) => {
  try {
    const restaurantId = req.user.restaurantId;
    const actorStaffId = req.user.id;
    const actorRole = req.user.role;
    const { id } = req.params;
    const { is_available, reason } = req.body;

    const [item] = await db('menu_items')
      .where({ id, restaurant_id: restaurantId })
      .whereNull('deleted_at')
      .select('id', 'is_available')
      .limit(1);

    if (!item) {
      return res.status(404).json({ error: 'Menu item not found' });
    }

    let previousState = Number(item.is_available) ? 1 : 0;
    let nextState = is_available ? 1 : 0;

    await db.transaction(async (trx) => {
      await trx('menu_items')
        .where({ id, restaurant_id: restaurantId })
        .whereNull('deleted_at')
        .update({
          is_available: nextState,
          updated_at: new Date(),
        });

      await trx('menu_item_availability_log').insert({
        id: uuidv4(),
        menu_item_id: id,
        restaurant_id: restaurantId,
        changed_by_staff_id: actorStaffId,
        changed_by_role: actorRole,
        trigger_type: 'manual',
        previous_value: previousState,
        new_value: nextState,
        reason: reason.trim(),
        order_item_id: null,
        created_at: new Date(),
      });

      await insertStaffActivityLog(trx, {
        restaurantId,
        staffId: actorStaffId,
        actionType: 'item_availability_toggled',
        referenceType: 'menu_item',
        referenceId: id,
        notes: `Availability set to ${is_available ? 'available' : 'unavailable'}`,
      });
    });

    await emitNotification({
      restaurantId,
      eventType: 'item:out_of_stock',
      payload: {
        menu_item_id: id,
        is_available: Boolean(is_available),
        changed_by_staff_id: actorStaffId,
      },
      targetRole: 'waiter',
    });

    return res.json({ success: true, is_available });
  } catch (error) {
    next(error);
  }
};

export const listMenuItemAvailabilityLog = async (req, res, next) => {
  try {
    const restaurantId = req.user.restaurantId;
    const page = Number(req.query.page || 1);
    const pageSize = Number(req.query.pageSize || 20);
    const base = db('menu_item_availability_log as log')
      .leftJoin('menu_items as item', 'item.id', 'log.menu_item_id')
      .leftJoin('staff', 'staff.id', 'log.changed_by_staff_id')
      .where('log.restaurant_id', restaurantId)
      .modify((query) => {
        if (req.query.item_id || req.query.menuItemId) query.andWhere('log.menu_item_id', req.query.item_id || req.query.menuItemId);
        if (req.query.staffId) query.andWhere('log.changed_by_staff_id', req.query.staffId);
        if (req.query.from) query.andWhere('log.created_at', '>=', req.query.from);
        if (req.query.to) query.andWhere('log.created_at', '<=', req.query.to);
      })
      .orderBy('log.created_at', 'desc')
      .limit(pageSize).offset((page - 1) * pageSize)
      .select(
        'log.id', 'log.menu_item_id', 'item.name as item_name', 'staff.name as staff_name',
        'log.changed_by_role', 'log.trigger_type', 'log.previous_value', 'log.new_value',
        'log.reason', 'log.created_at',
      );

    const [{ totalCount }] = await base.clone().clearSelect().clearOrder().clear('limit').clear('offset').count({ totalCount: 'log.id' });
    const rows = await base;
    const entries = rows.map((row) => ({
      ...row,
      previous_value: Boolean(row.previous_value),
      new_value: Boolean(row.new_value),
    }));
    return res.json({ entries, page, pageSize, totalCount: Number(totalCount), hasNextPage: page * pageSize < Number(totalCount) });
  } catch (error) {
    next(error);
  }
};

export const listMenuAvailabilityStaffOptions = async (req, res, next) => {
  try {
    const rows = await db('menu_item_availability_log as log')
      .leftJoin('staff', 'staff.id', 'log.changed_by_staff_id')
      .where('log.restaurant_id', req.user.restaurantId)
      .groupBy('log.changed_by_staff_id', 'log.changed_by_role', 'staff.name', 'staff.access', 'staff.deleted_at')
      .select('log.changed_by_staff_id as id', 'log.changed_by_role as role', 'staff.name', 'staff.access', 'staff.deleted_at')
      .orderBy('staff.name');
    return res.json({ data: rows.map((row) => ({ ...row, label: `${row.name || 'Former staff'}${row.access === 'revoked' || row.deleted_at ? ' (revoked)' : ''}` })) });
  } catch (error) { next(error); }
};

export const setMenuItemRatingsVisibility = async (req, res, next) => {
  try {
    const restaurantId = req.user.restaurantId;
    const { id } = req.params;
    const [item] = await db('menu_items')
      .where({ id, restaurant_id: restaurantId })
      .whereNull('deleted_at')
      .select('id')
      .limit(1);
    if (!item) return res.status(404).json({ error: 'Menu item not found' });

    await db('menu_items')
      .where({ id, restaurant_id: restaurantId })
      .whereNull('deleted_at')
      .update({ show_ratings: req.body.show_ratings, updated_at: new Date() });
    const [updated] = await db('menu_items').where({ id, restaurant_id: restaurantId }).select('*').limit(1);
    return res.json({ data: updated });
  } catch (error) {
    next(error);
  }
};

export const deleteMenuItem = async (req, res, next) => {
  try {
    const restaurantId = req.user.restaurantId;
    const actorStaffId = req.user.id;
    const { id } = req.params;

    await db.transaction(async (trx) => {
      const [item] = await trx('menu_items')
        .where({ id, restaurant_id: restaurantId })
        .whereNull('deleted_at')
        .select('id', 'name')
        .limit(1);

      if (!item) {
        const error = new Error('Menu item not found');
        error.status = 404;
        throw error;
      }

      const now = new Date();

      await trx('menu_items')
        .where({ id, restaurant_id: restaurantId })
        .whereNull('deleted_at')
        .update({
          deleted_at: now,
          updated_at: now,
        });

      await insertStaffActivityLog(trx, {
        restaurantId,
        staffId: actorStaffId,
        actionType: 'menu_item_deleted',
        referenceType: 'menu_item',
        referenceId: id,
        notes: `Soft deleted menu item ${item.name}`,
      });
    });

    return res.json({ success: true });
  } catch (error) {
    next(error);
  }
};

export const uploadMenuCategoryImage = async (req, res, next) => {
  try {
    if (!req.file) {
      return res.status(400).json({ error: 'Image file is required' });
    }

    const restaurantId = req.user.restaurantId;
    const { id } = req.params;
    const [category] = await db('menu_categories')
      .where({ id, restaurant_id: restaurantId })
      .whereNull('deleted_at')
      .select('id')
      .limit(1);
    if (!category) return res.status(404).json({ error: 'Category not found' });

    const imageUrl = await persistImage(req, req.file, restaurantId, 'category');
    await db('menu_categories').where({ id, restaurant_id: restaurantId }).update({ image_url: imageUrl, updated_at: new Date() });
    return res.status(201).json({ data: { image_url: imageUrl } });
  } catch (error) {
    next(error);
  }
};

export const uploadMenuItemImage = async (req, res, next) => {
  try {
    if (!req.file) return res.status(400).json({ error: 'Image file is required' });

    const restaurantId = req.user.restaurantId;
    const { id: menuItemId } = req.params;
    const [item] = await db('menu_items')
      .where({ id: menuItemId, restaurant_id: restaurantId })
      .whereNull('deleted_at')
      .select('id')
      .limit(1);
    if (!item) return res.status(404).json({ error: 'Menu item not found' });

    const imageCount = await db('menu_item_images')
      .where({ menu_item_id: menuItemId, restaurant_id: restaurantId })
      .whereNull('deleted_at')
      .count({ count: 'id' })
      .first();
    if (Number(imageCount?.count || 0) >= 5) {
      return res.status(422).json({ error: 'A menu item can have at most 5 images' });
    }

    const images = await getMenuItemImages(restaurantId, [menuItemId]);
    const currentImages = images.get(menuItemId) || [];
    const imageUrl = await persistImage(req, req.file, restaurantId, 'item');
    const image = {
      id: uuidv4(),
      menu_item_id: menuItemId,
      restaurant_id: restaurantId,
      image_url: imageUrl,
      display_order: currentImages.length,
      is_primary: currentImages.length === 0 ? 1 : 0,
      created_at: new Date(),
    };
    await db('menu_item_images').insert(image);
    return res.status(201).json({ data: { ...image, is_primary: Boolean(image.is_primary) } });
  } catch (error) {
    next(error);
  }
};

export const listMenuItemImages = async (req, res, next) => {
  try {
    const restaurantId = req.user.restaurantId;
    const { id } = req.params;
    const [item] = await db('menu_items').where({ id, restaurant_id: restaurantId }).whereNull('deleted_at').select('id').limit(1);
    if (!item) return res.status(404).json({ error: 'Menu item not found' });
    const images = await getMenuItemImages(restaurantId, [id]);
    return res.json({ data: images.get(id) || [] });
  } catch (error) {
    next(error);
  }
};

export const deleteMenuItemImage = async (req, res, next) => {
  try {
    const restaurantId = req.user.restaurantId;
    const { id: menuItemId, imageId } = req.params;
    const [image] = await db('menu_item_images')
      .where({ id: imageId, menu_item_id: menuItemId, restaurant_id: restaurantId })
      .whereNull('deleted_at')
      .select('id', 'is_primary')
      .limit(1);
    if (!image) return res.status(404).json({ error: 'Menu item image not found' });

    const now = new Date();
    await db.transaction(async (trx) => {
      await trx('menu_item_images').where({ id: imageId }).update({ deleted_at: now, is_primary: 0 });
      if (image.is_primary) {
        const [replacement] = await trx('menu_item_images')
          .where({ menu_item_id: menuItemId, restaurant_id: restaurantId })
          .whereNull('deleted_at')
          .orderBy('display_order', 'asc')
          .orderBy('created_at', 'asc')
          .select('id')
          .limit(1);
        if (replacement) await trx('menu_item_images').where({ id: replacement.id }).update({ is_primary: 1 });
      }
    });
    return res.json({ success: true });
  } catch (error) {
    next(error);
  }
};

export const listStaff = async (req, res, next) => {
  try {
    const restaurantId = req.user.restaurantId;
    const { role, access, search } = req.query;

    const query = db('staff as s')
      .where('s.restaurant_id', restaurantId)
      .whereNull('s.deleted_at')
      .select(
        's.id',
        's.name',
        's.email',
        's.phone',
        's.profile_photo_url',
        's.role',
        's.access',
        db.raw(`COALESCE(
          s.last_login_at,
          (SELECT MAX(ss.created_at) FROM staff_sessions ss WHERE ss.staff_id = s.id)
        ) as last_login_at`),
        db.raw('(SELECT MAX(ss.created_at) FROM staff_sessions ss WHERE ss.staff_id = s.id) as latest_session_at'),
        's.failed_login_attempts',
        's.locked_until',
        db.raw(`
          EXISTS (
            SELECT 1
            FROM staff_sessions ss
            WHERE ss.staff_id = s.id
              AND ss.status = 'active'
              AND ss.expires_at > NOW()
          ) as is_online
        `),
      )
      .orderBy('s.created_at', 'desc');

    if (search) {
      query.andWhere((builder) => {
        builder
          .where('s.name', 'like', `%${search}%`)
          .orWhere('s.email', 'like', `%${search}%`)
          .orWhere('s.phone', 'like', `%${search}%`);
      });
    }

    if (role) {
      query.andWhere('s.role', role);
    } else {
      query.whereIn('s.role', ['waiter', 'chef']);
    }

    if (access) {
      query.andWhere('s.access', access);
    }

    const rows = await query;

    return res.json({
      data: rows.map((row) => ({
        ...row,
        last_login_at: row.last_login_at || row.latest_session_at || null,
        is_online: Boolean(Number(row.is_online)),
        session_status: Boolean(Number(row.is_online)) ? 'online' : 'offline',
      })),
    });
  } catch (error) {
    next(error);
  }
};

export const createStaff = async (req, res, next) => {
  try {
    const restaurantId = req.user.restaurantId;
    const actorStaffId = req.user.id;
    const { name, email, phone, role } = req.body;

    const tempPassword = makeTempPassword();
    const passwordHash = await bcrypt.hash(tempPassword, 10);
    const staffId = uuidv4();

    const [restaurant] = await db('restaurants')
      .where({ id: restaurantId })
      .select('id', 'name')
      .limit(1);

    if (!restaurant) {
      return res.status(404).json({ error: 'Restaurant not found' });
    }

    let emailDelivery = null;

    await db.transaction(async (trx) => {
      await trx('staff').insert({
        id: staffId,
        restaurant_id: restaurantId,
        name,
        email,
        phone: phone || null,
        password_hash: passwordHash,
        role,
        access: 'active',
        created_by_staff_id: actorStaffId,
      });

      await insertStaffActivityLog(trx, {
        restaurantId,
        staffId: actorStaffId,
        actionType: 'staff_created',
        referenceType: 'staff',
        referenceId: staffId,
        notes: `Created ${role} account for ${email}`,
      });

      try {
        const sent = await sendStaffCredentialsEmail({
          to: email,
          staffName: name,
          restaurantName: restaurant.name,
          role,
          tempPassword,
        });

        await trx('email_logs').insert({
          id: uuidv4(),
          restaurant_id: restaurantId,
          staff_id: staffId,
          recipient_email: email,
          subject: `Your ${restaurant.name} RMS Admin Access`,
          status: 'sent',
          provider: sent.transport,
          provider_message_id: sent.messageId,
          sent_at: new Date(),
        });

        emailDelivery = sent;
      } catch (emailError) {
        await trx('email_logs').insert({
          id: uuidv4(),
          restaurant_id: restaurantId,
          staff_id: staffId,
          recipient_email: email,
          subject: `Your ${restaurant.name} RMS Admin Access`,
          status: 'failed',
          provider: process.env.SMTP_HOST ? 'smtp' : 'json',
          error_message: emailError instanceof Error ? emailError.message : 'Unknown email error',
        });

        emailDelivery = {
          sent: false,
          messageId: null,
          transport: process.env.SMTP_HOST ? 'smtp' : 'json',
        };
      }
    });

    return res.status(201).json({
      data: {
        id: staffId,
        email,
        role,
        invite_sent: Boolean(emailDelivery?.sent),
      },
    });
  } catch (error) {
    if (hasDupEntryOnGeneratedUnique(error)) {
      return res.status(409).json({ error: 'An active staff account with this email already exists for this restaurant' });
    }
    next(error);
  }
};

export const updateStaffAccess = async (req, res, next) => {
  try {
    const restaurantId = req.user.restaurantId;
    const actorStaffId = req.user.id;
    const { id } = req.params;
    const { access } = req.body;

    if (id === actorStaffId && access === 'revoked') {
      return res.status(400).json({ error: 'You cannot revoke your own account from this endpoint' });
    }

    const [target] = await db('staff')
      .where({ id, restaurant_id: restaurantId })
      .whereNull('deleted_at')
      .select('id', 'name', 'email', 'access')
      .limit(1);

    if (!target) {
      return res.status(404).json({ error: 'Staff account not found' });
    }

    await db.transaction(async (trx) => {
      await trx('staff')
        .where({ id, restaurant_id: restaurantId })
        .whereNull('deleted_at')
        .update({
          access,
          updated_at: new Date(),
        });

      if (access === 'revoked') {
        await trx('staff_sessions')
          .where({ staff_id: id, status: 'active' })
          .update({
            status: 'revoked',
            invalidated_at: new Date(),
          });

        await insertStaffActivityLog(trx, {
          restaurantId,
          staffId: actorStaffId,
          actionType: 'staff_revoked',
          referenceType: 'staff',
          referenceId: id,
          notes: `Revoked staff access for ${target.email}`,
        });
      }
    });

    return res.json({ success: true, access });
  } catch (error) {
    next(error);
  }
};

async function findTenantStaff(restaurantId, id) {
  const [staff] = await db('staff').where({ id, restaurant_id: restaurantId }).whereNull('deleted_at').select('id', 'name', 'email', 'role', 'access').limit(1);
  return staff;
}

async function invalidateStaffSessions(trx, staffId) {
  return trx('staff_sessions').where({ staff_id: staffId, status: 'active' }).whereNull('invalidated_at').update({ status: 'revoked', invalidated_at: new Date() });
}

export const revokeStaffAccess = async (req, res, next) => {
  try {
    const restaurantId = req.user.restaurantId;
    const actorStaffId = req.user.id;
    const { id } = req.params;
    if (id === actorStaffId) return res.status(400).json({ error: 'You cannot revoke your own account from this endpoint' });
    const target = await findTenantStaff(restaurantId, id);
    if (!target) return res.status(404).json({ error: 'Staff account not found' });
    await db.transaction(async (trx) => {
      await trx('staff').where({ id, restaurant_id: restaurantId }).whereNull('deleted_at').update({ access: 'revoked', updated_at: new Date() });
      await invalidateStaffSessions(trx, id);
      await insertStaffActivityLog(trx, { restaurantId, staffId: actorStaffId, actionType: 'staff_revoked', referenceType: 'staff', referenceId: id, notes: `Revoked staff access for ${target.email}` });
    });
    return res.json({ success: true, access: 'revoked' });
  } catch (error) { next(error); }
};

export const restoreStaffAccess = async (req, res, next) => {
  try {
    const restaurantId = req.user.restaurantId;
    const { id } = req.params;
    const target = await findTenantStaff(restaurantId, id);
    if (!target) return res.status(404).json({ error: 'Staff account not found' });
    await db.transaction(async (trx) => {
      await trx('staff').where({ id, restaurant_id: restaurantId }).whereNull('deleted_at').update({ access: 'active', updated_at: new Date() });
      await trx('staff_login_security').where({ staff_id: id }).update({ failed_attempts: 0, lockout_until: null, last_failed_at: null, locked_at: null, updated_at: new Date() });
    });
    return res.json({ success: true, access: 'active' });
  } catch (error) { next(error); }
};

export const resendStaffCredentials = async (req, res, next) => {
  try {
    const restaurantId = req.user.restaurantId;
    const { id } = req.params;

    const target = await findTenantStaff(restaurantId, id);

    if (!target) {
      return res.status(404).json({ error: 'Staff account not found' });
    }
    if (target.access === 'revoked') {
      return res.status(409).json({ error: 'Restore staff access before resending credentials' });
    }

    const [restaurant] = await db('restaurants')
      .where({ id: restaurantId })
      .select('name')
      .limit(1);

    const tempPassword = makeTempPassword();
    const passwordHash = await bcrypt.hash(tempPassword, 10);

    const emailLogId = uuidv4();
    const subject = `Your ${restaurant?.name || 'Restaurant'} RMS Admin Access`;
    await db.transaction(async (trx) => {
      await trx('staff').where({ id, restaurant_id: restaurantId }).whereNull('deleted_at').update({ password_hash: passwordHash, updated_at: new Date() });
      await invalidateStaffSessions(trx, id);
      await trx('email_logs').insert({ id: emailLogId, restaurant_id: restaurantId, staff_id: target.id, recipient_email: target.email, subject, status: 'failed', provider: process.env.SMTP_HOST ? 'smtp' : 'json' });
    });
    try {
      const sent = await sendStaffCredentialsEmail({ to: target.email, staffName: target.name, restaurantName: restaurant?.name || 'Restaurant', role: target.role, tempPassword });
      await db('email_logs').where({ id: emailLogId }).update({ status: 'sent', provider: sent.transport, provider_message_id: sent.messageId, sent_at: new Date(), error_message: null });
      return res.json({ success: true, invite_sent: true });
    } catch (emailError) {
      await db('email_logs').where({ id: emailLogId }).update({ status: 'failed', error_message: emailError instanceof Error ? emailError.message : 'Unknown email error' });
      return res.status(502).json({ error: 'Failed to resend credentials email' });
    }
  } catch (error) {
    next(error);
  }
};