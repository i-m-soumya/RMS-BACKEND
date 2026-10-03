import express from 'express';
import { getSession, joinSessionByTable, createSession } from '../controllers/sessionController.js';
import { getSessionOrders } from '../controllers/orderController.js';
import { authenticateToken } from '../middleware/auth.js';
import { optionalAuth } from '../middleware/optionalAuth.js';
import { requireSessionOrdersAccess } from '../middleware/sessionOrdersAccess.js';
import { requireRoles } from '../middleware/roles.js';
import { validate } from '../middleware/validate.js';
import { joinSessionLimiter } from '../middleware/rateLimit.js';
import {
	sessionIdParamSchema,
	joinSessionParamSchema,
	createSessionSchema
} from '../validators/sessions.js';

const router = express.Router();

// Public endpoint for customers to join session by table
router.post('/table/:tableId/join', joinSessionLimiter, optionalAuth, validate(joinSessionParamSchema, 'params'), joinSessionByTable);

// Staff/platform session details
router.get('/:id', authenticateToken, validate(sessionIdParamSchema, 'params'), getSession);

// Customers may read orders only with access to the requested session.
router.get('/:id/orders', validate(sessionIdParamSchema, 'params'), requireSessionOrdersAccess, getSessionOrders);

// Staff creating session
router.post(
	'/',
	authenticateToken,
	requireRoles(['waiter', 'restaurant_admin', 'platform_admin']),
	validate(createSessionSchema),
	createSession
);

export default router;
