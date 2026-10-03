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
  setMenuItemRatingsVisibility,
  listMenuItemAvailabilityLog,
  listMenuAvailabilityStaffOptions,
  updateMenuCategory,
  updateMenuItem,
  updateStaffAccess,
  revokeStaffAccess,
  restoreStaffAccess,
  uploadMenuCategoryImage,
  uploadMenuItemImage,
  listMenuItemImages,
  deleteMenuItemImage,
  getMenuItemSchedule,
  createMenuItemSchedule,
  updateMenuItemSchedule,
  deactivateMenuItemSchedule,
  listMenuItemSchedules,
  listMenuAddons,
  listMenuItemPairings,
  createMenuItemPairing,
  deleteMenuItemPairing,
  createMenuAddon,
  updateMenuAddon,
  deleteMenuAddon,
  listMenuAddonItems,
  updateMenuAddonItems,
  listNotifications,
  markNotificationRead,
  markAllNotificationsRead,
} from '../controllers/adminController.js';
import { imageUpload } from '../middleware/imageUpload.js';
import { getStaffActivity, updateKitchenOrderItemStatus, rejectChefOrder, rejectChefOrderItem, getChefShiftHistory } from '../controllers/staffController.js';
import { getAdminDashboardSnapshot } from '../controllers/adminDashboardController.js';
import {
  getRestaurantProfile,
  updateRestaurantProfile,
  getRestaurantGst,
  updateRestaurantGst,
  getOperatingHours,
  updateOperatingHours,
  listRestaurantChangeRequests,
  createRestaurantChangeRequest,
} from '../controllers/settingsController.js';
import {
  categoryIdParamSchema,
  addonIdParamSchema,
  pairingItemParamSchema,
  pairingIdParamSchema,
  createPairingSchema,
  listMenuAddonsQuerySchema,
  menuAddonPayloadSchema,
  menuAddonItemsSchema,
  createMenuCategorySchema,
  createMenuItemSchema,
  createStaffSchema,
  itemIdParamSchema,
  listMenuItemsQuerySchema,
  listStaffQuerySchema,
  reorderMenuCategoriesSchema,
  setItemAvailabilitySchema,
  setItemRatingsVisibilitySchema,
  scheduleItemParamSchema,
  scheduleIdParamSchema,
  schedulePayloadSchema,
  availabilityLogQuerySchema,
  staffIdParamSchema,
  updateMenuCategorySchema,
  updateMenuItemSchema,
  updateStaffAccessSchema,
  kitchenOrderItemStatusSchema,
  staffActivityQuerySchema,
  restaurantProfileSchema,
  restaurantGstSchema,
  operatingHoursSchema,
  changeRequestSchema,
} from '../validators/admin.js';

const router = express.Router();

router.get('/health', authenticateToken, requireRoles(['restaurant_admin', 'waiter', 'chef']), (req, res) => {
  res.json({ status: 'ok', scope: 'restaurant-admin-console' });
});

router.get('/dashboard/snapshot', authenticateToken, requireRoles(['restaurant_admin']), getAdminDashboardSnapshot);

router.get('/settings/profile', authenticateToken, requireRoles(['restaurant_admin']), getRestaurantProfile);
router.put('/settings/profile', authenticateToken, requireRoles(['restaurant_admin']), validate(restaurantProfileSchema), updateRestaurantProfile);
router.get('/settings/gst', authenticateToken, requireRoles(['restaurant_admin']), getRestaurantGst);
router.put('/settings/gst', authenticateToken, requireRoles(['restaurant_admin']), validate(restaurantGstSchema), updateRestaurantGst);
router.get('/settings/operating-hours', authenticateToken, requireRoles(['restaurant_admin']), getOperatingHours);
router.put('/settings/operating-hours', authenticateToken, requireRoles(['restaurant_admin']), validate(operatingHoursSchema), updateOperatingHours);
router.get('/settings/change-requests', authenticateToken, requireRoles(['restaurant_admin']), listRestaurantChangeRequests);
router.post('/settings/change-requests', authenticateToken, requireRoles(['restaurant_admin']), validate(changeRequestSchema), createRestaurantChangeRequest);

