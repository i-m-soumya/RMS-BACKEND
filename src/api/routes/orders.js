import express from 'express';
import { authenticateToken } from '../middleware/auth.js';
import { optionalAuth } from '../middleware/optionalAuth.js';
import { createOrder, updateOrderStatus } from '../controllers/orderController.js';
import { createOrderLimiter } from '../middleware/rateLimit.js';
import { requireRoles } from '../middleware/roles.js';
import { validate } from '../middleware/validate.js';
import { optionalCustomerAuth } from '../middleware/optionalCustomerAuth.js';
import { createOrderSchema, updateStatusSchema } from '../validators/orders.js';

const router = express.Router();

router.post('/', optionalAuth, optionalCustomerAuth, createOrderLimiter, validate(createOrderSchema), createOrder);
router.patch('/:order_id/status', authenticateToken, requireRoles(['chef']), validate(updateStatusSchema, 'body'), updateOrderStatus);

export default router;
