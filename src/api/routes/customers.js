import express from 'express';
import { authenticateToken } from '../middleware/auth.js';
import { requireRoles } from '../middleware/roles.js';
import { requestOtp, verifyOtp } from '../../services/otpService.js';
import db from '../../db/connection.js';
import { v4 as uuidv4 } from 'uuid';
import { signCustomerToken } from '../../services/jwt.js';

const router = express.Router();

router.get('/me', authenticateToken, requireRoles(['customer']), (req, res) => {
  res.json({ id: req.user.id, role: req.user.role, name: req.user.name });
});

router.post('/otp/request', (req, res, next) => {
  try {
    res.json(requestOtp(req.body?.mobile));
  } catch (error) {
    next(error);
  }
});

router.post('/otp/verify', (req, res, next) => {
  try {
    const result = verifyOtp(req.body?.mobile, req.body?.otp);
    const now = new Date();
    const ensureCustomer = async () => {
      const [existing] = await db('customers').where({ phone: result.mobile }).whereNull('deleted_at').limit(1);
      if (existing) {
        await db('customers').where({ id: existing.id }).update({ is_registered: 1, updated_at: now });
        return existing.id;
      }
      const id = uuidv4();
      await db('customers').insert({ id, phone: result.mobile, is_registered: 1, created_at: now, updated_at: now });
      return id;
    };
    ensureCustomer().then((customerId) => res.json({
      ...result,
      customerId,
      token: signCustomerToken({ id: customerId, mobile: result.mobile }),
    })).catch(next);
  } catch (error) {
    next(error);
  }
});

export default router;
