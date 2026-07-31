import bcrypt from 'bcrypt';
import * as archiverPackage from 'archiver';
import { v4 as uuidv4 } from 'uuid';
import db from '../../db/connection.js';
import { sendAdminCredentialsEmail } from '../../services/emailService.js';
import {
  buildTableQrPayload,
  generateQrDataUrl,
  generateQrPngBuffer,
} from '../../services/qrService.js';

const archiver = archiverPackage.default ?? archiverPackage;

function makeTempPassword() {
  const alphabet = 'ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnopqrstuvwxyz23456789!@#$';
  return Array.from({ length: 12 }, () => alphabet[Math.floor(Math.random() * alphabet.length)]).join('');
}

function ensureSlug(value) {
  return value
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9-]/g, '-')
    .replace(/-+/g, '-')
    .replace(/^-|-$/g, '');
}

function buildRestaurantRowSummary(row) {
  return {
    id: row.id,
    name: row.name,
    slug: row.slug,
    status: row.status || 'active',
    tableCount: Number(row.table_count || 0),
    onboardedAt: row.created_at || new Date().toISOString(),
    city: row.city || '',
    state: row.state || '',
    pincode: row.pincode || '',
    timezone: row.timezone || 'Asia/Kolkata',
    address: row.address || '',
  };
}

export const listRestaurants = async (req, res, next) => {
  try {
    const { q, status, city, page, pageSize } = req.query;

    const baseQuery = db('restaurants as r')
      .leftJoin('tables as t', 't.restaurant_id', 'r.id')
      .groupBy('r.id');

    if (q) {
      baseQuery.andWhere((builder) => {
        builder
          .where('r.name', 'like', `%${q}%`)
          .orWhere('r.slug', 'like', `%${q}%`);
      });
    }

    if (status) {
      baseQuery.andWhere('r.status', status);
    }

    if (city) {
      baseQuery.andWhere('r.city', 'like', `%${city}%`);
    }

    const countRows = await db('restaurants as r')
      .modify((queryBuilder) => {
        if (q) {
          queryBuilder.andWhere((builder) => {
            builder
              .where('r.name', 'like', `%${q}%`)
              .orWhere('r.slug', 'like', `%${q}%`);
          });
        }
        if (status) queryBuilder.andWhere('r.status', status);
        if (city) queryBuilder.andWhere('r.city', 'like', `%${city}%`);
      })
      .count({ total: 'r.id' })
      .first();

    const rows = await baseQuery
      .select(
        'r.id',
        'r.name',
        'r.slug',
        'r.status',
        'r.created_at',
        'r.city',
        'r.state',
        'r.pincode',
        'r.timezone',
        'r.address',
      )
      .countDistinct({ table_count: 't.id' })
      .orderBy('r.created_at', 'desc')
      .offset((page - 1) * pageSize)
      .limit(pageSize);

    const restaurants = rows.map((row) => buildRestaurantRowSummary(row));
    const total = Number(countRows?.total || 0);

    res.json({
      data: restaurants,
      meta: {
        page,
        pageSize,
        total,
      },
    });
  } catch (error) {
    next(error);
  }
};

export const createRestaurantBasicDetails = async (req, res, next) => {
  try {
    const payload = req.body;
    const slug = ensureSlug(payload.slug);

    const [existing] = await db('restaurants').where({ slug }).limit(1);
    if (existing) {
      return res.status(409).json({ error: 'Restaurant slug already exists' });
    }

    const restaurantId = uuidv4();
    const normalized = {
      id: restaurantId,
      name: payload.name,
      legal_name: payload.name,
      slug,
      address: payload.address,
      city: payload.city,
      state: payload.state,
      pincode: payload.pincode,
      timezone: payload.timezone,
      contact_email: payload.contactEmail || `hello@${slug}.local`,
      manager_name: payload.name,
      country: 'India',
      currency: 'INR',
      onboarded_by: req.user.id,
      status: 'active',
      table_count: 0,
    };

    await db('restaurants').insert(normalized);

    const [restaurant] = await db('restaurants').where({ id: restaurantId }).limit(1);
    return res.status(201).json({
      data: {
        id: restaurantId,
        name: restaurant?.name || payload.name,
        slug,
      },
    });
  } catch (error) {
    next(error);
  }
};

