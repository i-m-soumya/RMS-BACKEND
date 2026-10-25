import express from 'express';
import { signupStartLimiter } from '../middleware/signupRateLimit.js';
import * as signup from '../controllers/signupController.js';

const router = express.Router();

router.get('/plan', signup.getPlan);
router.post('/start', signupStartLimiter, signup.startSignup);
router.get('/:token/status', signup.getSignupStatus);
router.post('/:token/email-otp/send', signup.sendEmailOtp);
router.post('/:token/email-otp/verify', signup.verifyEmailOtp);
router.post('/:token/mobile-otp/send', signup.sendMobileOtp);
router.post('/:token/mobile-otp/verify', signup.verifyMobileOtp);
router.post('/:token/password', signup.setPassword);
router.post('/:token/trial/confirm', signup.confirmTrial);

export default router;
