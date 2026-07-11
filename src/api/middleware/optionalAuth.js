import jwt from 'jsonwebtoken';

export const optionalAuth = (req, _res, next) => {
  const authHeader = req.headers['authorization'];
  const token = authHeader && authHeader.split(' ')[1];

  if (!token) {
    req.user = null;
    return next();
  }

  jwt.verify(token, process.env.JWT_SECRET || 'rms-dev-secret-change-in-prod', (err, user) => {
    req.user = err ? null : user;
    next();
  });
};
