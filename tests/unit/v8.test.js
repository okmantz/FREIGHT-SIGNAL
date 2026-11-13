import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { analyseCarrierEmail, planCarrierReply, freshText } from '../../js/core/carrierreply.js';
import { processIncomingEmail } from '../../js/core/inbound.js';
import { configFile, outboxFile, parseDraftsDone, foldInquiryEvents } from '../../js/core/bridge.js';
import { blankPosting, initializeLoadControls } from '../../js/core/model.js';
import { DEFAULT_SETTINGS } from '../../js/core/defaults.js';
import { postedRateOf, groupStats } from '../../js/core/worklist.js';
import { repriceSuggestion, nextSteps } from '../../js/core/guidance.js';

const fx = JSON.parse(readFileSync(new URL('../fixtures/carrier-replies.json', import.meta.url), 'utf8'));
const posting = (o = {}) => { const p = blankPosting({ originCity: 'Chicago', originState: 'IL', destCity: 'Atlanta', destState: 'GA', targetRate: 1500, details: 'Pickup: Chicago, IL 60601\nDelivery: Atlanta, GA 30303', ...o }); initializeLoadControls(p); return p; };
const mail = (o) => ({ from: 'carrier@x.example', subject: 'Chicago, IL to Atlanta, GA', body: 'Is this still available?', ...o });

test('carrier-reply corpus: every sample is read correctly', () => {
  for (const c of fx.cases) {
    const a = analyseCarrierEmail(c.body, fx.own, DEFAULT_SETTINGS);
    assert.equal(a.intent, c.intent, c.name);
    if (c.rate) assert.equal(a.rate.rate, c.rate, c.name + ' (rate)');
  }
});

test('"rate?" under our quoted message asks for OUR rate: "How close", never "confirm ETA", never "ready to book"', () => {
  const p = posting(); const inq = [];
  const first = processIncomingEmail({ mail: mail(), postings: [p], inquiries: inq });
  const rec = { id: 'q1', ...first.newInquiry }; inq.push(rec);
  const quoted = 'rate?\n\nOn Tue, Nov 10, 2026 at 9:00 AM Me <me@x.example> wrote:\n> Pickup: Chicago, IL 60601\n> Delivery: Atlanta, GA 30303\n> What is your best all-in rate? ETA to pickup?\n> Weight: 42,000 lbs';
  const r = processIncomingEmail({ mail: mail({ body: quoted }), postings: [p], inquiries: inq });
  assert.equal(r.action, 'reply-asks-rate');
  assert.ok(r.draft.body.startsWith('How close can you come to $1,500?'), r.draft.body);
  assert.ok(!/confirm your ETA/i.test(r.draft.body.split('wrote:')[0]));
  assert.equal(r.inquiryPatch.patch.lastCarrierRate, undefined, 'no rate may be logged');
  assert.equal(r.autoSendSafe, true);
});

test('an e-mail with no rate never produces a quote or a "book it" state', () => {
  const p = posting(); const first = processIncomingEmail({ mail: mail(), postings: [p], inquiries: [] });
  const rec = { id: 'q1', ...first.newInquiry };
  for (const body of ['Is this still available?', 'ok', 'Pickup: Chicago, IL 60601 Weight: 42,000 lbs call 555-123-4567', 'thanks']) {
    const r = processIncomingEmail({ mail: mail({ body }), postings: [p], inquiries: [rec] });
    assert.ok(!r.inquiryPatch || !r.inquiryPatch.patch.lastCarrierRate, body);
    assert.notEqual(r.action, 'rate-within-target', body);
  }
  const stats = groupStats([p], { inquiries: [{ ...rec, postingId: p.id, lastCarrierRate: '' }], now: new Date(), zip: {}, settings: DEFAULT_SETTINGS });
  assert.equal(stats.inquiries.quotes.length, 0);
});

test('a real rate inside the band is still booked, and says who quoted', () => {
  const p = posting(); const first = processIncomingEmail({ mail: mail(), postings: [p], inquiries: [] });
  const rec = { id: 'q1', ...first.newInquiry };
  const r = processIncomingEmail({ mail: mail({ body: 'I can do $1,520 all in' }), postings: [p], inquiries: [rec] });
  assert.equal(r.action, 'rate-within-target');
  Object.assign(rec, r.inquiryPatch.patch); rec.postingId = p.id;
  const stats = groupStats([p], { inquiries: [rec], now: new Date(), zip: {}, settings: DEFAULT_SETTINGS });
  assert.equal(stats.inquiries.stage.stage, 'book');
});

test('a carrier agreeing to our counter gets the ETA request; a repeat after that goes to a person', () => {
  const p = posting(); const first = processIncomingEmail({ mail: mail(), postings: [p], inquiries: [] });
  const rec = { id: 'q1', ...first.newInquiry };
  Object.assign(rec, processIncomingEmail({ mail: mail({ body: '$1,600' }), postings: [p], inquiries: [rec] }).inquiryPatch.patch);
  assert.equal(rec.stage, 'RATE_RESPONSE_SENT');
  const ok = processIncomingEmail({ mail: mail({ body: 'ok' }), postings: [p], inquiries: [rec] });
  assert.equal(ok.action, 'reply-agreed');
  assert.match(ok.draft.body, /we are set at \$1,\d{3}\. Please confirm your ETA to pickup\./);
});

