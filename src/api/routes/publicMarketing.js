import express from 'express';
import { createContactQuery, createRegistration, createWebsiteView } from '../controllers/publicMarketingController.js';
import rateLimit from 'express-rate-limit';

const formLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  max: 60,
  standardHeaders: true,
  legacyHeaders: false,
  message: { code: 'MARKETING_RATE_LIMITED', message: 'Too many submissions. Try again later.' },
});

const websiteViewLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  max: 300,
  standardHeaders: true,
  legacyHeaders: false,
  message: { code: 'WEBSITE_VIEW_RATE_LIMITED', message: 'Too many page views. Try again later.' },
});

const router = express.Router();
router.post('/website-views', websiteViewLimiter, createWebsiteView);
router.post('/contact-queries', formLimiter, createContactQuery);
router.post('/registrations', formLimiter, createRegistration);

export default router;
