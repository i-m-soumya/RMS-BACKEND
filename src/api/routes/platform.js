import express from 'express';
import { authenticateToken } from '../middleware/auth.js';
import { requireRoles } from '../middleware/roles.js';
import { validate } from '../middleware/validate.js';
import {
  createRestaurantAdminCredentials,
  getRestaurantDetails,
  resendRestaurantAdminCredentials,
  updateRestaurant,
  updateRestaurantBranding,
  updateRestaurantGst,
  createRestaurantBasicDetails,
  downloadRestaurantQrBatchZip,
  downloadTableQrCode,
  generateRestaurantQRCodes,
  getRestaurantQrBatch,
  listRestaurants,
  saveFloorsAndTables,
  suspendRestaurant,
  reactivateRestaurant,
  updateRestaurantBasicDetails,
} from '../controllers/platformController.js';
import {
  approveChangeRequest,
  listChangeRequests,
  rejectChangeRequest,
} from '../controllers/changeRequestController.js';
import * as reporting from '../controllers/platformReportingController.js';
import {
  createAdminCredentialsSchema,
  createRestaurantBasicSchema,
  floorsAndTablesSchema,
  restaurantIdParamSchema,
  restaurantListQuerySchema,
  tableIdParamSchema,
  updateRestaurantBasicSchema,
  updateRestaurantSchema,
  updateRestaurantBrandingSchema,
  updateRestaurantGstSchema,
} from '../validators/platformOnboarding.js';

