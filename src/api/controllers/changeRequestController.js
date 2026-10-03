import { randomUUID } from 'node:crypto';
import db from '../../db/connection.js';
import { buildTableQrPayload } from '../../services/qrService.js';

const REQUEST_TYPES = new Set([
  'slug_change',
  'table_count_increase',
  'table_count_decrease',
  'qr_regeneration',
]);

function parseDelta(value) {
  const delta = Number.parseInt(String(value).trim(), 10);
  if (!Number.isInteger(delta) || delta <= 0 || String(delta) !== String(value).trim()) {
    throw Object.assign(new Error('requested_value must be a positive integer delta'), { status: 400 });
  }
  return delta;
}

function parseQrTargets(value) {
  const raw = String(value).trim();
  if (raw === 'all') return 'all';
  const ids = raw.split(',').map((id) => id.trim()).filter(Boolean);
  if (!ids.length || ids.some((id) => !/^[0-9a-f-]{36}$/i.test(id))) {
    throw Object.assign(new Error('requested_value must be "all" or comma-separated table IDs'), { status: 400 });
  }
  return [...new Set(ids)];
}

function requestError(res, status, error) {
  return res.status(status).json({ error: error.message || String(error) });
}

async function notifyChangeRequest(trx, request, adminId, approved, message) {
  const now = new Date();
  await trx('notifications').insert({
    id: randomUUID(),
    restaurant_id: request.restaurant_id,
    recipient_staff_id: request.requested_by_staff_id,
    recipient_type: 'staff',
    type: approved ? 'change_request_approved' : 'change_request_rejected',
    title: approved ? 'Change request approved' : 'Change request rejected',
    body: JSON.stringify({ message, change_request_id: request.id, reviewed_by: adminId }),
    status: 'pending',
    channel: 'in_app',
    expires_at: new Date(now.getTime() + 30 * 24 * 60 * 60 * 1000),
    is_read: 0,
    read_at: null,
    reference_id: request.id,
    reference_type: 'change_request',
    created_at: now,
    updated_at: now,
  });
}

export async function listChangeRequests(req, res, next) {
  try {
    const query = db('change_requests as cr')
      .join('restaurants as r', 'r.id', 'cr.restaurant_id')
      .join('staff as s', 's.id', 'cr.requested_by_staff_id')
      .select(
        'cr.*',
        'r.name as restaurant_name',
        'r.slug as restaurant_slug',
        's.name as requested_by_name',
        's.email as requested_by_email',
      )
      .orderBy('cr.requested_at', 'desc');

    if (req.query.status) query.where('cr.status', req.query.status);
    if (req.query.type) query.where('cr.request_type', req.query.type);
    if (req.query.status && !['pending', 'approved', 'rejected', 'cancelled'].includes(req.query.status)) {
      return res.status(400).json({ error: 'Invalid status filter' });
    }
    if (req.query.type && !REQUEST_TYPES.has(req.query.type)) {
      return res.status(400).json({ error: 'Invalid request type filter' });
    }

    return res.json({ data: await query });
  } catch (error) {
    return next(error);
  }
}

