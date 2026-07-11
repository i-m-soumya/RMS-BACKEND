import express from 'express';
import { getSession, joinSessionByTable, createSession } from '../controllers/sessionController.js';
import { getSessionOrders } from '../controllers/orderController.js';
import { authenticateToken } from '../middleware/auth.js';
import { requireRoles } from '../middleware/roles.js';
import { validate } from '../middleware/validate.js';
import { joinSessionLimiter } from '../middleware/rateLimit.js';
import {
	sessionIdParamSchema,
	joinSessionParamSchema,
	createSessionSchema
} from '../validators/sessions.js';

const router = express.Router();

router.get('/:id', validate(sessionIdParamSchema, 'params'), getSession);
router.get('/:id/orders', validate(sessionIdParamSchema, 'params'), getSessionOrders);

// Customers join a session via tableId
router.post('/table/:tableId/join', joinSessionLimiter, validate(joinSessionParamSchema, 'params'), joinSessionByTable);

// Staff creating session
router.post(
	'/',
	authenticateToken,
	requireRoles(['waiter', 'restaurant_admin', 'platform_admin']),
	validate(createSessionSchema),
	createSession
);

export default router;
