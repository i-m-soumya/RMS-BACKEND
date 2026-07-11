import express from 'express';
import { authenticateToken } from '../middleware/auth.js';
import { requireRoles } from '../middleware/roles.js';

const router = express.Router();

router.get('/health', authenticateToken, requireRoles(['restaurant_admin', 'waiter', 'chef']), (req, res) => {
  res.json({ status: 'ok', scope: 'restaurant-admin-console' });
});

export default router;
