export const requireRoles = (rolesArray) => {
  return (req, res, next) => {
    if (!req.user || !req.user.role) {
      return res.status(401).json({ error: 'Unauthorized' });
    }
    
    if (!rolesArray.includes(req.user.role)) {
      return res.status(403).json({ error: 'Forbidden: Insufficient privileges' });
    }
    
    next();
  };
};

export const verifyRestaurantAccess = (req, res, next) => {
  // Platform admins can access everything
  if (req.user.role === 'platform_admin') {
    return next();
  }

  const requestedRestaurantId = req.params.restaurantId || req.body.restaurantId;
  
  if (req.user.restaurantId !== requestedRestaurantId) {
    return res.status(403).json({ error: 'Forbidden: Cannot access other restaurant data' });
  }

  next();
};
