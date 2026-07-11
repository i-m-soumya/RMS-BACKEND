import express from 'express';
import { authenticateToken } from '../middleware/auth.js';
import { requireRoles } from '../middleware/roles.js';

const router = express.Router();

router.get('/me', authenticateToken, requireRoles(['customer']), (req, res) => {
  res.json({ id: req.user.id, role: req.user.role, name: req.user.name });
});

export default router;
