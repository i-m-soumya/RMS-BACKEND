import jwt from 'jsonwebtoken';

export const authenticateToken = (req, res, next) => {
  const authHeader = req.headers['authorization'];
  const token = authHeader && authHeader.split(' ')[1];

  if (!token) {
    return res.status(401).json({ error: 'Access token missing or invalid' });
  }

  if (!process.env.JWT_SECRET && process.env.NODE_ENV === 'production') {
    return res.status(500).json({ error: 'Server JWT configuration is missing' });
  }

  jwt.verify(token, process.env.JWT_SECRET || 'rms-dev-secret-change-in-prod', (err, user) => {
    if (err) {
      return res.status(403).json({ error: 'Token expired or invalid' });
    }
    req.user = user;
    next();
  });
};
