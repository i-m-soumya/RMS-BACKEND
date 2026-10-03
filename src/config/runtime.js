export function parseCorsOrigins(rawOrigins) {
  if (!rawOrigins || typeof rawOrigins !== 'string') {
    return true;
  }

  const normalized = rawOrigins
    .split(',')
    .map((value) => value.trim())
    .filter(Boolean);

  if (normalized.length === 0) {
    return true;
  }

  return normalized;
}

export function getJwtSecret() {
  const configuredSecret = process.env.JWT_SECRET?.trim();

  if (configuredSecret) {
    return configuredSecret;
  }

  if (process.env.NODE_ENV === 'production') {
    return null;
  }

  return 'rms-dev-secret-change-in-prod';
}

export function assertProductionEnv() {
  if (process.env.NODE_ENV !== 'production') {
    return;
  }

  const missing = [];

  if (!process.env.JWT_SECRET?.trim()) {
    missing.push('JWT_SECRET');
  }

  if (!process.env.REDIS_URL?.trim()) {
    missing.push('REDIS_URL');
  }

  if (!process.env.DATABASE_URL?.trim()) {
    if (!process.env.DB_HOST?.trim()) missing.push('DB_HOST or DATABASE_URL');
    if (!process.env.DB_NAME?.trim()) missing.push('DB_NAME');
    if (!process.env.DB_USER?.trim()) missing.push('DB_USER');
    if (process.env.DB_PASSWORD === undefined || !String(process.env.DB_PASSWORD).trim()) missing.push('DB_PASSWORD');
  }

  if (missing.length > 0) {
    const error = new Error(`Missing required production environment variables: ${missing.join(', ')}`);
    error.missing = missing;
    throw error;
  }
}

export async function resolveRuntimeHealth({ dbPing, redisPing } = {}) {
  if (!dbPing || !redisPing) {
    return { ok: false };
  }

  try {
    await dbPing();
    await redisPing();
    return { ok: true };
  } catch {
    return { ok: false };
  }
}
