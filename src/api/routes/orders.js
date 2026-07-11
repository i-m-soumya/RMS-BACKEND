import express from 'express';
import { optionalAuth } from '../middleware/optionalAuth.js';
import { createOrder } from '../controllers/orderController.js';
import { createOrderLimiter } from '../middleware/rateLimit.js';
import { validate } from '../middleware/validate.js';
import { createOrderSchema } from '../validators/orders.js';

const router = express.Router();

router.post('/', optionalAuth, createOrderLimiter, validate(createOrderSchema), createOrder);

export default router;
