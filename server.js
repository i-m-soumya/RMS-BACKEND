import express from 'express';
import { createServer } from 'http';
import { Server } from 'socket.io';
import cors from 'cors';
import helmet from 'helmet';
import morgan from 'morgan';
import dotenv from 'dotenv';
import { setupSockets } from './src/socket/index.js';
import { validateDbConnection } from './src/db/connection.js';
import { errorHandler } from './src/api/middleware/errorHandler.js';
import { notFoundHandler } from './src/api/middleware/notFound.js';
import { assignRequestId } from './src/api/middleware/requestContext.js';
import { globalLimiter } from './src/api/middleware/rateLimit.js';

// Routes
import authRoutes from './src/api/routes/auth.js';
import restaurantRoutes from './src/api/routes/restaurants.js';
import sessionRoutes from './src/api/routes/sessions.js';
import orderRoutes from './src/api/routes/orders.js';
import billRoutes from './src/api/routes/bills.js';
import customerRoutes from './src/api/routes/customers.js';
import adminRoutes from './src/api/routes/admin.js';
import platformRoutes from './src/api/routes/platform.js';

// Load environmental variables
dotenv.config();

const app = express();
const httpServer = createServer(app);
app.set('trust proxy', process.env.TRUST_PROXY === 'true' ? 1 : 0);

// Initialize Socket.io with global CORS allowance
const io = new Server(httpServer, {
  cors: {
    origin: process.env.CORS_ORIGIN || '*',
    methods: ['GET', 'POST']
  }
});

// Middleware configurations
app.use(helmet());
app.use(assignRequestId);
const allowedOrigins = (process.env.CORS_ORIGIN || '').split(',').map((s) => s.trim()).filter(Boolean);
app.use(cors({
  origin: allowedOrigins.length > 0 ? allowedOrigins : true,
  credentials: true
}));
app.use(morgan('dev'));
app.use(globalLimiter);
app.use(express.json({ limit: '1mb' }));
app.use(express.urlencoded({ extended: false, limit: '1mb' }));

// API Health check route
app.get('/api/health', (req, res) => {
  res.status(200).json({
    status: 'healthy',
    timestamp: new Date().toISOString(),
    uptime: process.uptime(),
    service: 'RMS API & Socket Server'
  });
});

// API Routes
app.use('/api/auth', authRoutes);
app.use('/api/restaurants', restaurantRoutes);
app.use('/api/sessions', sessionRoutes);
app.use('/api/orders', orderRoutes);
app.use('/api/bills', billRoutes);
app.use('/api/customers', customerRoutes);
app.use('/api/admin', adminRoutes);
app.use('/api/platform', platformRoutes);

app.use(notFoundHandler);

// Global Error Handler
app.use(errorHandler);

// Bind socket connection pathways
setupSockets(io);

await validateDbConnection();

// Server startup listener
const PORT = process.env.PORT || 5000;
httpServer.listen(PORT, () => {
  console.log(`🚀 RMS API & Socket Server running in ${process.env.NODE_ENV || 'development'} mode on port ${PORT}`);
});
