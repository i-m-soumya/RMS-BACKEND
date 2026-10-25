import bcrypt from 'bcrypt';
import { createHash, createHmac, randomBytes, randomInt, randomUUID, timingSafeEqual } from 'node:crypto';
import { z } from 'zod';
import db from '../../db/connection.js';
import { appConfig } from '../../config/app.config.js';
import { logger } from '../../config/logger.js';
import { redis, connectRedis } from '../../services/redis.js';
import { DummyPaymentProvider, RealPaymentProvider, DummySmsProvider, RealSmsProvider } from '../../services/signupProviders.js';
import { enqueueMail } from '../../mailer/queue.js';
import { verifySignupCaptcha } from '../../services/signupCaptcha.js';
import { issueStaffSession } from './authController.js';
import { normalizeRestaurantSlug } from '../../services/restaurantSlug.js';

const EMAIL_STEP = 'email_otp';
const STEP_ORDER = ['email_otp', 'mobile_otp', 'password', 'trial', 'done'];
const RESERVED_SLUGS = new Set(['admin', 'api', 'app', 'console', 'login', 'signup', 'support', 'www', 'restro360']);
const startSchema = z.object({
  ownerName: z.string().trim().min(2).max(100),
  restaurantName: z.string().trim().min(2).max(150),
  email: z.string().trim().email().max(150),
  mobile: z.string().trim().min(10).max(16),
  consent: z.literal(true),
  policyVersion: z.string().trim().min(1).max(40),
  utm: z.record(z.string().max(255)).optional().default({}),
  referrer: z.string().trim().max(500).optional().default(''),
  hp: z.string().optional().default(''),
  captchaToken: z.string().max(2048).optional(),
});
const codeSchema = z.object({ code: z.string().regex(/^\d{4,6}$/) });
const passwordSchema = z.object({ password: z.string().min(8).max(128) });
const confirmSchema = z.object({
  autopayConsent: z.literal(true),
  idempotencyKey: z.string().trim().min(8).max(128),
  simulate: z.enum(['success', 'fail']).optional(),
});
const onboardingSchema = z.object({ status: z.enum(['done', 'skipped']) });
const emailPattern = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

function sendError(res, status, code, message, retryAfter) {
  return res.status(status).json({
    error: { code, message, ...(Number.isFinite(retryAfter) && retryAfter > 0 ? { retryAfter } : {}) },
  });
}

function validationError(res) {
  return sendError(res, 422, 'VALIDATION_ERROR', 'Please check the submitted details.');
}

function signupRef(token) {
  return createHash('sha256').update(token).digest('hex').slice(0, 12);
}

function secretKey() {
  return process.env.JWT_SECRET || 'rms-dev-secret-change-in-prod';
}

function hashValue(value) {
  return createHmac('sha256', secretKey()).update(String(value)).digest('hex');
}

function hashOtp(token, channel, code) {
  return hashValue(`${token}:${channel}:${code}`);
}

function normalizeEmail(value) {
  return value.trim().toLowerCase();
}

function normalizeMobile(value) {
  let digits = value.replace(/\D/g, '');
  if (digits.length === 12 && digits.startsWith('91')) digits = digits.slice(2);
  if (digits.length === 11 && digits.startsWith('0')) digits = digits.slice(1);
  return digits;
}

function maskEmail(email) {
  const [local, domain] = email.split('@');
  return `${local.slice(0, 1)}${'*'.repeat(Math.max(1, local.length - 1))}@${domain}`;
}

function maskMobile(mobile) {
  return `${'*'.repeat(Math.max(0, mobile.length - 4))}${mobile.slice(-4)}`;
}

function safeToken(req) {
  const token = req.params.token;
  return typeof token === 'string' && /^[a-f0-9]{64}$/.test(token) ? token : null;
}

async function findSignup(token) {
  const row = await db('pending_signups').where({ token }).where('expires_at', '>', new Date()).first();
  return row || null;
}

