import { createCipheriv, createDecipheriv, createHash, randomBytes } from 'node:crypto';
import IORedis from 'ioredis';
import { Queue, Worker, DelayedError } from 'bullmq';
import { logger } from '../config/logger.js';
import { mailConfig } from '../config/mail.config.js';
import { createOtpEmail, createWelcomeEmail } from './templates.js';
import { createTransport, readSmtpEnv, verifyOnStartup } from './transport.js';
import { redis } from '../services/redis.js';

let queue;
let worker;
let producerConnection;
let workerConnection;
let transporter;
let smtpEnv;

function encryptionKey() {
  return createHash('sha256').update(process.env.JWT_SECRET || 'rms-dev-secret-change-in-prod').digest();
}

function encryptPayload(payload) {
  const iv = randomBytes(12);
  const cipher = createCipheriv('aes-256-gcm', encryptionKey(), iv);
  const encrypted = Buffer.concat([cipher.update(JSON.stringify(payload)), cipher.final()]);
  return [iv, cipher.getAuthTag(), encrypted].map((part) => part.toString('base64url')).join('.');
}

function decryptPayload(value) {
  const [ivPart, tagPart, encryptedPart] = value.split('.');
  if (!ivPart || !tagPart || !encryptedPart) throw new Error('Invalid mail payload');
  const decipher = createDecipheriv('aes-256-gcm', encryptionKey(), Buffer.from(ivPart, 'base64url'));
  decipher.setAuthTag(Buffer.from(tagPart, 'base64url'));
  return JSON.parse(Buffer.concat([
    decipher.update(Buffer.from(encryptedPart, 'base64url')),
    decipher.final(),
  ]).toString('utf8'));
}

function redisConnection() {
  return new IORedis(process.env.REDIS_URL || 'redis://127.0.0.1:6379', {
    lazyConnect: true,
    maxRetriesPerRequest: null,
    enableReadyCheck: true,
  });
}

export async function startMailQueue() {
  if (queue) return;
  if (!redis.isReady) {
    logger.error('Mail queue not started because Redis is unavailable');
    return;
  }
  try {
    smtpEnv = readSmtpEnv();
    transporter = createTransport();
  } catch (error) {
    logger.error({ message: error.message }, 'SMTP mail delivery is not configured');
    return;
  }
  await verifyOnStartup(transporter, logger);

  producerConnection = redisConnection();
  workerConnection = redisConnection();
  producerConnection.on('error', (error) => logger.error({ code: error.code }, 'Mail queue Redis producer error'));
  workerConnection.on('error', (error) => logger.error({ code: error.code }, 'Mail queue Redis worker error'));
  await Promise.all([producerConnection.connect(), workerConnection.connect()]);
  queue = new Queue(mailConfig.queue.name, {
    connection: producerConnection,
    defaultJobOptions: {
      attempts: mailConfig.queue.attempts,
      backoff: mailConfig.queue.backoff,
      removeOnComplete: mailConfig.queue.removeOnComplete,
      removeOnFail: mailConfig.queue.removeOnFail,
    },
  });
  worker = new Worker(mailConfig.queue.name, deliverMail, {
    connection: workerConnection,
    concurrency: 3,
  });
  worker.on('failed', (job, error) => {
    logger.error({ jobId: job?.id, code: error.code }, 'Mail delivery failed');
  });
  worker.on('error', (error) => {
    logger.error({ code: error.code, message: error.message }, 'Mail queue worker error');
  });
}

async function redisCommand(command, ...args) {
  if (!workerConnection) throw new Error('Mail queue is not connected');
  return workerConnection[command](...args);
}

async function deliverMail(job) {
  const { idempotencyKey, encryptedPayload, type } = job.data;
  const deliveredKey = `mail:sent:${idempotencyKey}`;
  if (await redisCommand('get', deliveredKey)) return { deduplicated: true };

  const isOtp = type === 'otp';
  if (!isOtp && job.attemptsMade === 0) {
    const day = new Date().toISOString().slice(0, 10);
    const counterKey = `mail:count:${day}`;
    const countedKey = `mail:counted:${idempotencyKey}:${day}`;
    const counted = await redisCommand('set', countedKey, '1', 'EX', 172800, 'NX');
    if (counted) {
      const count = await redisCommand('incr', counterKey);
      if (count === 1) await redisCommand('expire', counterKey, 172800);
      if (count >= mailConfig.limits.dailyWarn) {
        logger.warn({ count }, 'Daily mail volume reached warning threshold');
      }
      if (count > mailConfig.limits.dailyLimit) {
        const tomorrow = new Date();
        tomorrow.setUTCDate(tomorrow.getUTCDate() + 1);
        tomorrow.setUTCHours(0, 0, 0, 0);
        await job.moveToDelayed(tomorrow.getTime(), job.token);
        throw new DelayedError();
      }
    }
  }

  const payload = decryptPayload(encryptedPayload);
  const message = type === 'otp' ? createOtpEmail(payload) : createWelcomeEmail(payload);
  const result = await transporter.sendMail({
    from: smtpEnv.from,
    replyTo: smtpEnv.replyTo,
    to: payload.to,
    subject: message.subject,
    text: message.text,
    html: message.html,
    headers: { 'X-Entity-Ref-ID': idempotencyKey },
  });
  await redisCommand('set', deliveredKey, '1', 'EX', 7 * 24 * 60 * 60, 'NX');
  logger.info({ jobId: job.id, providerMessageId: result.messageId || null }, 'Mail delivered');
  return { messageId: result.messageId || null };
}

export async function enqueueMail({ type, idempotencyKey, ...payload }) {
  if (!queue) throw Object.assign(new Error('SMTP mail delivery is unavailable'), { code: 'MAIL_UNAVAILABLE' });
  if (!['otp', 'welcome'].includes(type)) throw new Error('Unsupported mail type');
  const encryptedPayload = encryptPayload(payload);
  await queue.add(type, { type, idempotencyKey, encryptedPayload }, {
    jobId: idempotencyKey,
    priority: type === 'otp' ? mailConfig.queue.priority.otp : mailConfig.queue.priority.transactional,
  });
}

export async function stopMailQueue() {
  await Promise.allSettled([
    worker?.close(),
    queue?.close(),
    producerConnection?.quit(),
    workerConnection?.quit(),
    transporter?.close(),
  ]);
  queue = undefined;
  worker = undefined;
  producerConnection = undefined;
  workerConnection = undefined;
  transporter = undefined;
  smtpEnv = undefined;
}