router.get('/menu/categories', authenticateToken, requireRoles(['restaurant_admin']), listMenuCategories);
router.get('/menu/addons', authenticateToken, requireRoles(['restaurant_admin']), validate(listMenuAddonsQuerySchema, 'query'), listMenuAddons);
router.post('/menu/addons', authenticateToken, requireRoles(['restaurant_admin']), validate(menuAddonPayloadSchema), createMenuAddon);
router.put('/menu/addons/:id', authenticateToken, requireRoles(['restaurant_admin']), validate(addonIdParamSchema, 'params'), validate(menuAddonPayloadSchema), updateMenuAddon);
router.delete('/menu/addons/:id', authenticateToken, requireRoles(['restaurant_admin']), validate(addonIdParamSchema, 'params'), deleteMenuAddon);
router.get('/menu/addons/:id/items', authenticateToken, requireRoles(['restaurant_admin']), validate(addonIdParamSchema, 'params'), listMenuAddonItems);
router.post('/menu/addons/:id/items', authenticateToken, requireRoles(['restaurant_admin']), validate(addonIdParamSchema, 'params'), validate(menuAddonItemsSchema), updateMenuAddonItems);
router.post('/menu/categories', authenticateToken, requireRoles(['restaurant_admin']), validate(createMenuCategorySchema), createMenuCategory);
router.put('/menu/categories/:id', authenticateToken, requireRoles(['restaurant_admin']), validate(categoryIdParamSchema, 'params'), validate(updateMenuCategorySchema), updateMenuCategory);
router.patch('/menu/categories/reorder', authenticateToken, requireRoles(['restaurant_admin']), validate(reorderMenuCategoriesSchema), reorderMenuCategories);
router.delete('/menu/categories/:id', authenticateToken, requireRoles(['restaurant_admin']), validate(categoryIdParamSchema, 'params'), deleteMenuCategory);
router.post('/menu/categories/:id/image', authenticateToken, requireRoles(['restaurant_admin']), validate(categoryIdParamSchema, 'params'), imageUpload.single('image'), uploadMenuCategoryImage);

router.get('/menu/items', authenticateToken, requireRoles(['restaurant_admin', 'chef']), validate(listMenuItemsQuerySchema, 'query'), listMenuItems);
router.get('/menu/items/:itemId/pairings', authenticateToken, requireRoles(['restaurant_admin']), validate(pairingItemParamSchema, 'params'), listMenuItemPairings);
router.post('/menu/items/:itemId/pairings', authenticateToken, requireRoles(['restaurant_admin']), validate(pairingItemParamSchema, 'params'), validate(createPairingSchema), createMenuItemPairing);
router.delete('/menu/pairings/:pairingId', authenticateToken, requireRoles(['restaurant_admin']), validate(pairingIdParamSchema, 'params'), deleteMenuItemPairing);
router.post('/menu/items', authenticateToken, requireRoles(['restaurant_admin']), validate(createMenuItemSchema), createMenuItem);
router.put('/menu/items/:id', authenticateToken, requireRoles(['restaurant_admin']), validate(itemIdParamSchema, 'params'), validate(updateMenuItemSchema), updateMenuItem);
router.patch('/menu/items/:id/availability', authenticateToken, requireRoles(['restaurant_admin', 'waiter', 'chef']), validate(itemIdParamSchema, 'params'), validate(setItemAvailabilitySchema), setMenuItemAvailability);
router.get('/menu/items/availability-log', authenticateToken, requireRoles(['restaurant_admin', 'waiter', 'chef']), listMenuItemAvailabilityLog);
router.get('/menu/availability-log', authenticateToken, requireRoles(['restaurant_admin']), validate(availabilityLogQuerySchema, 'query'), listMenuItemAvailabilityLog);
router.get('/menu/availability-log/staff-options', authenticateToken, requireRoles(['restaurant_admin']), listMenuAvailabilityStaffOptions);
router.post('/menu/items/:itemId/schedules', authenticateToken, requireRoles(['restaurant_admin']), validate(scheduleItemParamSchema, 'params'), validate(schedulePayloadSchema), createMenuItemSchedule);
router.get('/menu/items/:itemId/schedules', authenticateToken, requireRoles(['restaurant_admin']), validate(scheduleItemParamSchema, 'params'), listMenuItemSchedules);
router.put('/menu/schedules/:id', authenticateToken, requireRoles(['restaurant_admin']), validate(scheduleIdParamSchema, 'params'), validate(schedulePayloadSchema), updateMenuItemSchedule);
router.post('/menu/schedules/:id/deactivate', authenticateToken, requireRoles(['restaurant_admin']), validate(scheduleIdParamSchema, 'params'), deactivateMenuItemSchedule);
router.patch('/menu/items/:id/show-ratings', authenticateToken, requireRoles(['restaurant_admin']), validate(itemIdParamSchema, 'params'), validate(setItemRatingsVisibilitySchema), setMenuItemRatingsVisibility);
router.get('/menu/items/:id/schedule', authenticateToken, requireRoles(['restaurant_admin']), validate(itemIdParamSchema, 'params'), getMenuItemSchedule);
router.delete('/menu/items/:id', authenticateToken, requireRoles(['restaurant_admin']), validate(itemIdParamSchema, 'params'), deleteMenuItem);
router.get('/menu/items/:id/images', authenticateToken, requireRoles(['restaurant_admin']), validate(itemIdParamSchema, 'params'), listMenuItemImages);
router.post('/menu/items/:id/images', authenticateToken, requireRoles(['restaurant_admin']), validate(itemIdParamSchema, 'params'), imageUpload.single('image'), uploadMenuItemImage);
router.delete('/menu/items/:id/images/:imageId', authenticateToken, requireRoles(['restaurant_admin']), deleteMenuItemImage);

