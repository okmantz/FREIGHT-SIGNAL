import test from 'node:test';
import assert from 'node:assert/strict';
import { blankPosting } from '../../js/core/model.js';
import { DAT_COLUMNS } from '../../js/core/defaults.js';
import { datRow, datCsv } from '../../js/core/dat.js';
import { isEmail, normEmail, passwordProblem, makeAccount, checkPassword } from '../../js/store/auth.js';

const rateIdx = DAT_COLUMNS.findIndex(c => c.key === 'datRate');
const mk = (o) => blankPosting({ originCity: 'Chicago', originState: 'IL', destCity: 'Atlanta', destState: 'GA', pickupEarliest: '11/16/2026', pickupLatest: '11/16/2026', weight: '38000', equip: 'V', ...o });

test('target rate is posted as the DAT rate only when asked (targetAsRate)', () => {
  const p = mk({ targetRate: '1800' });
  assert.equal(datRow(p)[rateIdx], '');
  assert.equal(datRow(p, { targetAsRate: true })[rateIdx], '1800');
});

test('a per-posting DAT rate override wins over the target rate', () => {
  const p = mk({ targetRate: '1800', datRate: '2100' });
  assert.equal(datRow(p, { targetAsRate: true })[rateIdx], '2100');
  assert.ok(datCsv([p], { targetAsRate: true }).includes('2100'));
});

test('e-mail and password rules', () => {
  assert.ok(isEmail('a@b.co')); assert.ok(!isEmail('nope')); assert.equal(normEmail('  Owen@Example.COM '), 'owen@example.com');
  assert.ok(passwordProblem('short')); assert.equal(passwordProblem('long enough pw'), '');
});

test('account passwords are hashed and verified, never stored in plain text', async () => {
  const a = await makeAccount('Owen@Example.com', 'correct horse 42');
  assert.equal(a.email, 'owen@example.com');
  assert.ok(!JSON.stringify(a).includes('correct horse'));
  assert.equal(await checkPassword(a, 'correct horse 42'), true);
  assert.equal(await checkPassword(a, 'wrong password'), false);
});
