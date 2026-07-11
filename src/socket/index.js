/**
 * Socket.io events and namespace setup
 * Manages live customer orders and kitchen screens
 */
export function setupSockets(io) {
  io.on('connection', (socket) => {
    console.log(`🔌 Client connected: ${socket.id}`);

    // Join room based on restaurant slug to receive live tickets
    socket.on('restaurant:join', (restaurantSlug) => {
      socket.join(`restaurant:${restaurantSlug}`);
      console.log(`📡 Socket ${socket.id} joined room: restaurant:${restaurantSlug}`);
      socket.emit('joined', { room: `restaurant:${restaurantSlug}`, success: true });
    });

    // Handle incoming table orders from customers
    socket.on('order:submit', (orderData) => {
      const { restaurantSlug } = orderData;
      console.log(`📝 New order submitted for ${restaurantSlug}:`, orderData);
      
      // Broadcast this live order ticket directly to all kitchen (Chef) terminals in the restaurant room
      io.to(`restaurant:${restaurantSlug}`).emit('order:received', {
        ...orderData,
        id: `KOT-${Math.floor(100 + Math.random() * 900)}`,
        status: 'Pending',
        timestamp: new Date().toISOString()
      });
    });

    // Handle order state updates from Chefs (Kitchen) or Waiters
    socket.on('order:update_status', (updateData) => {
      const { restaurantSlug, orderId, status } = updateData;
      console.log(`🔄 Order ${orderId} updated to ${status} for ${restaurantSlug}`);
      
      // Broadcast status update back to the restaurant's operational channels and the customer
      io.to(`restaurant:${restaurantSlug}`).emit('order:status_updated', { orderId, status });
    });

    socket.on('disconnect', () => {
      console.log(`❌ Client disconnected: ${socket.id}`);
    });
  });
}