router.get('/staff', authenticateToken, requireRoles(['restaurant_admin']), validate(listStaffQuerySchema, 'query'), listStaff);
router.get('/staff/:id/activity', authenticateToken, requireRoles(['restaurant_admin']), validate(staffIdParamSchema, 'params'), validate(staffActivityQuerySchema, 'query'), getStaffActivity);
router.post('/staff', authenticateToken, requireRoles(['restaurant_admin']), validate(createStaffSchema), createStaff);
router.patch('/staff/:id/access', authenticateToken, requireRoles(['restaurant_admin']), validate(staffIdParamSchema, 'params'), validate(updateStaffAccessSchema), updateStaffAccess);
router.post('/staff/:id/revoke', authenticateToken, requireRoles(['restaurant_admin']), validate(staffIdParamSchema, 'params'), revokeStaffAccess);
router.post('/staff/:id/restore', authenticateToken, requireRoles(['restaurant_admin']), validate(staffIdParamSchema, 'params'), restoreStaffAccess);
router.post('/staff/:id/resend-credentials', authenticateToken, requireRoles(['restaurant_admin']), validate(staffIdParamSchema, 'params'), resendStaffCredentials);

router.patch('/kitchen/order-items/:id/status', authenticateToken, requireRoles(['chef']), validate(itemIdParamSchema, 'params'), validate(kitchenOrderItemStatusSchema), updateKitchenOrderItemStatus);
router.post('/kitchen/orders/:orderId/reject', authenticateToken, requireRoles(['chef']), rejectChefOrder);
router.post('/kitchen/order-items/:orderItemId/reject', authenticateToken, requireRoles(['chef']), rejectChefOrderItem);
router.get('/kitchen/shift-history', authenticateToken, requireRoles(['chef', 'restaurant_admin']), getChefShiftHistory);

router.get('/notifications', authenticateToken, requireRoles(['restaurant_admin', 'waiter', 'chef']), listNotifications);
router.post('/notifications/:id/read', authenticateToken, requireRoles(['restaurant_admin', 'waiter', 'chef']), markNotificationRead);
router.post('/notifications/read-all', authenticateToken, requireRoles(['restaurant_admin', 'waiter', 'chef']), markAllNotificationsRead);

export default router;
