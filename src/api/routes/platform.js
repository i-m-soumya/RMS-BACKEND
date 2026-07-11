import express from 'express';
import { authenticateToken } from '../middleware/auth.js';
import { requireRoles } from '../middleware/roles.js';

const router = express.Router();

router.get('/health', authenticateToken, requireRoles(['platform_admin']), (req, res) => {
  res.json({ status: 'ok', scope: 'platform' });
});

export default router;
