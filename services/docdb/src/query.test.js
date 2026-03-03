import test from 'node:test';
import assert from 'node:assert/strict';
import { buildStructuredQuery } from './query.js';

test('buildStructuredQuery normalizes defaults', () => {
  const q = buildStructuredQuery({ collection: 'todos' });
  assert.equal(q.orderBy, 'updated_at');
  assert.equal(q.direction, 'DESC');
  assert.equal(q.limit, 20);
});

test('buildStructuredQuery rejects invalid operator', () => {
  assert.throws(() => buildStructuredQuery({
    collection: 'todos',
    where: [{ field: 'title', op: '>', value: 'x' }]
  }), /invalid_filter_op/);
});
