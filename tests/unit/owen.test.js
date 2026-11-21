import test from 'node:test';
import assert from 'node:assert/strict';
import { answer, loadAdvice, TOPICS } from '../../js/core/owen.js';

test('navigation questions route to the right page', () => {
  assert.equal(answer('where is the carrier database').topic, 'carrierdb');
  assert.equal(answer('How do I post on DAT?').topic, 'dat');
  assert.equal(answer('what is auto rescue').topic, 'autorescue');
  assert.equal(answer('how do I add trucks').topic, 'trucks');
  assert.ok(answer('where is the cover log').links.some(l => l.route === 'covers'));
});
test('a stuck load question returns load-aware steps', () => {
  const loads = [{ id: 'a', title: 'PA to VA', ageMin: 240, inquiries: 0, matches: 0, hard: true, targetRate: 1500, postings: 1, rescue: '', stuckScore: 5 }];
  const r = answer('this load is stuck what would owen do', { loads });
  assert.equal(r.topic, 'stuck'); assert.ok(r.steps.length >= 3); assert.ok(r.act.some(a => a.id === 'auto-rescue'));
});
test('advice changes with the situation', () => {
  const base = { title: 'X to Y', ageMin: 30, inquiries: 1, matches: 2, targetRate: 1000, postings: 9, contacted: 4, rescue: 'active' };
  const a = loadAdvice(base); assert.ok(a.steps.some(s => /already matched/.test(s))); assert.ok(a.steps.some(s => /already working/.test(s)));
  const b = loadAdvice({ ...base, matches: 0, postings: 1, rescue: '', ageMin: 300, inquiries: 0, memRate: 1300 }); assert.ok(b.steps.some(s => /matrix/.test(s))); assert.ok(b.steps.some(s => /below what has covered/.test(s)));
});
test('small talk and off-topic are handled politely, unknown asks for rephrasing', () => {
  assert.equal(answer('hello').topic, 'social'); assert.equal(answer('thanks!').topic, 'social');
  assert.equal(answer("what's the weather").topic, 'offtopic'); assert.equal(answer('qwertyuiop').topic, 'unknown'); assert.equal(answer('').topic, 'empty');
});
test('every topic that links somewhere links to a real tab id', async () => {
  const ids = new Set(['home', 'board', 'coverdesk', 'covers', 'spare', 'carriers', 'customers', 'inquiry', 'drafts', 'team', 'trucks', 'rescue', 'lanes', 'channels', 'zipmap', 'manual', 'system', 'account']);
  for (const t of TOPICS) for (const l of t.links || []) assert.ok(ids.has(l.route), t.id + ' -> ' + l.route);
});