async function findSignupOrRespond(req, res) {
  const token = safeToken(req);
  if (!token) {
    sendError(res, 404, 'SIGNUP_NOT_FOUND', 'This signup could not be found or has expired.');
    return null;
  }
  const signup = await findSignup(token);
  if (!signup) {
    sendError(res, 404, 'SIGNUP_NOT_FOUND', 'This signup could not be found or has expired.');
    return null;
  }
  return signup;
}

async function incrementLimit(key, max, windowSeconds) {
  await connectRedis();
  const count = await redis.incr(key);
  if (count === 1) await redis.expire(key, windowSeconds);
  const ttl = Math.max(1, await redis.ttl(key));
  if (count > max) throw Object.assign(new Error('Too many attempts. Try again later.'), {
    status: 429,
    code: 'RATE_LIMITED',
    retryAfter: ttl,
  });
  return count;
}

async function getActiveAccount(email, mobile) {
  const staffQuery = db('staff as s')
    .join('restaurants as r', 'r.id', 's.restaurant_id')
    .where('s.access', 'active')
    .whereNull('s.deleted_at')
    .andWhere('r.status', 'active')
    .andWhere((query) => query.where('s.email', email).orWhere('s.mobile', mobile))
    .first('s.id');
  const customerQuery = db('customers')
    .where('is_registered', 1)
    .andWhere((query) => query.where('email', email).orWhere('phone', mobile))
    .first('id');
  const [staff, customer] = await Promise.all([staffQuery, customerQuery]);
  return Boolean(staff || customer);
}

function formatCurrentStep(step) {
  return STEP_ORDER.includes(step) ? step : EMAIL_STEP;
}

export function getPlan(_req, res) {
  return res.json({
    trialMonths: appConfig.plan.trialMonths,
    trialPriceInr: appConfig.plan.trialPriceInr,
    standardPriceInr: appConfig.plan.standardPriceInr,
    gst: appConfig.plan.gst,
    testMode: {
      sms: appConfig.smsProvider === 'dummy',
      payment: appConfig.paymentProvider === 'dummy',
    },
  });
}

export async function startSignup(req, res) {
  const parsed = startSchema.safeParse(req.body);
  if (!parsed.success) return validationError(res);
  const body = parsed.data;
  if (body.hp.trim() !== '') return sendError(res, 400, 'INVALID_REQUEST', 'Unable to start signup.');
  if (!emailPattern.test(body.email)) return validationError(res);

  const email = normalizeEmail(body.email);
  const mobile = normalizeMobile(body.mobile);
  if (!/^\d{10}$/.test(mobile)) return validationError(res);
  if (JSON.stringify(body.utm).length > 2048) return validationError(res);

  try {
    await incrementLimit(`signup:start:email:${hashValue(email)}`, 5, 60 * 60);
    const activeAccount = await getActiveAccount(email, mobile);
    if (activeAccount) return sendError(res, 409, 'ACCOUNT_EXISTS', 'An account already exists for these details.');

    const existing = await db('pending_signups').where({ email }).where('expires_at', '>', new Date()).first();
    if (existing) {
      return res.status(201).json({ token: existing.token, step: formatCurrentStep(existing.step) });
    }

    const pendingMobile = await db('pending_signups').where({ mobile }).where('expires_at', '>', new Date()).first();
    if (pendingMobile) return sendError(res, 409, 'ACCOUNT_EXISTS', 'An account already exists for these details.');

    if (appConfig.captcha.enabled) {
      const captchaPassed = await verifySignupCaptcha(body.captchaToken, req);
      if (!captchaPassed) return sendError(res, 422, 'CAPTCHA_FAILED', 'Please complete the signup verification.');
    }
    if (body.policyVersion !== appConfig.policyVersion) return sendError(res, 422, 'POLICY_VERSION', 'Please review the current privacy and terms notices.');

    const token = randomBytes(32).toString('hex');
    const now = new Date();
    await db('pending_signups').insert({
      token,
      owner_name: body.ownerName,
      restaurant_name: body.restaurantName,
      email,
      mobile,
      consent_at: now,
      policy_version: body.policyVersion,
      utm_json: JSON.stringify(body.utm),
      referrer: body.referrer || null,
      step: EMAIL_STEP,
      created_at: now,
      expires_at: new Date(now.getTime() + 24 * 60 * 60 * 1000),
    });
    logger.info({ signupRef: signupRef(token), event: 'signup_started' }, 'Signup started');
    return res.status(201).json({ token, step: EMAIL_STEP });
  } catch (error) {
    if (error.status === 429) return sendError(res, 429, error.code, error.message, error.retryAfter);
    if (error.code === 'ER_DUP_ENTRY') {
      try {
        const resumable = await db('pending_signups').where({ email }).where('expires_at', '>', new Date()).first();
        if (resumable) return res.status(201).json({ token: resumable.token, step: formatCurrentStep(resumable.step) });
      } catch (lookupError) {
        logger.error({ code: lookupError.code }, 'Pending signup recovery failed');
        return sendError(res, 503, 'SIGNUP_UNAVAILABLE', 'Signup is temporarily unavailable. Please try again.');
      }
      return sendError(res, 409, 'ACCOUNT_EXISTS', 'An account already exists for these details.');
    }
    logger.error({
      requestId: req.requestId,
      code: error.code || 'UNKNOWN',
      errno: error.errno,
      sqlState: error.sqlState,
      message: error.message,
    }, 'Signup start failed');
    return sendError(res, 503, 'SIGNUP_UNAVAILABLE', 'Signup is temporarily unavailable. Please try again.');
  }
}

