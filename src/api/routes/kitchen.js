import express from 'express';
import { authenticateToken } from '../middleware/auth.js';
import { requireRoles } from '../middleware/roles.js';
import { getKitchenQueue } from '../controllers/kitchenController.js';

const router = express.Router();

router.get('/orders', authenticateToken, requireRoles(['chef', 'restaurant_admin']), getKitchenQueue);

export default router;
