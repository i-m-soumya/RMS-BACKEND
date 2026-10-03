import { randomUUID } from 'node:crypto';
import db from '../../db/connection.js';

const GSTIN_PATTERN = /^[0-9]{2}[A-Z]{5}[0-9]{4}[A-Z]{1}[1-9A-Z]{1}Z[0-9A-Z]{1}$/;
const REQUEST_TYPES = new Set(['slug_change', 'table_count_increase', 'table_count_decrease', 'qr_regeneration']);

function bad(message) {
  return Object.assign(new Error(message), { status: 400 });
}

function sendError(res, error) {
  return res.status(error.status || 500).json({ error: error.message || 'Settings operation failed' });
}

async function restaurantFor(req) {
  const [restaurant] = await db('restaurants').where({ id: req.user.restaurantId }).whereNull('deleted_at').limit(1);
  return restaurant;
}

export async function getRestaurantProfile(req, res, next) {
  try {
    const restaurant = await restaurantFor(req);
    if (!restaurant) return res.status(404).json({ error: 'Restaurant not found' });
    const contacts = await db('restaurant_contacts').where({ restaurant_id: restaurant.id }).whereNull('deleted_at').orderBy('created_at', 'asc');
    return res.json({ data: { ...restaurant, contacts } });
  } catch (error) { return next(error); }
}

export async function updateRestaurantProfile(req, res, next) {
  try {
    const restaurant = await restaurantFor(req);
    if (!restaurant) return res.status(404).json({ error: 'Restaurant not found' });
    const { name, logoUrl, welcomeMessage, managerName, address, city, state, pincode, country, timezone, currency, contacts = [] } = req.body;
    await db.transaction(async (trx) => {
      // Profile settings intentionally ignore slug, GST, legal-name, SAC-code, and table-count fields.
      await trx('restaurants').where({ id: restaurant.id }).update({ name, logo_url: logoUrl ?? null, welcome_message: welcomeMessage ?? null, manager_name: managerName ?? null, address, city, state, pincode, country, timezone, currency });
      const seen = new Set();
      for (const contact of contacts) {
        if (contact.isPrimary) {
          await trx('restaurant_contacts').where({ restaurant_id: restaurant.id, contact_type: contact.contactType }).whereNull('deleted_at').update({ is_primary: 0 });
        }
        const id = contact.id || randomUUID();
        const values = { restaurant_id: restaurant.id, contact_type: contact.contactType, contact_value: contact.contactValue, is_primary: contact.isPrimary ? 1 : 0, label: contact.label ?? null, deleted_at: null };
        const [existing] = contact.id ? await trx('restaurant_contacts').where({ id: contact.id, restaurant_id: restaurant.id }).limit(1) : [];
        if (existing) await trx('restaurant_contacts').where({ id: contact.id, restaurant_id: restaurant.id }).update(values);
        else await trx('restaurant_contacts').insert({ id, ...values });
        seen.add(id);
      }
      const existingContacts = await trx('restaurant_contacts').where({ restaurant_id: restaurant.id }).whereNull('deleted_at').select('id');
      const removedIds = existingContacts.map((contact) => contact.id).filter((id) => !seen.has(id));
      if (removedIds.length) await trx('restaurant_contacts').whereIn('id', removedIds).update({ deleted_at: new Date(), is_primary: 0 });
    });
    return getRestaurantProfile(req, res, next);
  } catch (error) { return next(error); }
}

export async function getRestaurantGst(req, res, next) {
  try {
    const restaurant = await restaurantFor(req);
    if (!restaurant) return res.status(404).json({ error: 'Restaurant not found' });
    const [tax] = await db('restaurant_tax_config').where({ restaurant_id: restaurant.id }).limit(1);
    return res.json({ data: { gstRegistered: Boolean(restaurant.gst_registered), gstin: restaurant.gstin, legalName: restaurant.legal_name, sacCode: restaurant.sac_code, registeredAddress: restaurant.registered_address, gstRate: Number(tax?.gst_rate || 0), cgstRate: Number(tax?.cgst_rate || 0), sgstRate: Number(tax?.sgst_rate || 0), igstRate: Number(tax?.igst_rate || 0), showOnBill: tax ? Boolean(tax.show_on_bill) : true } });
  } catch (error) { return next(error); }
}

