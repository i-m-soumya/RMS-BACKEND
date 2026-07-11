import knex from 'knex';
import dotenv from 'dotenv';
dotenv.config();

function getSslConfig() {
  return process.env.DB_SSL === 'true' ? { rejectUnauthorized: false } : false;
}

export function buildConnectionConfig() {
  if (process.env.DATABASE_URL) {
    const databaseUrl = new URL(process.env.DATABASE_URL);

    return {
      host: databaseUrl.hostname,
      port: Number(databaseUrl.port || 3306),
      user: decodeURIComponent(databaseUrl.username),
      password: decodeURIComponent(databaseUrl.password),
      database: databaseUrl.pathname.replace(/^\//, ''),
      ssl: getSslConfig()
    };
  }

  return {
    host: process.env.DB_HOST,
    port: Number(process.env.DB_PORT || 3306),
    user: process.env.DB_USER,
    password: process.env.DB_PASSWORD,
    database: process.env.DB_NAME,
    ssl: getSslConfig()
  };
}

export async function validateDbConnection() {
  const connection = buildConnectionConfig();

  if (!connection.host) {
    const error = new Error('Database host is not configured. Set DATABASE_URL or DB_HOST.');
    error.code = 'DB_CONFIG_MISSING';
    throw error;
  }

  try {
    await db.raw('SELECT 1');
  } catch (error) {
    if (error.code === 'ENOTFOUND') {
      const host = connection.host;
      const wrappedError = new Error(`Database host \"${host}\" could not be resolved. Check Railway environment variables for DATABASE_URL or DB_HOST.`);
      wrappedError.code = 'DB_HOST_UNRESOLVABLE';
      wrappedError.cause = error;
      throw wrappedError;
    }

    throw error;
  }
}

const db = knex({
  client: 'mysql2',
  connection: buildConnectionConfig(),
  pool: { min: 0, max: 10 }
});

export default db;