export async function getSignupStatus(req, res) {
  try {
    const signup = await findSignupOrRespond(req, res);
    if (!signup) return;
    return res.json({
      step: formatCurrentStep(signup.step),
      emailMasked: maskEmail(signup.email),
      mobileMasked: maskMobile(signup.mobile),
    });
  } catch (error) {
    logger.error({ code: error.code }, 'Signup status lookup failed');
    return sendError(res, 503, 'SIGNUP_UNAVAILABLE', 'Signup is temporarily unavailable. Please try again.');
  }
}

async function checkOtpRateLimits(req, signup, channel) {
  const ref = signupRef(signup.token);
  const emailHash = hashValue(signup.email).slice(0, 24);
  await incrementLimit(`signup:otp:ip:${channel}:${hashValue(req.ip || 'unknown').slice(0, 24)}`, 10, 15 * 60);
  await incrementLimit(`signup:otp:email:${channel}:${emailHash}`, 8, 60 * 60);
  await connectRedis();
  const cooldown = await redis.set(`signup:otp:cooldown:${ref}:${channel}`, '1', { NX: true, EX: appConfig.otp.resendCooldownSeconds });
  if (!cooldown) {
    const retryAfter = Math.max(1, await redis.ttl(`signup:otp:cooldown:${ref}:${channel}`));
    throw Object.assign(new Error('Wait before requesting another code.'), { status: 429, code: 'RESEND_COOLDOWN', retryAfter });
  }
  await incrementLimit(`signup:otp:sends:${ref}:${channel}`, appConfig.otp.maxSendsPerHour, 60 * 60);
}

async function sendOtp(req, res, channel) {
  try {
    const signup = await findSignupOrRespond(req, res);
    if (!signup) return;
    const expectedStep = channel === 'email' ? 'email_otp' : 'mobile_otp';
    if (signup.step !== expectedStep) return sendError(res, 409, 'STEP_ORDER', 'Complete the previous verification step first.');

    await checkOtpRateLimits(req, signup, channel);
    const code = channel === 'email' ? String(randomInt(0, 1000000)).padStart(appConfig.otp.emailLength, '0') : '0000';
    const ttl = appConfig.otp.ttlSeconds;
    const ref = signupRef(signup.token);
    await connectRedis();
    await redis.set(`signup:otp:${ref}:${channel}`, hashOtp(signup.token, channel, code), { EX: ttl });
    await redis.del(`signup:otp:attempts:${ref}:${channel}`);

    try {
      if (channel === 'email') {
        await enqueueMail({
          type: 'otp',
          to: signup.email,
          ownerName: signup.owner_name,
          code,
          expiresMinutes: Math.floor(ttl / 60),
          idempotencyKey: `otp-${ref}-${randomUUID()}`,
        });
      } else if (appConfig.smsProvider === 'dummy') {
        await new DummySmsProvider().send({ signupRef: ref });
      } else {
        await new RealSmsProvider().send({ mobile: signup.mobile, code });
      }
    } catch (error) {
      await redis.del(`signup:otp:${ref}:${channel}`, `signup:otp:attempts:${ref}:${channel}`, `signup:otp:cooldown:${ref}:${channel}`);
      throw error;
    }

    logger.info({ signupRef: ref, channel, event: 'otp_sent' }, 'Signup verification code sent');
    return res.json({ resendIn: appConfig.otp.resendCooldownSeconds });
  } catch (error) {
    if (error.status === 429) return sendError(res, 429, error.code, error.message, error.retryAfter);
    logger.error({
      requestId: req.requestId,
      code: error.code || 'UNKNOWN',
      errno: error.errno,
      channel,
      message: error.message,
    }, 'Signup verification send failed');
    return sendError(res, 503, 'OTP_SEND_FAILED', 'Unable to send a verification code right now. Please try again.');
  }
}

