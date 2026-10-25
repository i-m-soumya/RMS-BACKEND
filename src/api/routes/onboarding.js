import express from 'express';
import { authenticateToken } from '../middleware/auth.js';
import { requireRoles } from '../middleware/roles.js';
import { getOnboardingProgress, updateOnboardingStep } from '../controllers/signupController.js';
import { floorsAndTablesSchema } from '../validators/platformOnboarding.js';
import { validate } from '../middleware/validate.js';
import {
  generateRestaurantQRCodes,
  getRestaurantQrBatch,
  saveFloorsAndTables,
} from '../controllers/platformController.js';
import db from '../../db/connection.js';

const router = express.Router();
router.use(authenticateToken, requireRoles(['restaurant_admin']));
router.get('/progress', getOnboardingProgress);
router.patch('/steps/:key', updateOnboardingStep);

function scopeToAuthenticatedRestaurant(handler, { onboardingSetup = false } = {}) {
  return (req, res, next) => {
    if (!req.user.restaurantId) return res.status(403).json({ error: 'Restaurant access is required.' });
    req.params.restaurantId = req.user.restaurantId;
    if (onboardingSetup) req.onboardingSetup = true;
    return handler(req, res, next);
  };
}

router.get('/tables', async (req, res, next) => {
  try {
    const items = await db('tables as t')
      .leftJoin('floors as f', 'f.id', 't.floor_id')
      .where('t.restaurant_id', req.user.restaurantId)
      .select('t.id as tableId', 't.table_number as tableNumber', 't.capacity', 'f.name as floor')
      .orderBy('f.floor_order', 'asc')
      .orderBy('t.table_number', 'asc');
    const qrCount = await db('table_qr_codes').where({ restaurant_id: req.user.restaurantId }).count({ count: 'id' }).first();
    return res.json({ items, tableCount: items.length, qrCount: Number(qrCount?.count || 0) });
  } catch (error) {
    return next(error);
  }
});
router.put('/tables', validate(floorsAndTablesSchema), scopeToAuthenticatedRestaurant(saveFloorsAndTables, { onboardingSetup: true }));
router.post('/tables/qr-codes', scopeToAuthenticatedRestaurant(generateRestaurantQRCodes));
router.get('/tables/qr-codes', scopeToAuthenticatedRestaurant(getRestaurantQrBatch));

export default router;
