import express from 'express';
import { createServer } from 'http';
import { Server } from 'socket.io';
import cors from 'cors';
import helmet from 'helmet';
import morgan from 'morgan';
import dotenv from 'dotenv';
import path from 'path';
import { fileURLToPath } from 'url';

import { logger } from './src/config/logger.js';
import { assertProductionEnv, parseCorsOrigins } from './src/config/runtime.js';
import db, { checkDbHealth } from './src/db/connection.js';
import { redis, connectRedis, closeRedis } from './src/services/redis.js';
import { setupSockets } from './src/socket/index.js';
import { errorHandler } from './src/api/middleware/errorHandler.js';
import { notFoundHandler } from './src/api/middleware/notFound.js';
import { assignRequestId } from './src/api/middleware/requestContext.js';
import { globalLimiter } from './src/api/middleware/rateLimit.js';

// Routes
import authRoutes from './src/api/routes/auth.js';
import restaurantRoutes from './src/api/routes/restaurants.js';
import sessionRoutes from './src/api/routes/sessions.js';
import waiterRoutes from './src/api/routes/waiter.js';
import orderRoutes from './src/api/routes/orders.js';
import billRoutes from './src/api/routes/bills.js';
import customerRoutes from './src/api/routes/customers.js';
import adminRoutes from './src/api/routes/admin.js';
import notificationsRoutes from './src/api/routes/notifications.js';
import platformRoutes from './src/api/routes/platform.js';
import kitchenRoutes from './src/api/routes/kitchen.js';
import publicMarketingRoutes from './src/api/routes/publicMarketing.js';

dotenv.config();
assertProductionEnv();

const app = express();
const uploadsDirectory = path.resolve(path.dirname(fileURLToPath(import.meta.url)), 'uploads');
app.use('/uploads', express.static(uploadsDirectory));
const httpServer = createServer(app);
app.set('trust proxy', 2);

const allowedCorsOrigins = parseCorsOrigins(process.env.CORS_ORIGINS || process.env.CORS_ORIGIN);
const socketCorsOrigins = allowedCorsOrigins === true ? true : allowedCorsOrigins;

const io = new Server(httpServer, {
  cors: {
    origin: socketCorsOrigins,
    credentials: true,
    methods: ['GET', 'POST']
  },
  transports: ['websocket'],
  pingInterval: 25000,
  pingTimeout: 20000
});

app.use(helmet());
app.use(assignRequestId);
app.use(cors({
  origin: allowedCorsOrigins === true ? true : allowedCorsOrigins,
  credentials: true
}));
app.use(morgan((tokens, req, res) => {
  logger.info({
    method: tokens.method(req, res),
    url: tokens.url(req, res),
    statusCode: Number(tokens.status(req, res) || 0),
    responseTimeMs: Number(tokens['response-time'](req, res) || 0),
    requestId: req.requestId
  }, 'http_request');
  return '';
}));
app.use(globalLimiter);
app.use(express.json({ limit: '1mb' }));
app.use(express.urlencoded({ extended: false, limit: '1mb' }));

app.get('/healthz', async (_req, res) => {
  try {
    await db.raw('SELECT 1');
    await redis.ping();
    return res.status(200).json({ ok: true });
  } catch (error) {
    logger.warn({ err: error.message }, 'Health check failed');
    return res.status(503).json({ ok: false });
  }
});

app.get('/api/health', async (req, res) => {
  const dbHealth = await checkDbHealth();
  const redisUp = await redis.ping().then(() => true).catch(() => false);
  const isHealthy = dbHealth.ok && redisUp;

  res.status(isHealthy ? 200 : 503).json({
    status: isHealthy ? 'healthy' : 'unhealthy',
    timestamp: new Date().toISOString(),
    uptime: process.uptime(),
    service: 'RMS API & Socket Server',
    database: {
      status: dbHealth.status,
      ...(dbHealth.host && { host: dbHealth.host }),
      ...(dbHealth.database && { database: dbHealth.database }),
      ...(!dbHealth.ok && {
        code: dbHealth.code,
        message: dbHealth.message
      })
    },
    redis: { status: redisUp ? 'up' : 'down' }
  });
});

app.use('/api/auth', authRoutes);
app.use('/api/restaurants', restaurantRoutes);
app.use('/api/sessions', sessionRoutes);
app.use('/api/console/waiter', waiterRoutes);
app.use('/api/orders', orderRoutes);
app.use('/api/bills', billRoutes);
app.use('/api/customers', customerRoutes);
app.use('/api/admin', adminRoutes);
app.use('/api', notificationsRoutes);
app.use('/api/platform', platformRoutes);
app.use('/api/kitchen', kitchenRoutes);
app.use('/api/public', publicMarketingRoutes);

app.use(notFoundHandler);
app.use(errorHandler);
setupSockets(io);

await connectRedis().catch((error) => {
  logger.warn({ err: error.message }, 'Redis connection unavailable during startup');
});

const startupDbHealth = await checkDbHealth();
if (!startupDbHealth.ok) {
  logger.warn({
    code: startupDbHealth.code,
    message: startupDbHealth.message
  }, 'Database health check failed during startup');
}

const PORT = Number(process.env.PORT || 3000);
let shutdownInProgress = false;

async function gracefulShutdown(signal) {
  if (shutdownInProgress) {
    return;
  }

  shutdownInProgress = true;
  logger.warn({ signal }, 'Shutdown signal received');

  const timeoutHandle = setTimeout(() => {
    logger.error('Graceful shutdown timed out; forcing process exit');
    process.exit(1);
  }, 9000);

  try {
    await Promise.allSettled([
      new Promise((resolve, reject) => {
        if (!httpServer.listening) {
          resolve();
          return;
        }

        httpServer.close((error) => {
          if (error) {
            reject(error);
            return;
          }

          resolve();
        });
      }),
      io.close(),
      db.destroy(),
      closeRedis()
    ]);

    logger.info('Graceful shutdown complete');
    process.exit(0);
  } catch (error) {
    logger.error({ err: error.message }, 'Graceful shutdown failed');
    process.exit(1);
  } finally {
    clearTimeout(timeoutHandle);
  }
}

process.on('SIGTERM', () => {
  void gracefulShutdown('SIGTERM');
});

process.on('SIGINT', () => {
  void gracefulShutdown('SIGINT');
});

httpServer.listen(PORT, '0.0.0.0', () => {
  logger.info({ port: PORT, environment: process.env.NODE_ENV || 'development' }, 'RMS API & Socket Server running');
});