export const updateRestaurantBasicDetails = async (req, res, next) => {
  try {
    const { restaurantId } = req.params;
    const payload = req.body;

    const [restaurant] = await db('restaurants').where({ id: restaurantId }).limit(1);
    if (!restaurant) {
      return res.status(404).json({ error: 'Restaurant not found' });
    }

    if (payload.slug) {
      const slug = ensureSlug(payload.slug);
      const [existing] = await db('restaurants').where({ slug }).andWhereNot({ id: restaurantId }).limit(1);
      if (existing) {
        return res.status(409).json({ error: 'Restaurant slug already exists' });
      }
      payload.slug = slug;
    }

    const updates = {};
    const map = {
      name: 'name',
      slug: 'slug',
      address: 'address',
      city: 'city',
      state: 'state',
      pincode: 'pincode',
      timezone: 'timezone',
      contactEmail: 'contact_email',
    };

    Object.entries(map).forEach(([from, to]) => {
      if (payload[from] !== undefined) {
        updates[to] = payload[from];
      }
    });

    if (Object.keys(updates).length === 0) {
      return res.status(400).json({ error: 'No writable fields provided' });
    }

    await db('restaurants').where({ id: restaurantId }).update(updates);

    return res.json({ data: { id: restaurantId, ...updates } });
  } catch (error) {
    next(error);
  }
};

export const saveFloorsAndTables = async (req, res, next) => {
  try {
    const { restaurantId } = req.params;
    const { floors } = req.body;

    const [restaurant] = await db('restaurants').where({ id: restaurantId }).limit(1);
    if (!restaurant) {
      return res.status(404).json({ error: 'Restaurant not found' });
    }

    const normalizedTableNumbers = new Set();
    for (const floor of floors) {
      for (const table of floor.tables) {
        const normalized = String(table.tableNumber).trim().toLowerCase();
        if (normalizedTableNumbers.has(normalized)) {
          return res.status(422).json({ error: `Duplicate table number found: ${table.tableNumber}` });
        }
        normalizedTableNumbers.add(normalized);
      }
    }

    await db.transaction(async (trx) => {
      await trx('tables').where({ restaurant_id: restaurantId }).del();
      await trx('floors').where({ restaurant_id: restaurantId }).del();

      for (let floorIndex = 0; floorIndex < floors.length; floorIndex += 1) {
        const floor = floors[floorIndex];
        const floorId = uuidv4();

        await trx('floors').insert({
          id: floorId,
          restaurant_id: restaurantId,
          name: floor.name,
          floor_order: floorIndex + 1,
          display_order: floorIndex + 1,
          is_active: 1,
        });

        for (const table of floor.tables) {
          const tableId = uuidv4();
          await trx('tables').insert({
            id: tableId,
            restaurant_id: restaurantId,
            floor_id: floorId,
            name: `Table ${table.tableNumber}`,
            table_number: String(table.tableNumber),
            capacity: table.capacity,
            seating_capacity: table.capacity,
            status: 'available',
            is_active: 1,
          });
        }
      }

      await trx('restaurants').where({ id: restaurantId }).update({ table_count: normalizedTableNumbers.size });
    });

    return res.json({
      data: {
        restaurantId,
        floorCount: floors.length,
        tableCount: normalizedTableNumbers.size,
      },
    });
  } catch (error) {
    next(error);
  }
};

async function loadRestaurantTables(restaurantId) {
  const rows = await db('tables as t')
    .leftJoin('floors as f', 'f.id', 't.floor_id')
    .select('t.id', 't.table_number', 'f.name as floor_name')
    .where('t.restaurant_id', restaurantId)
    .orderBy('f.name', 'asc')
    .orderBy('t.table_number', 'asc');

  return rows;
}

export const generateRestaurantQRCodes = async (req, res, next) => {
  try {
    const { restaurantId } = req.params;

    const [restaurant] = await db('restaurants').where({ id: restaurantId }).limit(1);
    if (!restaurant) {
      return res.status(404).json({ error: 'Restaurant not found' });
    }

    const tables = await loadRestaurantTables(restaurantId);
    const items = await Promise.all(
      tables.map(async (table) => {
        const qrPayload = buildTableQrPayload(restaurant.slug, table.table_number);
        const qrDataUrl = await generateQrDataUrl(qrPayload);

        return {
          tableId: table.id,
          tableNumber: table.table_number,
          floor: table.floor_name || 'N/A',
          qrPayload,
          qrDataUrl,
          filename: `${restaurant.slug}-table-${table.table_number}.png`,
        };
      }),
    );

    for (const item of items) {
      await db('table_qr_codes').insert({
        id: uuidv4(),
        restaurant_id: restaurantId,
        table_id: item.tableId,
        payload: item.qrPayload,
        generated_at: new Date(),
        created_by_platform_admin_id: req.user.id,
      });
    }

    return res.json({
      data: {
        restaurantId,
        generatedAt: new Date().toISOString(),
        items,
      },
    });
  } catch (error) {
    next(error);
  }
};

