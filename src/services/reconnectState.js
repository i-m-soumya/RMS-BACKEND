export function buildSinceCursor(rawSince) {
  if (rawSince === null || rawSince === undefined || rawSince === '') {
    return null;
  }

  const value = String(rawSince).trim();
  if (!value) {
    return null;
  }

  const asDate = new Date(value);
  if (!Number.isNaN(asDate.getTime())) {
    return { kind: 'date', value: asDate.toISOString() };
  }

  return null;
}

export function applySinceFilter(rows = [], sinceCursor) {
  if (!sinceCursor || !sinceCursor.value) {
    return rows;
  }

  const threshold = new Date(sinceCursor.value);
  if (Number.isNaN(threshold.getTime())) {
    return rows;
  }

  return rows.filter((row) => {
    const updatedAt = new Date(row.updated_at || row.created_at || 0);
    return !Number.isNaN(updatedAt.getTime()) && updatedAt > threshold;
  });
}
