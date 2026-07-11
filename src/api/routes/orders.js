import express from 'express';
import { authenticateToken } from '../middleware/auth.js';
import { requireRoles } from '../middleware/roles.js';
import { createOrderLimiter } from '../middleware/rateLimit.js';

const router = express.Router();

// Skeleton endpoint for production-ready route surface expansion.
router.post('/', authenticateToken, requireRoles(['customer', 'waiter', 'restaurant_admin']), createOrderLimiter, (req, res) => {
  res.status(501).json({ code: 'NOT_IMPLEMENTED', message: 'Order creation endpoint is not implemented yet' });
});

export default router;