export const sendEmailOtp = (req, res) => sendOtp(req, res, 'email');
export const sendMobileOtp = (req, res) => sendOtp(req, res, 'mobile');

async function verifyOtp(req, res, channel) {
  const parsed = codeSchema.safeParse(req.body);
  if (!parsed.success) return validationError(res);
  try {
    const signup = await findSignupOrRespond(req, res);
    if (!signup) return;
    const expectedStep = channel === 'email' ? 'email_otp' : 'mobile_otp';
    if (signup.step !== expectedStep) return sendError(res, 409, 'STEP_ORDER', 'Complete the previous verification step first.');

    const ref = signupRef(signup.token);
    const key = `signup:otp:${ref}:${channel}`;
    const attemptsKey = `signup:otp:attempts:${ref}:${channel}`;
    await connectRedis();
    await incrementLimit(`signup:otp:verify:ip:${channel}:${hashValue(req.ip || 'unknown').slice(0, 24)}`, 10, 15 * 60);
    await incrementLimit(`signup:otp:verify:email:${channel}:${hashValue(signup.email).slice(0, 24)}`, 8, 60 * 60);
    const storedHash = await redis.get(key);
    if (!storedHash) return sendError(res, 410, 'OTP_EXPIRED', 'This code is invalid or expired. Request a new code.');

    const expectedLength = channel === 'email' ? appConfig.otp.emailLength : appConfig.otp.mobileLength;
    if (parsed.data.code.length !== expectedLength) return sendError(res, 422, 'VALIDATION_ERROR', 'Enter the verification code.');
    const candidateHash = hashOtp(signup.token, channel, parsed.data.code);
    let valid = timingSafeEqual(Buffer.from(storedHash, 'hex'), Buffer.from(candidateHash, 'hex'));
    if (channel === 'mobile' && appConfig.smsProvider === 'dummy') {
      valid = await new DummySmsProvider().verify({ code: parsed.data.code });
    }
    if (!valid) {
      const attempts = await redis.incr(attemptsKey);
      if (attempts === 1) await redis.expire(attemptsKey, appConfig.otp.ttlSeconds);
      if (attempts >= appConfig.otp.maxAttempts) {
        await redis.del(key, attemptsKey);
        logger.info({ signupRef: ref, channel, event: 'otp_attempts_exceeded' }, 'Signup verification attempts exceeded');
        return sendError(res, 429, 'OTP_ATTEMPTS_EXCEEDED', 'Too many incorrect codes. Request a new code.', appConfig.otp.resendCooldownSeconds);
      }
      logger.info({ signupRef: ref, channel, event: 'otp_rejected' }, 'Signup verification code rejected');
      return sendError(res, 400, 'OTP_INVALID', 'This code is invalid or expired.');
    }

    await redis.del(key, attemptsKey, `signup:otp:cooldown:${ref}:${channel}`);
    const nextStep = channel === 'email' ? 'mobile_otp' : 'password';
    await db('pending_signups').where({ token: signup.token }).update({
      step: nextStep,
      [channel === 'email' ? 'email_verified_at' : 'mobile_verified_at']: new Date(),
    });
    logger.info({ signupRef: ref, channel, event: 'otp_verified' }, 'Signup verification completed');
    return res.json({ step: nextStep });
  } catch (error) {
    if (error.status === 429) return sendError(res, 429, error.code, error.message, error.retryAfter);
    logger.error({ code: error.code, channel }, 'Signup verification failed');
    return sendError(res, 503, 'OTP_VERIFY_FAILED', 'Unable to verify the code right now. Please try again.');
  }
}

