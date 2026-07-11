import db from './connection.js';

const cache = new Map();

export async function getTableColumns(tableName) {
  if (cache.has(tableName)) {
    return cache.get(tableName);
  }

  const [rows] = await db.raw('SHOW COLUMNS FROM ??', [tableName]);
  const columns = new Set(rows.map((r) => r.Field));
  cache.set(tableName, columns);
  return columns;
}

export async function insertUsingKnownColumns(tableName, data) {
  const columns = await getTableColumns(tableName);
  const payload = {};

  Object.entries(data).forEach(([key, value]) => {
    if (columns.has(key) && value !== undefined) {
      payload[key] = value;
    }
  });

  return db(tableName).insert(payload);
}
