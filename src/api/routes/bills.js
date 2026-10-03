import express from 'express';
import { authenticateToken } from '../middleware/auth.js';
import { requireRoles } from '../middleware/roles.js';
import { createBill, getBillBySession } from '../controllers/billController.js';
import { validate } from '../middleware/validate.js';
import { billSessionParamSchema, createBillSchema } from '../validators/bills.js';

const router = express.Router();

// Customers need to view their active table bill without staff authentication.
router.get('/session/:sessionId', validate(billSessionParamSchema, 'params'), getBillBySession);

// Protected write endpoints for staff/admin
router.post('/', authenticateToken, requireRoles(['waiter', 'restaurant_admin']), validate(createBillSchema), createBill);

export default router;
