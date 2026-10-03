import assert from 'node:assert/strict';
import test from 'node:test';
import { buildKitchenQueueResponse, getKitchenOrderNotes } from '../services/kitchenQueue.js';

test('getKitchenOrderNotes tolerates the schema where order-level notes do not exist', () => {
  assert.equal(getKitchenOrderNotes({}), null);
  assert.equal(getKitchenOrderNotes({ order_notes: 'Hold the sauce' }), 'Hold the sauce');
  assert.equal(getKitchenOrderNotes({ notes: 'Add a straw' }), 'Add a straw');
});

test('buildKitchenQueueResponse groups active orders by table and status in chronological order', () => {
  const input = [
    {
      order_id: 'o-2',
      table_number: 5,
      status: 'preparing',
      created_at: '2026-08-30T18:10:00Z',
      notes: 'Extra napkins',
      items: [
        { name: 'Burger', quantity: 2, notes: 'No onion' },
        { name: 'Fries', quantity: 1, notes: null }
      ]
    },
    {
      order_id: 'o-1',
      table_number: 5,
      status: 'confirmed',
      created_at: '2026-08-30T18:00:00Z',
      notes: null,
      items: [
        { name: 'Burger', quantity: 1, notes: 'Medium rare' }
      ]
    },
    {
      order_id: 'o-3',
      table_number: 7,
      status: 'ready',
      created_at: '2026-08-30T18:05:00Z',
      notes: 'Plating',
      items: [
        { name: 'Pizza', quantity: 1, notes: null }
      ]
    },
    {
      order_id: 'o-4',
      table_number: 7,
      status: 'cancelled',
      created_at: '2026-08-30T18:15:00Z',
      notes: null,
      items: []
    }
  ];

  const result = buildKitchenQueueResponse(input);

  assert.deepEqual(result, [
    {
      order_id: 'o-1',
      table_number: 5,
      status: 'confirmed',
      created_at: '2026-08-30T18:00:00Z',
      notes: null,
      items: [{ name: 'Burger', quantity: 1, notes: 'Medium rare' }]
    },
    {
      order_id: 'o-3',
      table_number: 7,
      status: 'ready',
      created_at: '2026-08-30T18:05:00Z',
      notes: 'Plating',
      items: [{ name: 'Pizza', quantity: 1, notes: null }]
    },
    {
      order_id: 'o-2',
      table_number: 5,
      status: 'preparing',
      created_at: '2026-08-30T18:10:00Z',
      notes: 'Extra napkins',
      items: [
        { name: 'Burger', quantity: 2, notes: 'No onion' },
        { name: 'Fries', quantity: 1, notes: null }
      ]
    }
  ]);
});
