import express from 'express';
import { 
  customerLogin, 
  customerRegister, 
  staffLogin, 
  platformAdminLogin,
  refreshToken
} from '../controllers/authController.js';
import { validate } from '../middleware/validate.js';
import { authLimiter } from '../middleware/rateLimit.js';
import {
  customerLoginSchema,
  customerRegisterSchema,
  staffLoginSchema,
  refreshSchema
} from '../validators/auth.js';

const router = express.Router();

router.post('/customer-login', authLimiter, validate(customerLoginSchema), customerLogin);
router.post('/customer-register', authLimiter, validate(customerRegisterSchema), customerRegister);
router.post('/staff-login', authLimiter, validate(staffLoginSchema), staffLogin);
router.post('/platform-admin-login', authLimiter, validate(staffLoginSchema), platformAdminLogin);
router.post('/refresh', authLimiter, validate(refreshSchema), refreshToken);

export default router;
