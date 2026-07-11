import express from 'express';
import { authenticateToken } from '../middleware/auth.js';
import { requireRoles } from '../middleware/roles.js';
import { createBill, getBillBySession } from '../controllers/billController.js';
import { validate } from '../middleware/validate.js';
import { billSessionParamSchema, createBillSchema } from '../validators/bills.js';

const router = express.Router();

router.get('/session/:sessionId', validate(billSessionParamSchema, 'params'), getBillBySession);
router.post('/', authenticateToken, requireRoles(['waiter', 'restaurant_admin']), validate(createBillSchema), createBill);

export default router;