export const verifyEmailOtp = (req, res) => verifyOtp(req, res, 'email');
export const verifyMobileOtp = (req, res) => verifyOtp(req, res, 'mobile');

export async function setPassword(req, res) {
  const parsed = passwordSchema.safeParse(req.body);
  if (!parsed.success) return validationError(res);
  try {
    const signup = await findSignupOrRespond(req, res);
    if (!signup) return;
    if (signup.step !== 'password' || !signup.email_verified_at || !signup.mobile_verified_at) {
      return sendError(res, 409, 'STEP_ORDER', 'Verify your email and mobile before setting a password.');
    }
    const passwordHash = await bcrypt.hash(parsed.data.password, 10);
    await db('pending_signups').where({ token: signup.token }).update({ password_hash: passwordHash, step: 'trial' });
    logger.info({ signupRef: signupRef(signup.token), event: 'signup_password_set' }, 'Signup password configured');
    return res.json({ step: 'trial' });
  } catch (error) {
    logger.error({ code: error.code }, 'Signup password update failed');
    return sendError(res, 503, 'SIGNUP_UNAVAILABLE', 'Signup is temporarily unavailable. Please try again.');
  }
}

function normalizeSlug(value) {
  let slug = normalizeRestaurantSlug(value).slice(0, 90);
  if (!slug) slug = 'restaurant';
  if (RESERVED_SLUGS.has(slug)) slug = `my-${slug}`;
  return slug;
}

async function availableSlug(trx, restaurantName) {
  const base = normalizeSlug(restaurantName);
  let slug = base;
  let suffix = 2;
  while (await trx('restaurants').where({ slug }).first('id')) {
    slug = `${base.slice(0, 88)}-${suffix++}`;
  }
  return slug;
}

function addMonths(date, months) {
  const result = new Date(date);
  const day = result.getUTCDate();
  result.setUTCDate(1);
  result.setUTCMonth(result.getUTCMonth() + months);
  const lastDay = new Date(Date.UTC(result.getUTCFullYear(), result.getUTCMonth() + 1, 0)).getUTCDate();
  result.setUTCDate(Math.min(day, lastDay));
  return result;
}

function deriveHandoffCode(signupToken, idempotencyKey, createdAt, nonce) {
  return createHmac('sha256', secretKey())
    .update(`${signupToken}:${idempotencyKey}:${createdAt.getTime()}:${nonce}`)
    .digest('base64url');
}

function providerForPayment() {
  return appConfig.paymentProvider === 'dummy' ? new DummyPaymentProvider() : new RealPaymentProvider();
}