export const downloadTableQrCode = async (req, res, next) => {
  try {
    const { tableId } = req.params;

    const [table] = await db('tables as t')
      .join('restaurants as r', 'r.id', 't.restaurant_id')
      .select('t.id', 't.table_number', 'r.slug')
      .where('t.id', tableId)
      .limit(1);

    if (!table) {
      return res.status(404).json({ error: 'Table not found' });
    }

    const qrPayload = buildTableQrPayload(table.slug, table.table_number);
    const png = await generateQrPngBuffer(qrPayload);

    res.setHeader('Content-Type', 'image/png');
    res.setHeader('Content-Disposition', `attachment; filename="${table.slug}-table-${table.table_number}.png"`);
    return res.send(png);
  } catch (error) {
    next(error);
  }
};

export const getRestaurantQrBatch = async (req, res, next) => {
  try {
    const { restaurantId } = req.params;

    const [restaurant] = await db('restaurants').where({ id: restaurantId }).limit(1);
    if (!restaurant) {
      return res.status(404).json({ error: 'Restaurant not found' });
    }

    const tables = await loadRestaurantTables(restaurantId);
    const items = await Promise.all(
      tables.map(async (table) => {
        const qrPayload = buildTableQrPayload(restaurant.slug, table.table_number);
        const qrDataUrl = await generateQrDataUrl(qrPayload);
        return {
          tableId: table.id,
          tableNumber: table.table_number,
          floor: table.floor_name || 'N/A',
          qrPayload,
          qrDataUrl,
          filename: `${restaurant.slug}-table-${table.table_number}.png`,
        };
      }),
    );

    return res.json({
      data: {
        restaurantId,
        items,
      },
    });
  } catch (error) {
    next(error);
  }
};

export const downloadRestaurantQrBatchZip = async (req, res, next) => {
  try {
    const { restaurantId } = req.params;

    const [restaurant] = await db('restaurants').where({ id: restaurantId }).limit(1);
    if (!restaurant) {
      return res.status(404).json({ error: 'Restaurant not found' });
    }

    const tables = await loadRestaurantTables(restaurantId);
    if (tables.length === 0) {
      return res.status(404).json({ error: 'No tables found for restaurant' });
    }

    res.setHeader('Content-Type', 'application/zip');
    res.setHeader('Content-Disposition', `attachment; filename="${restaurant.slug}-table-qrs.zip"`);

    const archive = archiver('zip', { zlib: { level: 9 } });
    archive.on('error', (error) => {
      next(error);
    });

    archive.pipe(res);

    for (const table of tables) {
      const qrPayload = buildTableQrPayload(restaurant.slug, table.table_number);
      const png = await generateQrPngBuffer(qrPayload);
      archive.append(png, { name: `${restaurant.slug}-table-${table.table_number}.png` });
    }

    await archive.finalize();
    return undefined;
  } catch (error) {
    next(error);
    return undefined;
  }
};

export const createRestaurantAdminCredentials = async (req, res, next) => {
  try {
    const { restaurantId } = req.params;
    const { name, email } = req.body;
    const tempPassword = req.body.tempPassword || makeTempPassword();

    const [restaurant] = await db('restaurants').where({ id: restaurantId }).limit(1);
    if (!restaurant) {
      return res.status(404).json({ error: 'Restaurant not found' });
    }

    const existing = await db('staff')
      .where({ restaurant_id: restaurantId, email })
      .andWhere('deleted_at', null)
      .limit(1);

    if (existing.length > 0) {
      return res.status(409).json({ error: 'Staff account with this email already exists for the restaurant' });
    }

    const passwordHash = await bcrypt.hash(tempPassword, 10);
    const staffId = uuidv4();

    await db('staff').insert({
      id: staffId,
      restaurant_id: restaurantId,
      name,
      email,
      password_hash: passwordHash,
      role: 'restaurant_admin',
      access: 'active',
      created_by_platform_admin_id: req.user.id,
    });

    let emailDelivery;
    try {
      const sent = await sendAdminCredentialsEmail({
        to: email,
        adminName: name,
        restaurantName: restaurant.name,
        tempPassword,
      });

      await db('email_logs').insert({
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
      await db('email_logs').insert({
        id: uuidv4(),
        restaurant_id: restaurantId,
        staff_id: staffId,
        recipient_email: email,
        subject: `Your ${restaurant.name} RMS Admin Access`,
        status: 'failed',
        error_message: emailError instanceof Error ? emailError.message : 'Unknown email error',
      });

      emailDelivery = {
        sent: false,
        messageId: null,
        transport: 'smtp',
      };
    }

    return res.status(201).json({
      data: {
        staffId,
        email,
        role: 'restaurant_admin',
        tempPassword,
        emailDelivery,
      },
    });
  } catch (error) {
    if (error.code === 'ER_DUP_ENTRY') {
      return res.status(409).json({ error: 'Staff account already exists' });
    }
    next(error);
  }
};
