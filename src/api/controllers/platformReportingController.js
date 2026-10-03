import db from '../../db/connection.js';

const VALID_GROUPS = new Set(['day', 'week', 'month']);

function dateFilter(query, column, req) {
  if (req.query.from) query.andWhere(column, '>=', req.query.from);
  if (req.query.to) query.andWhere(column, '<=', req.query.to);
}

function parseBoolean(value, fallback = false) {
  if (value === undefined) return fallback;
  if (value === 'true' || value === '1') return true;
  if (value === 'false' || value === '0') return false;
  throw Object.assign(new Error('Boolean query values must be true, false, 1, or 0'), { status: 400 });
}

export async function websiteViews(req, res, next) {
  try {
    const groupBy = req.query.groupBy || 'day';
    if (!VALID_GROUPS.has(groupBy)) return res.status(400).json({ error: 'groupBy must be day, week, or month' });
    const includeSpam = !parseBoolean(req.query.excludeSpam, true);
    const query = db('saas_website_views').select(
      db.raw(`DATE_FORMAT(created_at, '${groupBy === 'month' ? '%Y-%m' : groupBy === 'week' ? '%x-W%v' : '%Y-%m-%d'}') as period`),
      db.raw('COUNT(*) as views'),
    ).groupBy('period').orderBy('period', 'asc');
    if (!includeSpam) query.where('is_spam', 0);
    dateFilter(query, 'created_at', req);
    for (const field of ['page_slug', 'referrer', 'city', 'device_type']) if (req.query[field]) query.where(field, req.query[field]);
    const breakdown = db('saas_website_views').select('page_slug', 'referrer', 'city', 'device_type').count({ views: '*' }).groupBy('page_slug', 'referrer', 'city', 'device_type');
    if (!includeSpam) breakdown.where('is_spam', 0);
    dateFilter(breakdown, 'created_at', req);
    for (const field of ['page_slug', 'referrer', 'city', 'device_type']) if (req.query[field]) breakdown.where(field, req.query[field]);
    return res.json({ data: { groupBy, periods: await query, breakdown: await breakdown } });
  } catch (error) { return next(error); }
}

export async function ordersRevenue(req, res, next) {
  try {
    const orderQuery = db('orders').count({ total_orders: '*' });
    dateFilter(orderQuery, 'created_at', req);
    const billQuery = db('bills').where('is_active', 1).select(
      db.raw('COALESCE(SUM(total_amount), 0) as billed_revenue'),
      db.raw("COALESCE(SUM(CASE WHEN payment_status = 'paid' THEN total_amount ELSE 0 END), 0) as collected_revenue"),
      db.raw('COUNT(*) as active_bills'),
    );
    dateFilter(billQuery, 'created_at', req);
    const byPeriod = db('bills').where('is_active', 1).select(db.raw('DATE_FORMAT(created_at, \'%Y-%m-%d\') as period'), db.raw('COUNT(*) as bills'), db.raw('SUM(total_amount) as billed_revenue'), db.raw("SUM(CASE WHEN payment_status = 'paid' THEN total_amount ELSE 0 END) as collected_revenue")).groupBy('period').orderBy('period');
    dateFilter(byPeriod, 'created_at', req);
    const [orders] = await orderQuery;
    const [bills] = await billQuery;
    return res.json({ data: { total_orders: Number(orders.total_orders || 0), billed_revenue: Number(bills.billed_revenue || 0), collected_revenue: Number(bills.collected_revenue || 0), active_bills: Number(bills.active_bills || 0), by_period: await byPeriod } });
  } catch (error) { return next(error); }
}

export async function churnSignals(req, res, next) {
  try {
    const rows = await db('restaurants as r').leftJoin('orders as o', 'o.restaurant_id', 'r.id').where('r.status', 'active').groupBy('r.id', 'r.name', 'r.slug').havingRaw('MAX(o.created_at) IS NULL OR MAX(o.created_at) < NOW() - INTERVAL 30 DAY').select('r.id', 'r.name', 'r.slug', db.raw('MAX(o.created_at) as last_order_at')).orderByRaw('last_order_at IS NOT NULL, last_order_at ASC');
    return res.json({ data: rows.map((row) => ({ ...row, days_since_last_order: row.last_order_at ? Math.floor((Date.now() - new Date(row.last_order_at).getTime()) / 86400000) : null })) });
  } catch (error) { return next(error); }
}

export async function statusSummary(req, res, next) {
  try {
    const rows = await db('restaurants').select('status').count({ count: '*' }).groupBy('status');
    const summary = { active: 0, suspended: 0 };
    rows.forEach((row) => { summary[row.status] = Number(row.count); });
    return res.json({ data: summary });
  } catch (error) { return next(error); }
}

export async function listContactQueries(req, res, next) {
  try {
    const query = db('saas_contact_queries').select('*').orderBy('created_at', 'desc');
    if (req.query.is_resolved !== undefined) query.where('is_resolved', parseBoolean(req.query.is_resolved));
    if (req.query.is_spam !== undefined) query.where('is_spam', parseBoolean(req.query.is_spam));
    return res.json({ data: await query });
  } catch (error) { return next(error); }
}

async function getContact(id) { return db('saas_contact_queries').where({ id }).first(); }

export async function resolveContactQuery(req, res, next) {
  try {
    if (!await getContact(req.params.id)) return res.status(404).json({ error: 'Contact query not found' });
    await db('saas_contact_queries').where({ id: req.params.id }).update({ is_resolved: 1, resolved_at: new Date(), resolved_by: req.user.id });
    return res.json({ data: await getContact(req.params.id) });
  } catch (error) { return next(error); }
}

export async function spamContactQuery(req, res, next) {
  try {
    if (!await getContact(req.params.id)) return res.status(404).json({ error: 'Contact query not found' });
    await db('saas_contact_queries').where({ id: req.params.id }).update({ is_spam: 1, is_resolved: 0, resolved_at: null, resolved_by: null });
    return res.json({ data: await getContact(req.params.id) });
  } catch (error) { return next(error); }
}

export async function listRegistrations(req, res, next) {
  try {
    const query = db('saas_registrations as sr').leftJoin('restaurants as r', 'r.id', 'sr.restaurant_id').select('sr.*', 'r.name as linked_restaurant_name', 'r.slug as linked_restaurant_slug').orderBy('sr.created_at', 'desc');
    if (req.query.converted !== undefined) {
      if (parseBoolean(req.query.converted)) query.whereNotNull('sr.restaurant_id');
      else query.whereNull('sr.restaurant_id');
    }
    if (req.query.plan_interest) query.where('sr.plan_interest', req.query.plan_interest);
    dateFilter(query, 'sr.created_at', req);
    return res.json({ data: await query });
  } catch (error) { return next(error); }
}

export async function registrationConversionRate(req, res, next) {
  try {
    const query = db('saas_registrations');
    dateFilter(query, 'created_at', req);
    const [row] = await query.select(db.raw('COUNT(*) as total'), db.raw('SUM(CASE WHEN restaurant_id IS NOT NULL THEN 1 ELSE 0 END) as converted'));
    const total = Number(row.total || 0); const converted = Number(row.converted || 0);
    return res.json({ data: { total, converted, rate: total ? converted / total : 0 } });
  } catch (error) { return next(error); }
}