async function createRestaurantAndSubscription(trx, signup, idempotencyKey, autopayConsentAt, providerResult, trialEnd) {
  const existingSubscription = await trx('subscriptions').where({ signup_id: signup.token }).forUpdate().first();
  if (existingSubscription) return existingSubscription;

  const now = new Date();
  const restaurantId = randomUUID();
  const staffId = randomUUID();
  const floorId = randomUUID();
  const restaurantSlug = await availableSlug(trx, signup.restaurant_name);

  await trx('restaurants').insert({
    id: restaurantId,
    name: signup.restaurant_name,
    legal_name: signup.restaurant_name,
    slug: restaurantSlug,
    city: '',
    state: null,
    country: 'India',
    timezone: 'Asia/Kolkata',
    contact_email: signup.email,
    manager_name: signup.owner_name,
    currency: 'INR',
    onboarded_by: null,
    status: 'active',
    table_count: 0,
    source: 'self-signup',
    created_at: now,
    updated_at: now,
  });
  await trx('staff').insert({
    id: staffId,
    restaurant_id: restaurantId,
    name: signup.owner_name,
    email: signup.email,
    mobile: signup.mobile,
    password_hash: signup.password_hash,
    role: 'restaurant_admin',
    access: 'active',
    created_at: now,
    updated_at: now,
  });
  await trx('floors').insert({
    id: floorId,
    restaurant_id: restaurantId,
    name: 'Ground Floor',
    floor_order: 1,
    display_order: 1,
    is_active: 1,
    created_at: now,
    updated_at: now,
  });

  const steps = [
    ['tables_qr', true],
    ['staff', false],
    ['menu', false],
    ...(appConfig.features.stock ? [['stock', false]] : []),
  ];
  for (const [stepKey, required] of steps) {
    await trx('onboarding_progress').insert({
      id: randomUUID(),
      restaurant_id: restaurantId,
      staff_id: staffId,
      step_key: stepKey,
      required: required ? 1 : 0,
      status: 'pending',
      created_at: now,
      updated_at: now,
    });
  }

  const subscription = {
    id: randomUUID(),
    signup_id: signup.token,
    restaurant_id: restaurantId,
    plan_code: 'restaurant-trial',
    status: 'trial',
    trial_price: appConfig.plan.trialPriceInr,
    standard_price: appConfig.plan.standardPriceInr,
    trial_end: trialEnd,
    next_billing_date: trialEnd,
    provider: providerResult.provider,
    provider_customer_id: providerResult.providerCustomerId,
    provider_subscription_id: providerResult.providerSubscriptionId,
    idempotency_key: idempotencyKey,
    autopay_consent_at: autopayConsentAt,
    created_at: now,
    updated_at: now,
  };
  await trx('subscriptions').insert(subscription);
  await trx('pending_signups').where({ token: signup.token }).update({ step: 'done' });
  return subscription;
}

