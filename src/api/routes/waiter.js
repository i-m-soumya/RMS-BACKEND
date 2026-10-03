import express from 'express';
import { authenticateToken } from '../middleware/auth.js';
import { requireRoles } from '../middleware/roles.js';
import { getTableBoard, getWaiterSessionDetail, resetWaiterSession } from '../controllers/sessionController.js';
import { createSession } from '../controllers/sessionController.js';
import { getWaiterBillPreview, generateWaiterBill, recordBillPayment, amendBill, getBillVersions } from '../controllers/billController.js';
import { confirmWaiterOrder, createWaiterDirectOrder, getPendingWaiterOrders, rejectWaiterOrder } from '../controllers/orderController.js';
import { directOrderSchema, orderIdParamSchema } from '../validators/orders.js';
import { validate } from '../middleware/validate.js';
import { sessionTableParamSchema, waiterSessionParamSchema } from '../validators/sessions.js';

const router = express.Router();

router.get('/tables', authenticateToken, requireRoles(['waiter', 'restaurant_admin']), getTableBoard);
router.get('/sessions/:session_id', authenticateToken, requireRoles(['waiter', 'restaurant_admin']), validate(waiterSessionParamSchema, 'params'), getWaiterSessionDetail);
router.get('/sessions/:session_id/bill-preview', authenticateToken, requireRoles(['waiter', 'restaurant_admin']), validate(waiterSessionParamSchema, 'params'), getWaiterBillPreview);
router.post('/sessions/:session_id/generate-bill', authenticateToken, requireRoles(['waiter']), validate(waiterSessionParamSchema, 'params'), generateWaiterBill);
router.post('/bills/:bill_id/payment', authenticateToken, requireRoles(['waiter', 'restaurant_admin']), recordBillPayment);
router.get('/bills/:bill_id/versions', authenticateToken, requireRoles(['waiter', 'restaurant_admin']), getBillVersions);
router.post('/bills/:bill_id/amend', authenticateToken, requireRoles(['waiter', 'restaurant_admin']), amendBill);
router.get('/orders/pending', authenticateToken, requireRoles(['waiter', 'restaurant_admin']), getPendingWaiterOrders);
router.post('/orders/:order_id/confirm', authenticateToken, requireRoles(['waiter', 'restaurant_admin']), validate(orderIdParamSchema, 'params'), confirmWaiterOrder);
router.post('/orders/:order_id/reject', authenticateToken, requireRoles(['waiter', 'restaurant_admin']), validate(orderIdParamSchema, 'params'), rejectWaiterOrder);
router.post('/sessions/:session_id/direct-order', authenticateToken, requireRoles(['waiter', 'restaurant_admin']), validate(waiterSessionParamSchema, 'params'), validate(directOrderSchema), createWaiterDirectOrder);
router.post('/sessions/:session_id/reset', authenticateToken, requireRoles(['waiter', 'restaurant_admin']), validate(waiterSessionParamSchema, 'params'), resetWaiterSession);
router.post('/tables/:table_id/open', authenticateToken, requireRoles(['waiter']), validate(sessionTableParamSchema, 'params'), createSession);

export default router;