test('unclear, pushback, two rates and "call me" are never answered automatically', () => {
  const p = posting(); const first = processIncomingEmail({ mail: mail(), postings: [p], inquiries: [] });
  for (const body of ['hmm', 'too low', '$1500 but $1400 if I load Friday', 'call me 555 123 4567', '$2.50 per mile']) {
    const rec = { id: 'q1', ...first.newInquiry };
    const r = processIncomingEmail({ mail: mail({ body }), postings: [p], inquiries: [rec] });
    assert.equal(r.draft, undefined, body);
    assert.ok(r.flag, body);
  }
});

test('bridge config carries the reading rules, the new wording and BOTH send switches (default off)', () => {
  const txt = configFile(DEFAULT_SETTINGS);
  assert.match(txt, /\nautoSendInbound\t0\r?\n/); assert.match(txt, /\nautoSendOutbound\t0\r?\n/);
  assert.ok(txt.split(/\r?\n/).filter(l => l.startsWith('rule\t')).length > 30);
  assert.match(txt, /\ntplAskRate\tHow close can you come to \{target\}\?/);
  const on = configFile({ ...DEFAULT_SETTINGS, autoSendInbound: true });
  assert.match(on, /\nautoSendInbound\t1\r?\n/); assert.match(on, /\nautoSendOutbound\t0\r?\n/);
});

test('outbox marks SEND only when asked; drafts-done understands SENT; the log still reads 12-column lines', () => {
  const o = outboxFile([{ outboxId: 'a', to: 'x@y.z', subject: 's', body: 'b', send: true }, { outboxId: 'b', to: 'x@y.z', subject: 's', body: 'b' }]);
  const rows = o.split(/\r?\n/).filter(l => /^[ab]\t/.test(l));
  assert.ok(rows[0].endsWith('\tSEND')); assert.ok(rows[1].endsWith('\t'));
  const d = parseDraftsDone('a\t2026-11-13 10:00:00\tSENT\t\nb\t2026-11-13 10:00:01\tOK\t');
  assert.equal(d.get('a').sent, true); assert.equal(d.get('a').ok, true); assert.equal(d.get('b').sent, false);
  const log = foldInquiryEvents('c1\t2026-11-13 10:00:00\ta@b.c\tS\tp1\t2\tINQUIRY_REPLY_SENT\t\t1500\tx\t\t1\n' + 'c2\t2026-11-13 10:00:00\ta@b.c\tS\tp1\t2\tRATE_RESPONSE_SENT\t\t1500\tx\t\t2\tasks_rate\t1500\ttarget\tSENT');
  assert.equal(log[0].sent, false); assert.equal(log[1].sent, true); assert.equal(log[1].ladderStage, 'target');
});

test('reprice is judged from the posted DAT rate, not the target', () => {
  const mem = [posting({ targetRate: 1200, datRate: 1000 }), posting({ targetRate: 1200, datRate: 1000, variant: 'Nearby 1' })];
  assert.equal(postedRateOf(mem).rate, 1000); assert.equal(postedRateOf(mem).own, true);
  const st = groupStats(mem, { inquiries: [], now: new Date(), zip: {}, settings: DEFAULT_SETTINGS });
  const rp = repriceSuggestion(st, 0);
  assert.equal(rp.from, 1000); assert.ok(rp.to > 1000 && rp.to < 1200, 'raise from 1000, not from 1200: ' + rp.to);
  const none = [posting({ targetRate: 1200 })];
  assert.equal(postedRateOf(none).rate, 1200); assert.equal(postedRateOf(none).own, false);
});

test('guided notes: a new, lane-specific note every 30 minutes', () => {
  const p = posting({ targetRate: 1500, datRate: 1400 });
  const t0 = new Date('2026-11-13T10:00:00Z');
  p.ops = [{ type: 'posted', at: t0.toISOString() }];
  const titles = [];
  for (const min of [31, 61, 91, 121, 151, 181]) {
    const now = new Date(t0.getTime() + min * 60000);
    const st = groupStats([p], { inquiries: [], now, zip: {}, settings: DEFAULT_SETTINGS });
    const adv = nextSteps(st, { depth: 6, unusedDepth: 4, wave: 5, now });
    const pulse = adv.steps.find(s => s.id === 'pulse');
    assert.ok(pulse, 'pulse at ' + min); assert.match(pulse.detail, /Chicago/);
    titles.push(pulse.title);
  }
  assert.equal(new Set(titles).size, titles.length, 'every 30-minute slot has a different note: ' + titles.join(' | '));
  // inquiry count changes the note
  const q = [1, 2, 3].map(i => ({ id: 'i' + i, postingId: p.id, dateCounted: new Date(t0.getTime() + i * 600000).toISOString(), lastCarrierRate: '' }));
  const now = new Date(t0.getTime() + 61 * 60000);
  const adv = nextSteps(groupStats([p], { inquiries: q, now, zip: {}, settings: DEFAULT_SETTINGS }), { depth: 6, unusedDepth: 4, wave: 5, now });
  assert.match(adv.steps.find(s => s.id === 'pulse').title, /3 inquiries, no rate yet/);
});