export async function confirmTrial(req, res) {
  const parsed = confirmSchema.safeParse(req.body);
  if (!parsed.success) return validationError(res);
  try {
    const signup = await findSignupOrRespond(req, res);
    if (!signup) return;
    if (!['trial', 'done'].includes(signup.step) || !signup.password_hash || !signup.email_verified_at || !signup.mobile_verified_at) {
      return sendError(res, 409, 'STEP_ORDER', 'Complete verification and password setup before confirming the trial.');
    }
    if (parsed.data.simulate && appConfig.paymentProvider !== 'dummy') {
      return sendError(res, 400, 'INVALID_REQUEST', 'Simulation is only available in test mode.');
    }

    const autopayConsentAt = new Date();
    const existingSubscription = await db('subscriptions').where({ signup_id: signup.token }).first();
    const paymentResult = existingSubscription
      ? {
          success: true,
          provider: existingSubscription.provider,
          providerCustomerId: existingSubscription.provider_customer_id,
          providerSubscriptionId: existingSubscription.provider_subscription_id,
        }
      : await providerForPayment().createSubscription({
          signup,
          simulate: parsed.data.simulate,
          idempotencyKey: parsed.data.idempotencyKey,
        });
    if (!paymentResult.success) return sendError(res, 402, 'PAYMENT_FAILED', 'Payment setup did not complete. You can retry without verifying again.');

    const trialEnd = addMonths(new Date(), appConfig.plan.trialMonths);
    const outcome = await db.transaction(async (trx) => {
      const lockedSignup = await trx('pending_signups')
        .where({ token: signup.token })
        .where('expires_at', '>', new Date())
        .forUpdate()
        .first();
      if (!lockedSignup) throw Object.assign(new Error('Signup expired'), { code: 'SIGNUP_NOT_FOUND' });
      const subscription = await createRestaurantAndSubscription(
        trx,
        lockedSignup,
        parsed.data.idempotencyKey,
        autopayConsentAt,
        paymentResult,
        trialEnd,
      );
      const restaurant = await trx('restaurants').where({ id: subscription.restaurant_id }).first('slug');
      const staff = await trx('staff')
        .where({ restaurant_id: subscription.restaurant_id, role: 'restaurant_admin', access: 'active' })
        .first('id', 'name', 'email', 'restaurant_id');

      const now = new Date(Math.floor(Date.now() / 1000) * 1000);
      const expiresAt = new Date(now.getTime() + 2 * 60 * 1000);
      const handoff = await trx('handoff_codes').where({ signup_id: signup.token }).first();
      let code;
      if (handoff
        && handoff.idempotency_key === parsed.data.idempotencyKey
        && !handoff.consumed_at
        && new Date(handoff.expires_at).getTime() > Date.now()) {
        code = deriveHandoffCode(signup.token, handoff.idempotency_key, new Date(handoff.created_at), handoff.code_nonce);
      } else {
        const nonce = randomBytes(16).toString('hex');
        code = deriveHandoffCode(signup.token, parsed.data.idempotencyKey, now, nonce);
        const codeHash = hashValue(code);
        if (handoff) {
          await trx('handoff_codes').where({ signup_id: signup.token }).update({
            code_hash: codeHash,
            idempotency_key: parsed.data.idempotencyKey,
            code_nonce: nonce,
            expires_at: expiresAt,
            consumed_at: null,
            created_at: now,
          });
        } else {
          await trx('handoff_codes').insert({
            signup_id: signup.token,
            code_hash: codeHash,
            idempotency_key: parsed.data.idempotencyKey,
            code_nonce: nonce,
            expires_at: expiresAt,
            consumed_at: null,
            created_at: now,
          });
        }
      }
      return { subscription, restaurantSlug: restaurant.slug, staff, code };
    });

    try {
      await enqueueMail({
        type: 'welcome',
        to: outcome.staff.email,
        ownerName: outcome.staff.name,
        restaurantName: signup.restaurant_name,
        consoleUrl: `https://console.restro360.tech`,
        idempotencyKey: `welcome-${signupRef(signup.token)}`,
      });
    } catch (error) {
      logger.error({ signupRef: signupRef(signup.token), code: error.code }, 'Welcome email could not be queued');
    }

    const redirectUrl = `https://console.restro360.tech/start?code=${encodeURIComponent(outcome.code)}`;
    logger.info({ signupRef: signupRef(signup.token), event: 'trial_confirmed' }, 'Signup trial provisioned');
    return res.json({
      step: 'done',
      trialEnd: new Date(outcome.subscription.trial_end).toISOString(),
      redirectUrl,
    });
  } catch (error) {
    if (error.code === 'SIGNUP_NOT_FOUND') return sendError(res, 404, 'SIGNUP_NOT_FOUND', 'This signup could not be found or has expired.');
    if (error.code === 'ER_DUP_ENTRY') return sendError(res, 409, 'ACCOUNT_EXISTS', 'An account already exists for these details.');
    logger.error({
      requestId: req.requestId,
      code: error.code || 'UNKNOWN',
      errno: error.errno,
      sqlState: error.sqlState,
      message: error.message,
    }, 'Trial confirmation failed');
    return sendError(res, 503, 'TRIAL_CONFIRM_FAILED', 'Unable to set up the trial right now. Please retry.');
  }
}

export async function exchangeHandoffCode(req, res) {
  const parsed = z.object({ code: z.string().min(32).max(100) }).safeParse(req.body);
  if (!parsed.success) return sendError(res, 422, 'VALIDATION_ERROR', 'A valid handoff code is required.');
  const codeHash = hashValue(parsed.data.code);
  try {
    const result = await db.transaction(async (trx) => {
      const handoff = await trx('handoff_codes').where({ code_hash: codeHash }).forUpdate().first();
      if (!handoff || handoff.consumed_at || new Date(handoff.expires_at).getTime() <= Date.now()) return null;
      const consumed = await trx('handoff_codes')
        .where({ signup_id: handoff.signup_id, code_hash: codeHash })
        .whereNull('consumed_at')
        .where('expires_at', '>', new Date())
        .update({ consumed_at: new Date() });
      if (consumed !== 1) return null;
      const signup = await trx('pending_signups').where({ token: handoff.signup_id }).first();
      const subscription = await trx('subscriptions').where({ signup_id: handoff.signup_id }).first();
      const staff = await trx('staff as s')
        .join('restaurants as r', 'r.id', 's.restaurant_id')
        .where({ 's.restaurant_id': subscription?.restaurant_id, 's.role': 'restaurant_admin', 's.access': 'active' })
        .whereNull('s.deleted_at')
        .select('s.id', 's.name', 's.email', 's.role', 's.restaurant_id', 'r.slug as restaurant_slug', 'r.status as restaurant_status')
        .first();
      if (!signup || !subscription || !staff || staff.restaurant_status !== 'active') return null;

      return issueStaffSession(staff, req, trx);
    });
    if (!result) return sendError(res, 401, 'HANDOFF_INVALID', 'This handoff code is invalid or expired. Please log in.');
    return res.json(result);
  } catch (error) {
    logger.error({ code: error.code }, 'Handoff exchange failed');
    return sendError(res, 503, 'HANDOFF_UNAVAILABLE', 'Unable to complete sign in right now. Please log in.');
  }
}

