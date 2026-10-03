import assert from 'node:assert/strict';
import test from 'node:test';
import notificationsRoutes from '../api/routes/notifications.js';

test('notifications router is exported and registers the expected endpoints', () => {
  assert.ok(notificationsRoutes);
  const routePaths = notificationsRoutes.stack
    .filter((layer) => layer.route)
    .map((layer) => `${layer.route.stack[0].method.toUpperCase()} ${layer.route.path}`);

  assert.ok(routePaths.some((path) => path === 'GET /notifications'));
  assert.ok(routePaths.some((path) => path === 'PATCH /notifications/read-all'));
  assert.ok(routePaths.some((path) => path === 'PATCH /notifications/:id/read'));
  assert.ok(routePaths.some((path) => path === 'GET /notifications/unread-count'));
});
