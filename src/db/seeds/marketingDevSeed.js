import db from '../connection.js';

const viewIds = Array.from({ length: 12 }, (_, index) => `d1000000-0000-4000-8000-${String(index + 1).padStart(12, '0')}`);
const contactIds = Array.from({ length: 6 }, (_, index) => `d2000000-0000-4000-8000-${String(index + 1).padStart(12, '0')}`);
const registrationIds = Array.from({ length: 6 }, (_, index) => `d3000000-0000-4000-8000-${String(index + 1).padStart(12, '0')}`);

if (process.env.NODE_ENV === 'production' || process.env.ALLOW_MARKETING_DEV_SEED !== 'true') {
  throw new Error('Refusing marketing dev seed: set ALLOW_MARKETING_DEV_SEED=true outside production.');
}

const daysAgo = (days) => new Date(Date.now() - days * 24 * 60 * 60 * 1000);

try {
  await db('saas_website_views').whereIn('id', viewIds).delete();
  await db('saas_contact_queries').whereIn('id', contactIds).delete();
  await db('saas_registrations').whereIn('id', registrationIds).delete();

  await db('saas_website_views').insert(viewIds.map((id, index) => ({
    id,
    page_slug: ['home', 'features', 'pricing', 'contact'][index % 4],
    referrer: ['google', 'linkedin', 'direct', 'newsletter'][index % 4],
    city: ['Mumbai', 'Pune', 'Bengaluru', 'Delhi'][index % 4],
    country: 'India',
    device_type: index % 3 === 0 ? 'mobile' : 'desktop',
    ip_address: `203.0.113.${index + 1}`,
    is_spam: index >= 10 ? 1 : 0,
    created_at: daysAgo(index * 2 + 1),
  })));

  await db('saas_contact_queries').insert([
    { id: contactIds[0], name: 'Ananya Mehta', email: 'ananya.mehta@example.test', phone: '9000000001', restaurant_name: 'Monsoon Table', city: 'Mumbai', message: 'We are opening a  forty-seat restaurant and would like a product walkthrough.', is_spam: 0, is_resolved: 0 },
    { id: contactIds[1], name: 'Rahul Nair', email: 'rahul.nair@example.test', phone: '9000000002', restaurant_name: 'Harbor House', city: 'Kochi', message: 'Please share pricing for multiple outlets.', is_spam: 0, is_resolved: 1, resolved_at: daysAgo(4) },
    { id: contactIds[2], name: 'Priya Shah', email: 'priya.shah@example.test', phone: '9000000003', restaurant_name: 'Cedar Kitchen', city: 'Pune', message: 'Interested in kitchen and table management features.', is_spam: 0, is_resolved: 0 },
    { id: contactIds[3], name: 'Vikram Rao', email: 'vikram.rao@example.test', phone: '9000000004', restaurant_name: 'South Street', city: 'Bengaluru', message: 'Could someone contact us about onboarding next month?', is_spam: 0, is_resolved: 1, resolved_at: daysAgo(9) },
    { id: contactIds[4], name: 'Maya Iyer', email: 'maya.iyer@example.test', phone: '9000000005', restaurant_name: 'The Courtyard', city: 'Delhi', message: 'We need a demo for our operations team.', is_spam: 0, is_resolved: 0 },
    { id: contactIds[5], name: 'Unknown Sender', email: 'noise@example.test', phone: null, restaurant_name: null, city: null, message: 'Claim your unsolicited promotion now.', is_spam: 1, is_resolved: 0 },
  ]);

  const restaurants = await db('restaurants').select('id').where('status', 'active').orderBy('created_at').limit(3);
  await db('saas_registrations').insert(registrationIds.map((id, index) => ({
    id,
    restaurant_name: ['Monsoon Table', 'Harbor House', 'Cedar Kitchen', 'North End Cafe', 'River Room', 'Juniper Social'][index],
    city: ['Mumbai', 'Kochi', 'Pune', 'Delhi', 'Jaipur', 'Chennai'][index],
    email: `registration${index + 1}@example.test`,
    phone: `910000000${index + 1}`,
    plan_interest: ['basic', 'pro', 'enterprise'][index % 3],
    converted: index < restaurants.length ? 1 : 0,
    converted_at: index < restaurants.length ? daysAgo(index + 3) : null,
    restaurant_id: restaurants[index]?.id || null,
    created_at: daysAgo(index * 3 + 2),
  })));

  console.log(JSON.stringify({ views: viewIds.length, contacts: contactIds.length, registrations: registrationIds.length, linkedRegistrations: Math.min(restaurants.length, 3) }));
} finally {
  await db.destroy();
}