export async function updateRestaurantGst(req, res, next) {
  try {
    const restaurant = await restaurantFor(req);
    if (!restaurant) return res.status(404).json({ error: 'Restaurant not found' });
    const { gstRegistered, gstin, legalName, sacCode, registeredAddress, gstRate, cgstRate, sgstRate, igstRate = 0, showOnBill } = req.body;
    if (gstRegistered && (!gstin || !GSTIN_PATTERN.test(gstin))) throw bad('A valid GSTIN is required when GST is registered');
    if (gstRegistered && !legalName) throw bad('Legal name is required when GST is registered');
    if (Math.abs((cgstRate + sgstRate) - gstRate) > 0.01) throw bad('CGST plus SGST must equal GST rate');
    if (igstRate > 0 && (cgstRate > 0 || sgstRate > 0)) throw bad('IGST cannot be combined with CGST or SGST');
    await db.transaction(async (trx) => {
      await trx('restaurants').where({ id: restaurant.id }).update({ gst_registered: gstRegistered ? 1 : 0, ...(gstRegistered && gstin ? { gstin } : {}), legal_name: legalName || null, sac_code: sacCode || null, registered_address: registeredAddress || null });
      const [existing] = await trx('restaurant_tax_config').where({ restaurant_id: restaurant.id }).limit(1);
      const values = { restaurant_id: restaurant.id, gst_rate: gstRate, cgst_rate: cgstRate, sgst_rate: sgstRate, igst_rate: igstRate, show_on_bill: showOnBill ? 1 : 0 };
      if (existing) await trx('restaurant_tax_config').where({ id: existing.id }).update({ ...values, updated_by_staff_id: req.user.id });
      else await trx('restaurant_tax_config').insert({ id: randomUUID(), ...values, updated_by_staff_id: req.user.id });
    });
    return getRestaurantGst(req, res, next);
  } catch (error) { return error.status ? sendError(res, error) : next(error); }
}

function validateShifts(shifts) {
  const normalized = shifts.map((shift) => ({ ...shift, openTime: shift.isClosed ? '00:00' : shift.openTime, closeTime: shift.isClosed ? '00:01' : shift.closeTime }));
  for (const shift of normalized) if (shift.closeTime <= shift.openTime) throw bad('closeTime must be later than openTime');
  for (let first = 0; first < normalized.length; first += 1) for (let second = first + 1; second < normalized.length; second += 1) {
    if (normalized[first].openTime < normalized[second].closeTime && normalized[second].openTime < normalized[first].closeTime) throw bad('Operating shifts cannot overlap');
  }
  return normalized;
}

export async function getOperatingHours(req, res, next) {
  try { return res.json({ data: await db('operating_hours').where({ restaurant_id: req.user.restaurantId }).orderBy('day_of_week').orderBy('open_time') }); } catch (error) { return next(error); }
}

export async function updateOperatingHours(req, res, next) {
  try {
    const { dayOfWeek, shifts } = req.body;
    const existing = await db('operating_hours').where({ restaurant_id: req.user.restaurantId, day_of_week: dayOfWeek });
    const submittedIds = new Set(shifts.map((shift) => shift.id).filter(Boolean));
    const merged = existing.filter((shift) => !submittedIds.has(shift.id)).map((shift) => ({ openTime: String(shift.open_time).slice(0, 5), closeTime: String(shift.close_time).slice(0, 5), isClosed: Boolean(shift.is_closed) })).concat(shifts);
    validateShifts(merged);
    await db.transaction(async (trx) => {
      await trx('operating_hours').where({ restaurant_id: req.user.restaurantId, day_of_week: dayOfWeek }).whereIn('id', shifts.map((shift) => shift.id).filter(Boolean)).delete();
      for (const shift of validateShifts(shifts)) await trx('operating_hours').insert({ id: shift.id || randomUUID(), restaurant_id: req.user.restaurantId, day_of_week: dayOfWeek, shift_label: shift.shiftLabel || null, open_time: shift.openTime, close_time: shift.closeTime, is_closed: shift.isClosed ? 1 : 0, updated_by: req.user.id });
    });
    return getOperatingHours(req, res, next);
  } catch (error) { return error.status ? sendError(res, error) : next(error); }
}

export async function listRestaurantChangeRequests(req, res, next) {
  try { return res.json({ data: await db('change_requests').where({ restaurant_id: req.user.restaurantId }).orderBy('requested_at', 'desc') }); } catch (error) { return next(error); }
}

export async function createRestaurantChangeRequest(req, res, next) {
  try {
    const { requestType, requestedValue, reason } = req.body;
    if (!REQUEST_TYPES.has(requestType)) throw bad('Invalid request type');
    const [pending] = await db('change_requests').where({ restaurant_id: req.user.restaurantId, request_type: requestType, status: 'pending' }).orderBy('requested_at', 'desc').limit(1);
    if (pending) return res.status(409).json({ error: `A pending ${pending.request_type} request already exists from ${new Date(pending.requested_at).toISOString().slice(0, 10)}` });
    const restaurant = await restaurantFor(req);
    const currentValue = requestType === 'slug_change' ? restaurant.slug : requestType.startsWith('table_count') ? String(restaurant.table_count) : 'current';
    const id = randomUUID();
    await db('change_requests').insert({ id, restaurant_id: req.user.restaurantId, requested_by_staff_id: req.user.id, request_type: requestType, current_value: currentValue, requested_value: requestedValue, reason, status: 'pending' });
    const [created] = await db('change_requests').where({ id }).limit(1);
    return res.status(201).json({ data: created });
  } catch (error) { return error.status ? sendError(res, error) : next(error); }
}
