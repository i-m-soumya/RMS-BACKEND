export function roleRoomName(restaurantId, role) {
  if (!restaurantId || !role) return null;
  if (role === 'waiter') return `restaurant:${restaurantId}:waiters`;
  if (role === 'chef') return `restaurant:${restaurantId}:chefs`;
  return `restaurant:${restaurantId}`;
}

export function buildSocketTargetRooms({ restaurantId, staffId, role }) {
  const rooms = new Set();

  if (restaurantId) {
    rooms.add(`restaurant:${restaurantId}`);
  }

  const roleRoom = roleRoomName(restaurantId, role);
  if (roleRoom) {
    rooms.add(roleRoom);
  }

  if (staffId) {
    rooms.add(`staff:${staffId}`);
  }

  return rooms;
}

export function resolveNotificationTargets({ restaurantId, staffId, role, eventType }) {
  const restaurantRoom = restaurantId ? `restaurant:${restaurantId}` : null;
  const personalRoom = staffId ? `staff:${staffId}` : null;

  const roleScopedEvents = new Set(['order:new', 'bill:requested', 'item:out_of_stock']);
  const roleRoom = roleScopedEvents.has(eventType) ? roleRoomName(restaurantId, role) : null;

  return {
    restaurantRoom,
    roleRoom,
    personalRoom,
  };
}

export function customerRoomName(customerId) {
  return customerId ? `customer:${customerId}` : null;
}

export function canJoinTenantRoom({ userRestaurantId, requestedRestaurantId }) {
  if (!userRestaurantId || !requestedRestaurantId) {
    return false;
  }

  return userRestaurantId === requestedRestaurantId;
}
