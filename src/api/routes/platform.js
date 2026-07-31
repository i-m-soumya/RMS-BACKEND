import express from 'express';
import { authenticateToken } from '../middleware/auth.js';
import { requireRoles } from '../middleware/roles.js';
import { validate } from '../middleware/validate.js';
import {
  createRestaurantAdminCredentials,
  createRestaurantBasicDetails,
  downloadRestaurantQrBatchZip,
  downloadTableQrCode,
  generateRestaurantQRCodes,
  getRestaurantQrBatch,
  listRestaurants,
  saveFloorsAndTables,
  updateRestaurantBasicDetails,
} from '../controllers/platformController.js';
import {
  createAdminCredentialsSchema,
  createRestaurantBasicSchema,
  floorsAndTablesSchema,
  restaurantIdParamSchema,
  restaurantListQuerySchema,
  tableIdParamSchema,
  updateRestaurantBasicSchema,
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
    ...(deps.handlers ?? {}),
  };

  const router = express.Router();

  router.get('/health', authMiddleware, roleGuard(['platform_admin']), (req, res) => {
    res.json({ status: 'ok', scope: 'platform' });
  });

  router.get('/restaurants', authMiddleware, roleGuard(['platform_admin']), validateMiddleware(restaurantListQuerySchema, 'query'), handlers.listRestaurants);

  router.post('/restaurants', authMiddleware, roleGuard(['platform_admin']), validateMiddleware(createRestaurantBasicSchema), handlers.createRestaurantBasicDetails);

  router.patch(
    '/restaurants/:restaurantId/basic-details',
    authMiddleware,
    roleGuard(['platform_admin']),
    validateMiddleware(restaurantIdParamSchema, 'params'),
    validateMiddleware(updateRestaurantBasicSchema),
    handlers.updateRestaurantBasicDetails,
  );

  router.put(
    '/restaurants/:restaurantId/floors-and-tables',
    authMiddleware,
    roleGuard(['platform_admin']),
    validateMiddleware(restaurantIdParamSchema, 'params'),
    validateMiddleware(floorsAndTablesSchema),
    handlers.saveFloorsAndTables,
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
