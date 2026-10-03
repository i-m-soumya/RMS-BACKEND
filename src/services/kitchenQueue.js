const ACTIVE_KITCHEN_STATUSES = new Set(['confirmed', 'preparing', 'ready']);

export function getKitchenOrderNotes(row = {}) {
  return row.notes ?? row.order_notes ?? null;
}

export function buildKitchenQueueResponse(rows = []) {
  return rows
    .filter((row) => row && ACTIVE_KITCHEN_STATUSES.has(String(row.status || '').toLowerCase()))
    .sort((left, right) => new Date(left.created_at || 0) - new Date(right.created_at || 0))
    .map((row) => ({
      order_id: row.order_id,
      table_number: Number(row.table_number ?? row.tableNumber ?? 0),
      status: String(row.status || '').toLowerCase(),
      created_at: row.created_at,
      notes: getKitchenOrderNotes(row),
      items: (row.items || []).map((item) => ({
        name: item.name || 'Item',
        quantity: Number(item.quantity ?? item.qty ?? 1),
        notes: item.notes ?? null,
      })),
    }));
}

export { ACTIVE_KITCHEN_STATUSES };
