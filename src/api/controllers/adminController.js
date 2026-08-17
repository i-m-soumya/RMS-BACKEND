import bcrypt from 'bcrypt';
import { v4 as uuidv4 } from 'uuid';
import db from '../../db/connection.js';
import { sendStaffCredentialsEmail } from '../../services/emailService.js';

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
    .andWhereNull('mic.deleted_at')
    .andWhereNull('mc.deleted_at')
    .select(
      'mic.menu_item_id',
      'mc.id as category_id',
      'mc.name as category_name',
      'mic.is_primary_category',
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
      is_primary_category: Boolean(row.is_primary_category),
    });
  }

  return map;
}

async function assertValidCategoryIds(trx, restaurantId, categoryIds) {
  const rows = await trx('menu_categories')
    .where('restaurant_id', restaurantId)
    .whereIn('id', categoryIds)
    .andWhereNull('deleted_at')
    .andWhere('is_active', 1)
    .select('id');

  if (rows.length !== categoryIds.length) {
    return false;
  }

  return true;
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
      .andWhereNull('mc.deleted_at')
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
        .andWhereNull('deleted_at')
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
      .andWhereNull('deleted_at')
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
      .andWhereNull('deleted_at')
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
      .andWhereNull('deleted_at')
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
          .andWhereNull('deleted_at')
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
      .andWhereNull('deleted_at')
      .select('id')
      .limit(1);

    if (!category) {
      return res.status(404).json({ error: 'Category not found' });
    }

    const mapped = await db('menu_item_categories as mic')
      .join('menu_items as mi', 'mi.id', 'mic.menu_item_id')
      .where('mic.restaurant_id', restaurantId)
      .andWhere('mic.category_id', id)
      .andWhere('mic.is_active', 1)
      .andWhereNull('mic.deleted_at')
      .andWhereNull('mi.deleted_at')
      .first('mic.id');

    if (mapped) {
      return res.status(409).json({ error: 'Category cannot be deleted while it is mapped to active menu items' });
    }

    await db('menu_categories')
      .where({ id, restaurant_id: restaurantId })
      .andWhereNull('deleted_at')
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
      .andWhereNull('mi.deleted_at');

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
          .andWhereNull('mic.deleted_at'),
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

    res.json({
      data: rows.map((row) => ({
        ...row,
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
      primary_category_id,
      mrp,
      price,
      image_url,
      item_type,
      dietary_type,
      spice_level,
      is_available,
    } = req.body;

    const itemId = uuidv4();
    const primaryCategory = primary_category_id || category_ids[0];
    const now = new Date();

    const savedItem = await db.transaction(async (trx) => {
      const categoryIds = [...new Set(category_ids)];
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
        image_url: image_url || null,
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
          is_primary_category: categoryId === primaryCategory ? 1 : 0,
          is_active: 1,
          created_at: now,
        });
      }

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
    return res.status(201).json({
      data: {
        ...savedItem,
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
      primary_category_id,
      mrp,
      price,
      image_url,
      item_type,
      dietary_type,
      spice_level,
      is_available,
    } = req.body;

    await db.transaction(async (trx) => {
      const [existing] = await trx('menu_items')
        .where({ id, restaurant_id: restaurantId })
        .andWhereNull('deleted_at')
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
        ...(image_url !== undefined && { image_url }),
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
        .andWhereNull('deleted_at')
        .update(itemUpdate);

      if (category_ids !== undefined) {
        const categoryIds = [...new Set(category_ids)];
        const categoriesOk = await assertValidCategoryIds(trx, restaurantId, categoryIds);
        if (!categoriesOk) {
          const error = new Error('One or more category_ids are invalid for this restaurant');
          error.status = 400;
          throw error;
        }

        const targetPrimary = primary_category_id || categoryIds[0];
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
                is_primary_category: categoryId === targetPrimary ? 1 : 0,
                display_order: index,
              });
          } else {
            await trx('menu_item_categories').insert({
              id: uuidv4(),
              menu_item_id: id,
              category_id: categoryId,
              restaurant_id: restaurantId,
              display_order: index,
              is_primary_category: categoryId === targetPrimary ? 1 : 0,
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
      .andWhereNull('deleted_at')
      .select('*')
      .limit(1);

    const categoryMap = await getItemCategoriesByItemIds(restaurantId, [id]);

    return res.json({
      data: {
        ...item,
        is_available: Boolean(item.is_available),
        is_featured: Boolean(item.is_featured),
        categories: categoryMap.get(id) || [],
      },
    });
  } catch (error) {
    next(error);
  }
};

export const setMenuItemAvailability = async (req, res, next) => {
  try {
    const restaurantId = req.user.restaurantId;
    const actorStaffId = req.user.id;
    const actorRole = req.user.role;
    const { id } = req.params;
    const { is_available } = req.body;

    const [item] = await db('menu_items')
      .where({ id, restaurant_id: restaurantId })
      .andWhereNull('deleted_at')
      .select('id', 'is_available')
      .limit(1);

    if (!item) {
      return res.status(404).json({ error: 'Menu item not found' });
    }

    await db.transaction(async (trx) => {
      await trx('menu_items')
        .where({ id, restaurant_id: restaurantId })
        .andWhereNull('deleted_at')
        .update({
          is_available: is_available ? 1 : 0,
          updated_at: new Date(),
        });

      await trx('menu_item_availability_log').insert({
        id: uuidv4(),
        menu_item_id: id,
        restaurant_id: restaurantId,
        changed_by_staff_id: actorStaffId,
        changed_by_role: actorRole,
        trigger_type: 'manual',
        previous_value: Number(item.is_available) ? 1 : 0,
        new_value: is_available ? 1 : 0,
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

    return res.json({ success: true, is_available });
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
        .andWhereNull('deleted_at')
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
        .andWhereNull('deleted_at')
        .update({
          deleted_at: now,
          updated_at: now,
        });

      await trx('menu_item_categories')
        .where({ menu_item_id: id, restaurant_id: restaurantId })
        .andWhereNull('deleted_at')
        .update({
          is_active: 0,
          is_primary_category: 0,
          deleted_at: now,
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

export const uploadMenuItemPhoto = async (req, res, next) => {
  try {
    const { image_data_url } = req.body;

    if (!image_data_url || typeof image_data_url !== 'string') {
      return res.status(400).json({ error: 'image_data_url is required' });
    }

    if (!image_data_url.startsWith('data:image/')) {
      return res.status(400).json({ error: 'Only image data URLs are supported by the current upload handler' });
    }

    return res.status(201).json({ data: { image_url: image_data_url } });
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
      .andWhereNull('s.deleted_at')
      .select(
        's.id',
        's.name',
        's.email',
        's.phone',
        's.profile_photo_url',
        's.role',
        's.access',
        's.last_login_at',
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
      .andWhereNull('deleted_at')
      .select('id', 'name', 'email', 'access')
      .limit(1);

    if (!target) {
      return res.status(404).json({ error: 'Staff account not found' });
    }

    await db.transaction(async (trx) => {
      await trx('staff')
        .where({ id, restaurant_id: restaurantId })
        .andWhereNull('deleted_at')
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

export const resendStaffCredentials = async (req, res, next) => {
  try {
    const restaurantId = req.user.restaurantId;
    const { id } = req.params;

    const [target] = await db('staff')
      .where({ id, restaurant_id: restaurantId })
      .andWhereNull('deleted_at')
      .select('id', 'name', 'email', 'role')
      .limit(1);

    if (!target) {
      return res.status(404).json({ error: 'Staff account not found' });
    }

    const [restaurant] = await db('restaurants')
      .where({ id: restaurantId })
      .select('name')
      .limit(1);

    const tempPassword = makeTempPassword();
    const passwordHash = await bcrypt.hash(tempPassword, 10);

    await db('staff')
      .where({ id, restaurant_id: restaurantId })
      .andWhereNull('deleted_at')
      .update({
        password_hash: passwordHash,
        updated_at: new Date(),
      });

    try {
      const sent = await sendStaffCredentialsEmail({
        to: target.email,
        staffName: target.name,
        restaurantName: restaurant?.name || 'Restaurant',
        role: target.role,
        tempPassword,
      });

      await db('email_logs').insert({
        id: uuidv4(),
        restaurant_id: restaurantId,
        staff_id: target.id,
        recipient_email: target.email,
        subject: `Your ${restaurant?.name || 'Restaurant'} RMS Admin Access`,
        status: 'sent',
        provider: sent.transport,
        provider_message_id: sent.messageId,
        sent_at: new Date(),
      });

      return res.json({ success: true, invite_sent: true });
    } catch (emailError) {
      await db('email_logs').insert({
        id: uuidv4(),
        restaurant_id: restaurantId,
        staff_id: target.id,
        recipient_email: target.email,
        subject: `Your ${restaurant?.name || 'Restaurant'} RMS Admin Access`,
        status: 'failed',
        provider: process.env.SMTP_HOST ? 'smtp' : 'json',
        error_message: emailError instanceof Error ? emailError.message : 'Unknown email error',
      });

      return res.status(502).json({ error: 'Failed to resend credentials email' });
    }
  } catch (error) {
    next(error);
  }
};