async function applyRequest(trx, request, adminId) {
  const now = new Date();
  const [restaurant] = await trx('restaurants').where({ id: request.restaurant_id }).limit(1);
  if (!restaurant) throw Object.assign(new Error('Restaurant not found'), { status: 404 });

  if (request.request_type === 'slug_change') {
    const slug = String(request.requested_value).trim().toLowerCase();
    if (!/^[a-z0-9]+(?:-[a-z0-9]+)*$/.test(slug)) {
      throw Object.assign(new Error('requested_value must be a valid slug'), { status: 400 });
    }
    const [conflict] = await trx('restaurants').where({ slug_active: slug }).whereNot({ id: restaurant.id }).limit(1);
    if (conflict) throw Object.assign(new Error('Requested slug is already in use'), { status: 409 });
    await trx('restaurants').where({ id: restaurant.id }).update({ slug });
  } else if (request.request_type === 'table_count_increase' || request.request_type === 'table_count_decrease') {
    const delta = parseDelta(request.requested_value);
    const currentCount = Number(restaurant.table_count || 0);
    if (request.request_type === 'table_count_increase') {
      await trx('restaurants').where({ id: restaurant.id }).update({ table_count: currentCount + delta });
    } else {
      const eligible = await trx('tables').where({ restaurant_id: restaurant.id }).whereIn('status', ['available', 'inactive']).whereNull('deleted_at').select('id').limit(delta);
      if (eligible.length < delta) throw Object.assign(new Error('Not enough available or inactive tables to decrease the count'), { status: 409 });
      await trx('tables').whereIn('id', eligible.map((table) => table.id)).update({ deleted_at: now, is_active: 0 });
      if (currentCount < delta) throw Object.assign(new Error('Requested decrease exceeds restaurant table count'), { status: 409 });
      await trx('restaurants').where({ id: restaurant.id }).update({ table_count: currentCount - delta });
    }
  } else if (request.request_type === 'qr_regeneration') {
    const target = parseQrTargets(request.requested_value);
    const tableQuery = trx('tables').where({ restaurant_id: restaurant.id }).whereNull('deleted_at');
    if (target !== 'all') tableQuery.whereIn('id', target);
    const tables = await tableQuery.select('*');
    if (target !== 'all' && tables.length !== target.length) throw Object.assign(new Error('One or more requested tables were not found'), { status: 400 });
    for (const table of tables) {
      const oldCode = await trx('table_qr_codes').where({ table_id: table.id }).orderBy('generated_at', 'desc').first();
      if (oldCode) {
        await trx('qr_code_history').insert({ id: randomUUID(), table_id: table.id, restaurant_id: restaurant.id, qr_code_url: table.qr_code_url || oldCode.payload, generated_by: adminId, invalidated_at: now });
      }
      const payload = buildTableQrPayload(restaurant.slug, table.table_number);
      await trx('table_qr_codes').insert({ id: randomUUID(), restaurant_id: restaurant.id, table_id: table.id, payload, generated_at: now, created_by_platform_admin_id: adminId });
      await trx('tables').where({ id: table.id }).update({ qr_code_url: payload, qr_code_generated_at: now });
    }
  }
}

export async function approveChangeRequest(req, res, next) {
  try {
    const result = await db.transaction(async (trx) => {
      const [changeRequest] = await trx('change_requests').where({ id: req.params.id }).forUpdate().limit(1);
      if (!changeRequest) throw Object.assign(new Error('Change request not found'), { status: 404 });
      if (changeRequest.status !== 'pending') throw Object.assign(new Error('Only pending change requests can be approved or rejected'), { status: 409 });
      await applyRequest(trx, changeRequest, req.user.id);
      const now = new Date();
      await trx('change_requests').where({ id: changeRequest.id }).update({ status: 'approved', reviewed_at: now, reviewed_by: req.user.id, actioned_at: now });
      await notifyChangeRequest(trx, changeRequest, req.user.id, true, 'Your change request was approved.');
      return { ...changeRequest, status: 'approved', reviewed_at: now, reviewed_by: req.user.id, actioned_at: now };
    });
    return res.json({ data: result });
  } catch (error) {
    if (error.status) return requestError(res, error.status, error);
    return next(error);
  }
}

export async function rejectChangeRequest(req, res, next) {
  try {
    const reason = String(req.body?.rejection_reason || '').trim();
    if (!reason) return res.status(400).json({ error: 'rejection_reason is required' });
    const result = await db.transaction(async (trx) => {
      const [changeRequest] = await trx('change_requests').where({ id: req.params.id }).forUpdate().limit(1);
      if (!changeRequest) throw Object.assign(new Error('Change request not found'), { status: 404 });
      if (changeRequest.status !== 'pending') throw Object.assign(new Error('Only pending change requests can be approved or rejected'), { status: 409 });
      const now = new Date();
      await trx('change_requests').where({ id: changeRequest.id }).update({ status: 'rejected', rejection_reason: reason, reviewed_at: now, reviewed_by: req.user.id, actioned_at: now });
      await notifyChangeRequest(trx, changeRequest, req.user.id, false, 'Your change request was rejected.');
      return { ...changeRequest, status: 'rejected', rejection_reason: reason, reviewed_at: now, reviewed_by: req.user.id, actioned_at: now };
    });
    return res.json({ data: result });
  } catch (error) {
    if (error.status) return requestError(res, error.status, error);
    return next(error);
  }
}
