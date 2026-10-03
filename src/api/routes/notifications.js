import express from 'express';
import { authenticateToken } from '../middleware/auth.js';
import { requireRoles } from '../middleware/roles.js';
import {
  listNotifications,
  getUnreadNotificationCount,
  markNotificationRead,
  markAllNotificationsRead,
} from '../controllers/adminController.js';

const router = express.Router();

router.get('/notifications', authenticateToken, requireRoles(['restaurant_admin', 'waiter', 'chef']), listNotifications);
router.get('/notifications/unread-count', authenticateToken, requireRoles(['restaurant_admin', 'waiter', 'chef']), getUnreadNotificationCount);
router.patch('/notifications/:id/read', authenticateToken, requireRoles(['restaurant_admin', 'waiter', 'chef']), markNotificationRead);
router.patch('/notifications/read-all', authenticateToken, requireRoles(['restaurant_admin', 'waiter', 'chef']), markAllNotificationsRead);

export default router;