export async function getOnboardingProgress(req, res) {
  try {
    const steps = await db('onboarding_progress')
      .where({ restaurant_id: req.user.restaurantId })
      .orderBy('created_at', 'asc')
      .select('step_key as key', 'required', 'status');
    const completed = steps.every((step) => step.status === 'done' || step.status === 'skipped');
    const [tables, qrCodes, staff, categories, items, subscription] = await Promise.all([
      db('tables').where({ restaurant_id: req.user.restaurantId }).count({ count: 'id' }).first(),
      db('table_qr_codes').where({ restaurant_id: req.user.restaurantId }).count({ count: 'id' }).first(),
      db('staff').where({ restaurant_id: req.user.restaurantId }).whereIn('role', ['waiter', 'chef']).count({ count: 'id' }).first(),
      db('menu_categories').where({ restaurant_id: req.user.restaurantId }).whereNull('deleted_at').count({ count: 'id' }).first(),
      db('menu_items').where({ restaurant_id: req.user.restaurantId }).whereNull('deleted_at').count({ count: 'id' }).first(),
      db('subscriptions').where({ restaurant_id: req.user.restaurantId }).select('trial_end as trialEndsAt', 'standard_price as standardPriceInr').first(),
    ]);
    return res.json({
      steps: steps.map((step) => ({ ...step, required: Boolean(step.required) })),
      completed,
      setup: {
        tableCount: Number(tables?.count || 0),
        qrCount: Number(qrCodes?.count || 0),
        staffCount: Number(staff?.count || 0),
        categoryCount: Number(categories?.count || 0),
        itemCount: Number(items?.count || 0),
      },
      subscription: subscription ? {
        trialEndsAt: subscription.trialEndsAt,
        standardPriceInr: Number(subscription.standardPriceInr),
      } : null,
    });
  } catch (error) {
    logger.error({ code: error.code }, 'Onboarding progress lookup failed');
    return sendError(res, 503, 'ONBOARDING_UNAVAILABLE', 'Unable to load onboarding progress.');
  }
}

export async function updateOnboardingStep(req, res) {
  const parsed = onboardingSchema.safeParse(req.body);
  const key = typeof req.params.key === 'string' ? req.params.key : '';
  if (!parsed.success || !['tables_qr', 'staff', 'menu', 'stock'].includes(key)) {
    return sendError(res, 422, 'VALIDATION_ERROR', 'Choose a valid onboarding step and status.');
  }
  try {
    const step = await db('onboarding_progress')
      .where({ restaurant_id: req.user.restaurantId, step_key: key })
      .first();
    if (!step) return sendError(res, 404, 'STEP_NOT_FOUND', 'That onboarding step is not available.');
    if (step.required && parsed.data.status === 'skipped') {
      return sendError(res, 422, 'REQUIRED_STEP', 'This onboarding step must be completed.');
    }
    await db('onboarding_progress')
      .where({ restaurant_id: req.user.restaurantId, step_key: key })
      .update({ status: parsed.data.status, updated_at: new Date() });
    return getOnboardingProgress(req, res);
  } catch (error) {
    logger.error({ code: error.code }, 'Onboarding progress update failed');
    return sendError(res, 503, 'ONBOARDING_UNAVAILABLE', 'Unable to update onboarding progress.');
  }
}
