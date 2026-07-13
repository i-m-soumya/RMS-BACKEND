import express from 'express';
import { getSession, joinSessionByTable, createSession } from '../controllers/sessionController.js';
import { getSessionOrders } from '../controllers/orderController.js';
import { authenticateToken } from '../middleware/auth.js';
import { requireRoles, verifyRestaurantAccess } from '../middleware/roles.js';
import { validate } from '../middleware/validate.js';
import { joinSessionLimiter } from '../middleware/rateLimit.js';
import {
	sessionIdParamSchema,
	joinSessionParamSchema,
	createSessionSchema
} from '../validators/sessions.js';

const router = express.Router();

// Public endpoint for customers to join session by table
router.post('/table/:tableId/join', joinSessionLimiter, validate(joinSessionParamSchema, 'params'), joinSessionByTable);

// Protected endpoints for staff/platform
router.get('/:id', authenticateToken, validate(sessionIdParamSchema, 'params'), getSession);
router.get('/:id/orders', authenticateToken, validate(sessionIdParamSchema, 'params'), getSessionOrders);

// Staff creating session
router.post(
	'/',
	authenticateToken,
	requireRoles(['waiter', 'restaurant_admin', 'platform_admin']),
	validate(createSessionSchema),
	verifyRestaurantAccess,
	createSession
);

export default router;
