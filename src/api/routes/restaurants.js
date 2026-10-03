import express from 'express';
import {
  getRestaurant,
  getRestaurantMenu,
  getTable,
  getTableSession,
  createGuestToken,
  createCustomerOrder,
  getOrderStatus,
  getCustomerOrders,
  requestBill,
} from '../controllers/restaurantController.js';
import { validate } from '../middleware/validate.js';
import {
  slugParamSchema,
  restaurantTableParamSchema,
  tableParamSchema,
} from '../validators/restaurants.js';

const router = express.Router();

router.get('/:slug/menu', validate(slugParamSchema, 'params'), getRestaurantMenu);
router.get('/:slug/table/:tableNumber', validate(restaurantTableParamSchema, 'params'), getTable);
router.get('/:slug/table/:tableNumber/session', validate(restaurantTableParamSchema, 'params'), getTableSession);
router.post('/:slug/table/:tableNumber/guest-token', validate(restaurantTableParamSchema, 'params'), createGuestToken);
router.post('/:slug/order', validate(slugParamSchema, 'params'), createCustomerOrder);
router.get('/:slug/order/:orderId', validate(slugParamSchema, 'params'), getOrderStatus);
router.get('/:slug/orders/active', validate(slugParamSchema, 'params'), getCustomerOrders);
router.post('/:slug/bill-request', validate(slugParamSchema, 'params'), requestBill);
router.get('/:slug', validate(slugParamSchema, 'params'), getRestaurant);
router.get('/:id/tables/:tableId', validate(tableParamSchema, 'params'), getTable);

export default router;
