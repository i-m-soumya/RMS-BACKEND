import express from 'express';
import { authenticateToken } from '../middleware/auth.js';
import { requireRoles } from '../middleware/roles.js';

const router = express.Router();

router.post('/', authenticateToken, requireRoles(['waiter', 'restaurant_admin']), (req, res) => {
  res.status(501).json({ code: 'NOT_IMPLEMENTED', message: 'Bill generation endpoint is not implemented yet' });
});

export default router;
