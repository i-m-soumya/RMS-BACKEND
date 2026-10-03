/**
 * Socket.io events and namespace setup
 * Manages authenticated real-time tenant-scoped notifications and operational events.
 */
import jwt from 'jsonwebtoken';
import db from '../db/connection.js';
import { logger } from '../config/logger.js';
import { getJwtSecret } from '../config/runtime.js';
import { canJoinTenantRoom, buildSocketTargetRooms, customerRoomName } from './notificationRooms.js';

let socketServer;

export function getSocketUserFromToken(token, secretOverride = getJwtSecret()) {
  if (!token) return null;

  const normalizedToken = String(token).replace(/^Bearer\s+/i, '');
  if (!normalizedToken || !secretOverride) return null;

  try {
    return jwt.verify(normalizedToken, secretOverride);
  } catch {
    return null;
  }
}

export function resolveSocketRestaurantId({ verifiedUser, clientRestaurantId }) {
  const trustedRestaurantId = verifiedUser?.restaurantId ?? verifiedUser?.restaurant_id;

  if (!trustedRestaurantId) {
    return null;
  }

  return String(trustedRestaurantId);
}

export function setupSockets(io) {
  globalThis.__rmsSocketServer = io;
  socketServer = io;

  io.use(async (socket, next) => {
    const token = socket.handshake.auth?.token || socket.handshake.headers?.authorization;
    const verifiedUser = getSocketUserFromToken(token, getJwtSecret());
    const clientRestaurantId = socket.handshake.auth?.restaurant_id ?? socket.handshake.query?.restaurant_id ?? socket.handshake.headers?.['x-restaurant-id'];
    const restaurantId = resolveSocketRestaurantId({ verifiedUser, clientRestaurantId });

    if (!verifiedUser || !verifiedUser.id || !verifiedUser.role || !restaurantId) {
      return next(new Error('unauthorized'));
    }

    socket.user = verifiedUser;
    socket.userRestaurantId = restaurantId;
    socket.restaurantId = restaurantId;
    next();
  });

  io.on('connection', (socket) => {
    logger.info({ socketId: socket.id, role: socket.user?.role, restaurantId: socket.userRestaurantId }, 'Socket client connected');

    const restaurantId = socket.user?.restaurantId || socket.userRestaurantId;
    const staffId = socket.user?.id;
    const role = socket.user?.role;

    if (!restaurantId || !staffId || !role) {
      socket.disconnect(true);
      return;
    }

    const targetRooms = buildSocketTargetRooms({ restaurantId, staffId, role });
    for (const room of targetRooms) {
      socket.join(room);
    }
    if (role === 'customer') socket.join(customerRoomName(staffId));

    socket.on('restaurant:join', (requestedRestaurantId) => {
      const verifiedRestaurantId = resolveSocketRestaurantId({ verifiedUser: socket.user, clientRestaurantId: requestedRestaurantId });
      if (!verifiedRestaurantId || String(requestedRestaurantId) !== String(verifiedRestaurantId)) {
        socket.emit('room:error', { code: 'TENANT_ROOM_MISMATCH', message: 'Cannot join a different restaurant room.' });
        return;
      }

      const room = `restaurant:${verifiedRestaurantId}`;
      if (!socket.rooms.has(room)) {
        socket.join(room);
      }
      socket.emit('joined', { room, success: true });
    });

    socket.on('order:submit', async (orderData) => {
      const { restaurantSlug } = orderData;
      logger.info({ restaurantSlug, socketId: socket.id }, 'Order submitted');
      io.to(`restaurant:${restaurantSlug}`).emit('order:received', {
        ...orderData,
        id: `KOT-${Math.floor(100 + Math.random() * 900)}`,
        status: 'Pending',
        timestamp: new Date().toISOString()
      });
    });

    socket.on('order:update_status', (updateData) => {
      const { restaurantSlug, orderId, status } = updateData;
      logger.info({ restaurantSlug, orderId, status }, 'Order status updated');
      io.to(`restaurant:${restaurantSlug}`).emit('order:status_updated', { orderId, status });
    });

    socket.on('notification:read', async ({ notificationId }) => {
      if (!notificationId) return;
      const usesLegacyColumns = Boolean((await db('notifications').columnInfo()).staff_id);
      await db('notifications')
        .where({ id: notificationId, restaurant_id: restaurantId, [usesLegacyColumns ? 'staff_id' : 'recipient_staff_id']: staffId })
        .update({ is_read: 1, read_at: new Date(), updated_at: new Date() });
    });

    socket.on('disconnect', () => {
      logger.info({ socketId: socket.id }, 'Socket client disconnected');
    });
  });
}

export function broadcastTablesChanged(restaurantSlug) {
  if (restaurantSlug) {
    socketServer?.to(`restaurant:${restaurantSlug}`).emit('restaurant:tables_changed');
  }
}

export function broadcastKitchenOrderCreated(restaurantSlug, payload = {}) {
  if (!restaurantSlug || !socketServer) return;
  socketServer.to(`restaurant:${restaurantSlug}`).emit('order:received', payload);
}

export function broadcastOrderStatusChanged(restaurantSlug, payload = {}) {
  if (!restaurantSlug || !socketServer) return;
  socketServer.to(`restaurant:${restaurantSlug}`).emit('order.status_changed', payload);
}

export function broadcastOrderRejected(restaurantSlug, payload = {}) {
  if (!restaurantSlug || !socketServer) return;
  socketServer.to(`restaurant:${restaurantSlug}`).emit('order:rejected', payload);
  if (payload.customer_id) socketServer.to(`customer:${payload.customer_id}`).emit('order:rejected', payload);
}

export function broadcastItemOutOfStock(restaurantSlug, payload = {}) {
  if (!restaurantSlug || !socketServer) return;
  socketServer.to(`restaurant:${restaurantSlug}`).emit('item:out_of_stock', payload);
  if (payload.customer_id) socketServer.to(`customer:${payload.customer_id}`).emit('item:out_of_stock', payload);
}
