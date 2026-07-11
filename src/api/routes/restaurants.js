import express from 'express';
import { getRestaurant, getRestaurantMenu, getTable } from '../controllers/restaurantController.js';
import { validate } from '../middleware/validate.js';
import { slugParamSchema, tableParamSchema } from '../validators/restaurants.js';

const router = express.Router();

router.get('/:slug', validate(slugParamSchema, 'params'), getRestaurant);
router.get('/:slug/menu', validate(slugParamSchema, 'params'), getRestaurantMenu);
router.get('/:id/tables/:tableId', validate(tableParamSchema, 'params'), getTable);

export default router;
