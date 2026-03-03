const test = require('node:test');
const assert = require('node:assert/strict');
const { RulesEngine } = require('../rules/engine');
const { parse } = require('../rules/parser');
const { RulesSyntaxError, RulesEvalError } = require('../rules/errors');
const { Subscriptions } = require('../realtime/subscriptions');
const { EventEmitter } = require('events');

const SOURCE = `
rules_version = '1';
match /databases/{db}/documents {
  match /users/{userId} {
    allow read: if request.auth.uid == userId;
    allow write: if request.auth.role == "admin";
  }
  match /posts/{postId} {
    allow read: if resource.data.owner == request.auth.uid;
    allow create: if request.auth.uid != null;
    allow update: if request.auth.uid == resource.oldData.owner;
    allow delete: if request.auth.role == "admin";
  }
}
`;

const ctxUser1 = { request: { auth: { uid: 'u1', role: 'user' }, ip: '127.0.0.1', time: 1 } };
const ctxAdmin = { request: { auth: { uid: 'a1', role: 'admin' }, ip: '127.0.0.1', time: 1 } };

test('simple allow and deny', () => {
  const e = new RulesEngine(SOURCE);
  assert.equal(e.canRead(ctxUser1, '/users/u1', { id: 'u1' }), true);
  assert.equal(e.canRead(ctxUser1, '/users/u2', { id: 'u2' }), false);
});

test('path param extraction and nested precedence', () => {
  const src = `rules_version = '1';
  match /databases/{db}/documents {
    match /users/{userId} { allow read: if false; }
    match /users/special { allow read: if true; }
  }`;
  const e = new RulesEngine(src);
  assert.equal(e.canRead(ctxUser1, '/users/special', { id: 'special' }), true);
  assert.equal(e.canRead(ctxUser1, '/users/other', { id: 'other' }), false);
});

test('create update delete checks', () => {
  const e = new RulesEngine(SOURCE);
  assert.equal(e.canCreate(ctxUser1, '/posts/p1', { owner: 'u1' }), true);
  assert.equal(e.canUpdate(ctxUser1, '/posts/p1', { owner: 'u1' }, { owner: 'u1' }), true);
  assert.equal(e.canUpdate(ctxUser1, '/posts/p1', { owner: 'u2' }, { owner: 'u2' }), false);
  assert.equal(e.canDelete(ctxUser1, '/posts/p1', { owner: 'u1' }), false);
  assert.equal(e.canDelete(ctxAdmin, '/posts/p1', { owner: 'u1' }), true);
});

test('query filtering and explain fields', () => {
  const e = new RulesEngine(SOURCE);
  const docs = Array.from({ length: 100 }, (_, i) => ({ id: `p${i}`, owner: i % 2 ? 'u1' : 'u2' }));
  const out = e.filterQueryResults(ctxUser1, '/posts', docs, { limit: 20 });
  assert.equal(out.docs.length, 20);
  assert.ok(out.ruleFilteredCount >= 0);
  assert.equal(out.overfetchFactor, 3);
});

test('syntax error detection', () => {
  assert.throws(() => parse("rules_version = '1'; match /x { allow read: if ; }"), RulesSyntaxError);
});

test('invalid operator rejection', () => {
  assert.throws(() => parse("rules_version = '1'; match /databases/{db}/documents { match /x/{id} { allow read: if request.auth.uid + 1 == 2; } }"), RulesSyntaxError);
});

test('performance 1000 doc filter', () => {
  const e = new RulesEngine(SOURCE);
  const docs = Array.from({ length: 1000 }, (_, i) => ({ id: `${i}`, owner: i % 3 === 0 ? 'u1' : 'u2' }));
  const t0 = Date.now();
  const out = e.filterQueryResults(ctxUser1, '/posts', docs, { limit: 300, overfetchFactor: 4 });
  const dt = Date.now() - t0;
  assert.ok(out.docs.length > 0);
  assert.ok(dt < 200);
});

test('realtime event skip using rules engine', () => {
  const e = new RulesEngine(SOURCE);
  const events = [];
  const docdb = { events: new EventEmitter(), collection: () => ({ doc: () => ({ get: () => ({ id: 'p1', owner: 'u2' }) }) }) };
  const subs = new Subscriptions({ docdb, sendEvent: (_c, _id, _t, d) => events.push(d), metrics: { ws_subscriptions_active: 0 }, rulesEngine: e });
  const conn = { id: 'c1', auth: { sub: 'u1' } };
  const subId = subs.subscribe(conn, { subType: 'docdb.doc', topic: { collection: 'posts', docId: 'p1' } });
  assert.ok(subId);
  assert.equal(events.length, 0);
  docdb.events.emit('docdb:change', { collection: 'posts', docId: 'p1', type: 'update', newDoc: { id: 'p1', owner: 'u1' } });
  assert.equal(events.length, 1);
});


test('write validation deterministic envelope', () => {
  const e = new RulesEngine(SOURCE);
  assert.throws(() => e.enforceDelete(ctxUser1, '/posts/p1', { owner: 'u1' }), (err) => {
    assert.equal(err.message, 'PERMISSION_DENIED');
    assert.equal(err.payload.error.code, 'PERMISSION_DENIED');
    return true;
  });
});