export function createPlatformRouter(deps = {}) {
  const authMiddleware = deps.authenticateToken ?? authenticateToken;
  const roleGuard = deps.requireRoles ?? requireRoles;
  const validateMiddleware = deps.validate ?? validate;

  const handlers = {
    listRestaurants,
    createRestaurantBasicDetails,
    updateRestaurantBasicDetails,
    saveFloorsAndTables,
    generateRestaurantQRCodes,
    getRestaurantQrBatch,
    downloadRestaurantQrBatchZip,
    downloadTableQrCode,
    createRestaurantAdminCredentials,
    getRestaurantDetails,
    resendRestaurantAdminCredentials,
    updateRestaurant,
    updateRestaurantBranding,
    updateRestaurantGst,
    suspendRestaurant,
    reactivateRestaurant,
    ...(deps.handlers ?? {}),
  };

  const router = express.Router();

  router.get('/health', authMiddleware, roleGuard(['platform_admin']), (req, res) => {
    res.json({ status: 'ok', scope: 'platform' });
  });

  router.get('/change-requests', authMiddleware, roleGuard(['platform_admin']), listChangeRequests);
  router.post('/change-requests/:id/approve', authMiddleware, roleGuard(['platform_admin']), approveChangeRequest);
  router.post('/change-requests/:id/reject', authMiddleware, roleGuard(['platform_admin']), rejectChangeRequest);
  router.get('/analytics/website-views', authMiddleware, roleGuard(['platform_admin']), reporting.websiteViews);
  router.get('/analytics/orders-revenue', authMiddleware, roleGuard(['platform_admin']), reporting.ordersRevenue);
  router.get('/analytics/churn-signals', authMiddleware, roleGuard(['platform_admin']), reporting.churnSignals);
  router.get('/analytics/status-summary', authMiddleware, roleGuard(['platform_admin']), reporting.statusSummary);
  router.get('/contact-queries', authMiddleware, roleGuard(['platform_admin']), reporting.listContactQueries);
  router.post('/contact-queries/:id/resolve', authMiddleware, roleGuard(['platform_admin']), reporting.resolveContactQuery);
  router.post('/contact-queries/:id/spam', authMiddleware, roleGuard(['platform_admin']), reporting.spamContactQuery);
  router.get('/registrations', authMiddleware, roleGuard(['platform_admin']), reporting.listRegistrations);
  router.get('/registrations/conversion-rate', authMiddleware, roleGuard(['platform_admin']), reporting.registrationConversionRate);

  router.get('/restaurants', authMiddleware, roleGuard(['platform_admin']), validateMiddleware(restaurantListQuerySchema, 'query'), handlers.listRestaurants);

  router.get('/restaurants/:restaurantId', authMiddleware, roleGuard(['platform_admin']), validateMiddleware(restaurantIdParamSchema, 'params'), handlers.getRestaurantDetails);

  router.post('/restaurants', authMiddleware, roleGuard(['platform_admin']), validateMiddleware(createRestaurantBasicSchema), handlers.createRestaurantBasicDetails);

  router.patch(
    '/restaurants/:restaurantId/basic-details',
    authMiddleware,
    roleGuard(['platform_admin']),
    validateMiddleware(restaurantIdParamSchema, 'params'),
    validateMiddleware(updateRestaurantBasicSchema),
    handlers.updateRestaurantBasicDetails,
  );

  router.patch('/restaurants/:restaurantId', authMiddleware, roleGuard(['platform_admin']), validateMiddleware(restaurantIdParamSchema, 'params'), validateMiddleware(updateRestaurantSchema), handlers.updateRestaurant);
  router.patch('/restaurants/:restaurantId/branding', authMiddleware, roleGuard(['platform_admin']), validateMiddleware(restaurantIdParamSchema, 'params'), validateMiddleware(updateRestaurantBrandingSchema), handlers.updateRestaurantBranding);
  router.patch('/restaurants/:restaurantId/gst', authMiddleware, roleGuard(['platform_admin']), validateMiddleware(restaurantIdParamSchema, 'params'), validateMiddleware(updateRestaurantGstSchema), handlers.updateRestaurantGst);

  router.put(
    '/restaurants/:restaurantId/floors-and-tables',
    authMiddleware,
    roleGuard(['platform_admin']),
    validateMiddleware(restaurantIdParamSchema, 'params'),
    validateMiddleware(floorsAndTablesSchema),
    handlers.saveFloorsAndTables,
  );

  router.post('/restaurants/:restaurantId/admin-credentials/resend', authMiddleware, roleGuard(['platform_admin']), validateMiddleware(restaurantIdParamSchema, 'params'), handlers.resendRestaurantAdminCredentials);

  router.post(
    '/restaurants/:restaurantId/suspend',
    authMiddleware,
    roleGuard(['platform_admin']),
    validateMiddleware(restaurantIdParamSchema, 'params'),
    handlers.suspendRestaurant,
  );

  router.post(
    '/restaurants/:restaurantId/reactivate',
    authMiddleware,
    roleGuard(['platform_admin']),
    validateMiddleware(restaurantIdParamSchema, 'params'),
    handlers.reactivateRestaurant,
  );

  router.post(
    '/restaurants/:restaurantId/qr-codes/generate',
    authMiddleware,
    roleGuard(['platform_admin']),
    validateMiddleware(restaurantIdParamSchema, 'params'),
    handlers.generateRestaurantQRCodes,
  );

  router.get(
    '/restaurants/:restaurantId/qr-codes/batch',
    authMiddleware,
    roleGuard(['platform_admin']),
    validateMiddleware(restaurantIdParamSchema, 'params'),
    handlers.getRestaurantQrBatch,
  );

  router.get(
    '/restaurants/:restaurantId/qr-codes/batch-download',
    authMiddleware,
    roleGuard(['platform_admin']),
    validateMiddleware(restaurantIdParamSchema, 'params'),
    handlers.downloadRestaurantQrBatchZip,
  );

  router.get('/tables/:tableId/qr', authMiddleware, roleGuard(['platform_admin']), validateMiddleware(tableIdParamSchema, 'params'), handlers.downloadTableQrCode);

  router.post(
    '/restaurants/:restaurantId/admin-credentials',
    authMiddleware,
    roleGuard(['platform_admin']),
    validateMiddleware(restaurantIdParamSchema, 'params'),
    validateMiddleware(createAdminCredentialsSchema),
    handlers.createRestaurantAdminCredentials,
  );

  return router;
}

const router = createPlatformRouter();

export default router;
