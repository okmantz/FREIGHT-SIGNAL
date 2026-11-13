import test from 'node:test';
import assert from 'node:assert/strict';
import { packRows, unpackRows, enabled, CloudError } from '../../js/store/cloud.js';

test('cloud accounts stay off until both config values are filled in', () => {
  assert.equal(enabled(), false);
  globalThis.__FS_CLOUD = { apiKey: 'k', databaseURL: '' }; assert.equal(enabled(), false);
  globalThis.__FS_CLOUD = { apiKey: 'k', databaseURL: 'http://insecure.example' }; assert.equal(enabled(), false);
  globalThis.__FS_CLOUD = { apiKey: 'k', databaseURL: 'https://x-default-rtdb.firebaseio.com/' }; assert.equal(enabled(), true);
  delete globalThis.__FS_CLOUD;
});

test('a list survives packing and unpacking, including an empty list', () => {
  const rows = [{ id: 'a', note: 'x'.repeat(50) }, { id: 'b', n: 2 }];
  assert.deepEqual(unpackRows(packRows(rows), 'id'), rows);
  const empty = packRows([]); assert.equal(empty.n, 1); assert.deepEqual(unpackRows(empty, 'id'), []);
});

test('a big list is split into pieces and never cuts an emoji in half', () => {
  const rows = Array.from({ length: 4000 }, (_, i) => ({ id: 'id' + i, text: '🚚 load ' + i + ' ' + 'é'.repeat(300) }));
  const node = packRows(rows);
  assert.ok(node.n >= 2, 'expected several pieces, got ' + node.n);
  for (let i = 0; i < node.n; i++) { const s = node['p' + i]; const last = s.charCodeAt(s.length - 1); assert.ok(!(last >= 0xd800 && last <= 0xdbff), 'piece ' + i + ' ends mid-emoji'); assert.ok(s.length <= 900000); }
  assert.deepEqual(unpackRows(JSON.parse(JSON.stringify(node)), 'id'), rows);
});

test('a damaged or incomplete cloud copy is rejected instead of being applied', () => {
  assert.throws(() => unpackRows(null, 'id'), CloudError);
  assert.throws(() => unpackRows({ n: 2, p0: '[' }, 'id'), CloudError);
  assert.throws(() => unpackRows({ n: 1, p0: '[{"name":"no id"}]' }, 'id'), CloudError);
  assert.throws(() => unpackRows({ n: 1, p0: '{"id":1}' }, 'id'), CloudError);
});
