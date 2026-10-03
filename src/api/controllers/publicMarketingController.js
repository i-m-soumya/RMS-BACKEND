import db from '../../db/connection.js';
import { randomUUID } from 'node:crypto';

const plans = new Set(['basic', 'pro', 'enterprise']);

function clientIp(req) {
  return req.ip || null;
}

function deviceType(userAgent = '') {
  if (/tablet|ipad|android(?!.*mobile)/i.test(userAgent)) return 'tablet';
  if (/mobile|iphone|ipod|android/i.test(userAgent)) return 'mobile';
  return 'desktop';
}

function geo(req, field) {
  const value = req.get(field);
  return value ? value.slice(0, 100) : null;
}

function honeypot(req) {
  return String(req.body?.website || req.body?.homepage || '').trim();
}

function required(value) {
  return typeof value === 'string' && value.trim().length > 0;
}

export async function createWebsiteView(req, res, next) {
  try {
    if (!required(req.body?.page_slug)) return res.status(400).json({ error: 'page_slug is required' });
    await db('saas_website_views').insert({
      id: randomUUID(),
      page_slug: req.body.page_slug.trim().slice(0, 100),
      referrer: required(req.body.referrer) ? req.body.referrer.trim().slice(0, 255) : null,
      ip_address: clientIp(req),
      city: geo(req, 'cf-city'),
      country: geo(req, 'cf-ipcountry'),
      device_type: deviceType(req.get('user-agent')),
      is_spam: 0,
    });
    return res.status(201).json({ data: { accepted: true } });
  } catch (error) { return next(error); }
}

export async function createContactQuery(req, res, next) {
  try {
    if (honeypot(req)) return res.status(201).json({ data: { accepted: true } });
    const { name, email, phone, restaurant_name: restaurantName, city, message } = req.body || {};
    if (![name, email, restaurantName, message].every(required)) return res.status(400).json({ error: 'name, email, restaurant_name, and message are required' });
    await db('saas_contact_queries').insert({ id: randomUUID(), name: name.trim().slice(0, 100), email: email.trim().slice(0, 150), phone: required(phone) ? phone.trim().slice(0, 15) : null, restaurant_name: restaurantName.trim().slice(0, 150), city: required(city) ? city.trim().slice(0, 100) : null, message: message.trim(), ip_address: clientIp(req), is_spam: 0, is_resolved: 0 });
    return res.status(201).json({ data: { accepted: true } });
  } catch (error) { return next(error); }
}

export async function createRegistration(req, res, next) {
  try {
    if (honeypot(req)) return res.status(201).json({ data: { accepted: true } });
    const { restaurant_name: restaurantName, city, email, phone, plan_interest: planInterest } = req.body || {};
    if (![restaurantName, email, planInterest].every(required)) return res.status(400).json({ error: 'restaurant_name, email, and plan_interest are required' });
    if (!plans.has(planInterest)) return res.status(400).json({ error: 'plan_interest must be basic, pro, or enterprise' });
    await db('saas_registrations').insert({ id: randomUUID(), restaurant_name: restaurantName.trim().slice(0, 150), city: required(city) ? city.trim().slice(0, 100) : null, email: email.trim().slice(0, 150), phone: required(phone) ? phone.trim().slice(0, 15) : null, plan_interest: planInterest, converted: 0, restaurant_id: null });
    return res.status(201).json({ data: { accepted: true } });
  } catch (error) { return next(error); }
}
