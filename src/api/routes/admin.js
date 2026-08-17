import express from 'express';
import { authenticateToken } from '../middleware/auth.js';
import { requireRoles } from '../middleware/roles.js';
import { validate } from '../middleware/validate.js';
import {
  createMenuCategory,
  createMenuItem,
  createStaff,
  deleteMenuCategory,
  deleteMenuItem,
  listMenuCategories,
  listMenuItems,
  listStaff,
  reorderMenuCategories,
  resendStaffCredentials,
  setMenuItemAvailability,
  updateMenuCategory,
  updateMenuItem,
  updateStaffAccess,
  uploadMenuItemPhoto,
} from '../controllers/adminController.js';
import {
  categoryIdParamSchema,
  createMenuCategorySchema,
  createMenuItemSchema,
  createStaffSchema,
  itemIdParamSchema,
  listMenuItemsQuerySchema,
  listStaffQuerySchema,
  reorderMenuCategoriesSchema,
  setItemAvailabilitySchema,
  staffIdParamSchema,
  updateMenuCategorySchema,
  updateMenuItemSchema,
  updateStaffAccessSchema,
  uploadMenuItemPhotoSchema,
} from '../validators/admin.js';

const router = express.Router();

router.get('/health', authenticateToken, requireRoles(['restaurant_admin', 'waiter', 'chef']), (req, res) => {
  res.json({ status: 'ok', scope: 'restaurant-admin-console' });
});

router.get('/menu/categories', authenticateToken, requireRoles(['restaurant_admin']), listMenuCategories);
router.post('/menu/categories', authenticateToken, requireRoles(['restaurant_admin']), validate(createMenuCategorySchema), createMenuCategory);
router.put('/menu/categories/:id', authenticateToken, requireRoles(['restaurant_admin']), validate(categoryIdParamSchema, 'params'), validate(updateMenuCategorySchema), updateMenuCategory);
router.patch('/menu/categories/reorder', authenticateToken, requireRoles(['restaurant_admin']), validate(reorderMenuCategoriesSchema), reorderMenuCategories);
router.delete('/menu/categories/:id', authenticateToken, requireRoles(['restaurant_admin']), validate(categoryIdParamSchema, 'params'), deleteMenuCategory);

router.get('/menu/items', authenticateToken, requireRoles(['restaurant_admin']), validate(listMenuItemsQuerySchema, 'query'), listMenuItems);
router.post('/menu/items', authenticateToken, requireRoles(['restaurant_admin']), validate(createMenuItemSchema), createMenuItem);
router.put('/menu/items/:id', authenticateToken, requireRoles(['restaurant_admin']), validate(itemIdParamSchema, 'params'), validate(updateMenuItemSchema), updateMenuItem);
router.patch('/menu/items/:id/availability', authenticateToken, requireRoles(['restaurant_admin']), validate(itemIdParamSchema, 'params'), validate(setItemAvailabilitySchema), setMenuItemAvailability);
router.delete('/menu/items/:id', authenticateToken, requireRoles(['restaurant_admin']), validate(itemIdParamSchema, 'params'), deleteMenuItem);
router.post('/menu/items/upload-photo', authenticateToken, requireRoles(['restaurant_admin']), validate(uploadMenuItemPhotoSchema), uploadMenuItemPhoto);

router.get('/staff', authenticateToken, requireRoles(['restaurant_admin']), validate(listStaffQuerySchema, 'query'), listStaff);
router.post('/staff', authenticateToken, requireRoles(['restaurant_admin']), validate(createStaffSchema), createStaff);
router.patch('/staff/:id/access', authenticateToken, requireRoles(['restaurant_admin']), validate(staffIdParamSchema, 'params'), validate(updateStaffAccessSchema), updateStaffAccess);
router.post('/staff/:id/resend-credentials', authenticateToken, requireRoles(['restaurant_admin']), validate(staffIdParamSchema, 'params'), resendStaffCredentials);

export default router;
