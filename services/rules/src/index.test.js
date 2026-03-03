import test from 'node:test';
import assert from 'node:assert/strict';
import { evaluateRules, runRuleTests } from './index.js';

const rules = [
  { path: '/todos', auth: 'required', ownerField: 'ownerId', validation: { title: { required: true, type: 'string', maxLength: 120 } } }
];

test('allows valid owner write', () => {
  const result = evaluateRules({
    rules,
    request: { path: '/todos/1', method: 'create', auth: { uid: 'u1' }, data: { title: 'hello', ownerId: 'u1' } }
  });
  assert.equal(result.allow, true);
});

test('denies unauthenticated write', () => {
  const result = evaluateRules({ rules, request: { path: '/todos/1', method: 'create', data: { title: 'a' } } });
  assert.equal(result.allow, false);
});

test('test runner reports pass/fail', () => {
  const results = runRuleTests({
    rules,
    tests: [
      { name: 'allow create', request: { path: '/todos/1', method: 'create', auth: { uid: 'u1' }, data: { title: 'x', ownerId: 'u1' } }, expectAllow: true },
      { name: 'deny title too long', request: { path: '/todos/2', method: 'create', auth: { uid: 'u1' }, data: { title: 'x'.repeat(121), ownerId: 'u1' } }, expectAllow: false }
    ]
  });
  assert.equal(results.every((r) => r.passed), true);
});
