// v12: a logged rate must be believable before the board can call it "inside the booking band"; pickup-date sort.
import test from 'node:test';
import assert from 'node:assert/strict';
import { judgeQuote, numbersIn, isLegacyLine } from '../../js/core/quotes.js';
import { groupStats, attentionFlags, analyseBoard } from '../../js/core/worklist.js';
import { extractRate, freshText } from '../../js/core/carrierreply.js';
import { processIncomingEmail } from '../../js/core/inbound.js';
import { pickupSortTime, sortRowsByPickup } from '../../js/core/expiry.js';
import { DEFAULT_SETTINGS } from '../../js/core/defaults.js';
import { planInquirySync, foldInquiryEvents } from '../../js/core/bridge.js';

const S = DEFAULT_SETTINGS;
const NOW = new Date(2026, 10, 16, 9);
const load = (over = {}) => ({ id: 'p1', groupId: '', variant: 'Original', originCity: 'Chicago', originState: 'IL', originZip: '60601', destCity: 'Atlanta', destState: 'GA', destZip: '30303',
  equip: 'V', weight: '42000', pickupEarliest: '11/20/2026', pickupLatest: '11/20/2026', targetRate: '4200', details: 'Pickup: Chicago, IL 60601\nDelivery: Atlanta, GA 30303\nTotal miles 715\nLoad # 700', notes: '', createdAt: NOW.toISOString(), status: 'Active', ...over });
const stats = (inq, p = load()) => groupStats([p], { inquiries: inq.map(q => ({ postingId: p.id, dateCounted: NOW.toISOString(), senderEmail: 'c@x.example', stage: 'RATE_RESPONSE_SENT', ...q })), now: NOW, zip: {}, settings: S });

test('THE $700 BUG: a rate far below target is never "inside the booking band" / ready to book', () => {
  for (const target of ['4200', '5000', '1500', '2300']) {
    const st = stats([{ lastCarrierRate: 700, intent: 'rate', ladderStage: 'book', flag: '' }], load({ targetRate: target }));
    assert.equal(st.inquiries.quotes.length, 0, `target ${target}`);
    assert.equal(st.inquiries.bestQuote, 0);
    assert.equal(st.inquiries.stage, null, 'no ladder stage may be derived from a rejected rate');
    const f = attentionFlags(st);
    assert.ok(!f.some(x => x.kind === 'hot'), 'must not be flagged ready to book');
    assert.ok(f.some(x => x.kind === 'review' && /700/.test(x.text)), 'the ignored rate is explained, not silently dropped');
  }
});

test('a wrong rate stays wrong after the carrier\'s next reply overwrites the log flag', () => {
  // flag was "RATE LOOKS WRONG" on the first event; the next event wrote an empty flag and left the rate in place
  const st = stats([{ lastCarrierRate: 700, intent: 'accepts', flag: '' }]);
  assert.equal(st.inquiries.quotes.length, 0);
});

test('a real quote in the band is still ready to book', () => {
  const st = stats([{ lastCarrierRate: 4100, intent: 'rate', ladderStage: 'book', flag: 'RATE RECEIVED - REVIEW / ETA' }]);
  assert.equal(st.inquiries.quotes.length, 1);
  assert.equal(st.inquiries.stage.stage, 'book');
  assert.ok(attentionFlags(st).some(x => x.kind === 'hot' && /4,100/.test(x.text)));
  // and a cheap-but-real quote on a cheap load is fine too
  const small = stats([{ lastCarrierRate: 700, intent: 'rate' }], load({ targetRate: '800', details: 'Pickup: A' }));
  assert.equal(small.inquiries.quotes.length, 1);
});

test('lines from the old macro (no intent) are unverified: never "ready to book", but surfaced for a look', () => {
  const st = stats([{ source: 'outlook', intent: '', lastCarrierRate: 4100 }]);
  assert.equal(st.inquiries.quotes.length, 0);
  assert.equal(st.inquiries.unverified.length, 1);
  const f = attentionFlags(st);
  assert.ok(!f.some(x => x.kind === 'hot'));
  assert.ok(f.some(x => x.kind === 'review' && /older Outlook macro/.test(x.text)));
});

test('an old-macro rate that is just a number from your own load text or the lane mileage is rejected', () => {
  const own = judgeQuote({ source: 'outlook', intent: '', lastCarrierRate: 715 }, { target: 800, settings: S, ownText: 'Total miles 715' });
  assert.equal(own.ok, false); assert.match(own.reason, /own load text/);
  const subj = judgeQuote({ source: 'outlook', intent: '', lastCarrierRate: 1200, subject: 'RE: Load 1200 Chicago' }, { target: 1250, settings: S, ownText: '' });
  assert.equal(subj.ok, false);
  const mi = judgeQuote({ source: 'outlook', intent: '', lastCarrierRate: 715 }, { target: 800, settings: S, ownText: '', miles: 715 });
  assert.equal(mi.ok, false); assert.match(mi.reason, /mileage/);
  assert.equal(isLegacyLine({ source: 'outlook', intent: 'rate' }), false);
  assert.equal(isLegacyLine({ intent: '' }), false, 'app-made lines are never "legacy"');
});

test('judgeQuote: range, flags, band edges', () => {
  const j = (rate, target, extra = {}) => judgeQuote({ lastCarrierRate: rate, intent: 'rate', ...extra }, { target, settings: S });
  assert.equal(j('', 1000).has, false);
  assert.equal(j(100, 0).ok, false);                       // below min plausible, even with no target
  assert.equal(j(25000, 0).ok, false);
  assert.equal(j(4000, 0).ok, true);                       // no target: range check only
  assert.equal(j(500, 1000).ok, true);                     // exactly half = allowed
  assert.equal(j(499, 1000).ok, false);
  assert.equal(j(3000, 1000).ok, true);                    // exactly 3x = allowed
  assert.equal(j(3001, 1000).ok, false);
  assert.equal(j(1000, 1000, { flag: 'MANUAL REVIEW - MORE THAN ONE RATE OR PER-MILE RATE' }).ok, false);
});

test('numbersIn ignores dates and reads comma numbers', () => {
  const n = numbersIn('Pickup Date: 11/20/2026\nWeight: 42,000 lbs\nTotal miles 715\nLoad # 700');
  assert.ok(n.has(42000) && n.has(715) && n.has(700)); assert.ok(!n.has(2026));
});

test('end to end: the $700 never gets logged when the carrier did not type it (new engine)', () => {
  const p = load({ id: 'p1', targetRate: '4200' });
  const mail = (body) => ({ from: 'driver@carrier.example', subject: 'RE: Chicago, IL to Atlanta, GA', body, sent: 'x', to: '' });
  const first = processIncomingEmail({ mail: mail('Is this still available?'), postings: [p], inquiries: [] });
  const rec = { id: 'q1', ...first.newInquiry };
  const quoted = '\n\nPickup: Chicago, IL 60601\nDelivery: Atlanta, GA 30303\nTotal miles 715\nLoad # 700\nWhat is your best all-in rate? ETA to pickup?';
  for (const body of ['Can you do better on the rate?' + quoted, 'ok thanks' + quoted, 'I am 700 DH from pickup, what is it paying?' + quoted, 'Load # 700 still open?' + quoted, 'call me 312-555-0700' + quoted, 'Deadhead 700 mi, need to know rate' + quoted]) {
    const r = processIncomingEmail({ mail: mail(body), postings: [p], inquiries: [rec] });
    const logged = r.inquiryPatch && r.inquiryPatch.patch.lastCarrierRate;
    assert.ok(!logged, `"${body.split('\n')[0]}" must not log a rate (got ${logged})`);
  }
  assert.deepEqual(extractRate('I can do 4200, 700 deadhead').candidates, [4200]);
  assert.deepEqual(extractRate('rate 4200 for 700 loads').candidates, [4200]);
});

test('Outlook sync: a v5-style line (12 columns, no intent) is marked as coming from the old macro', () => {
  const tsv = ['c1\t2026-11-16 09:00:00\tdriver@carrier.example\tRE: Chicago\tp1\t2\tRATE_RESPONSE_SENT\t700\t4200\tRate 83.3% under target (booking band) - ETA confirmation drafted\tRATE RECEIVED - REVIEW / ETA\t2'].join('\r\n');
  const recs = foldInquiryEvents(tsv);
  assert.equal(recs[0].intent, '');
  const plan = planInquirySync(recs, [], [load()]);
  assert.equal(plan.creates[0].source, 'outlook');
  const st = stats([{ ...plan.creates[0], postingId: 'p1' }]);
  assert.equal(st.inquiries.quotes.length, 0);
  assert.ok(!attentionFlags(st).some(x => x.kind === 'hot'));
});

// ---------------------------------------------------------------- pickup date sort
const row = (id, pickup) => ({ box: { head: { id, pickupEarliest: pickup, pickupLatest: pickup } } });
test('pickupSortTime reads dates, times and ignores text it cannot read', () => {
  const t = (v) => pickupSortTime({ pickupEarliest: v });
  assert.equal(t('11/16/2026'), new Date(2026, 10, 16).getTime());
  assert.equal(t('11/16/2026 08:00'), new Date(2026, 10, 16, 8).getTime());
  assert.equal(t('11/16/2026 8:30 PM'), new Date(2026, 10, 16, 20, 30).getTime());
  assert.equal(t('11/16/26'), new Date(2026, 10, 16).getTime());
  assert.equal(t('2026-11-16'), new Date(2026, 10, 16).getTime());
  assert.equal(t('soon'), null); assert.equal(t(''), null);
  assert.equal(pickupSortTime({ pickupEarliest: '', pickupLatest: '11/18/2026' }), new Date(2026, 10, 18).getTime());
});

test('sortRowsByPickup: soonest / latest first, undated last in both directions, ties keep board order', () => {
  const rows = [row('a', '11/20/2026'), row('b', ''), row('c', '11/18/2026'), row('d', '11/20/2026'), row('e', '12/01/2026'), row('f', 'tbd')];
  const ids = (r) => r.map(x => x.box.head.id).join('');
  assert.equal(ids(sortRowsByPickup(rows, 'asc')), 'cadebf');
  assert.equal(ids(sortRowsByPickup(rows, 'desc')), 'eadcbf');
  assert.equal(ids(rows), 'abcdef', 'input is not mutated');
});

test('time of day orders loads that pick up the same day', () => {
  const rows = [row('pm', '11/18/2026 3:00 PM'), row('am', '11/18/2026 8:00 AM'), row('none', '11/18/2026')];
  assert.equal(sortRowsByPickup(rows, 'asc').map(x => x.box.head.id).join(','), 'none,am,pm');
});

// ---------------------------------------------------------------- the reader itself
test('a rate typed at the end of a line is not cancelled by the first word of the next line', () => {
  const r = (t) => extractRate(t);
  assert.deepEqual(r('Rate: $4200\nDH 700\nThanks').candidates, [4200]);
  assert.deepEqual(r('We can do $4,100\nMiles from you: 20').candidates, [4100]);
  assert.deepEqual(r('Rate $3950\nLoads available: 2').candidates, [3950]);
  assert.deepEqual(r('$4200\ntotal miles 715').candidates, [4200]);
  assert.ok(!r('weight 4200\ntotal 715 for the whole thing').candidates.includes(4200), 'a suffix word on the NEXT line does not turn a weight into a rate');
});

test('an extra charge is not the rate: lumper / detention / TONU / deposit amounts are skipped', () => {
  assert.deepEqual(extractRate('I need $700 for lumper plus 4200 line haul').candidates, [4200]);
  const two = extractRate('4200 all in. detention $700 after 2 hours');
  assert.equal(two.found, false, 'a fee written BEFORE its amount cannot be told apart from a rate: two amounts = never guessed, a person looks');
  assert.equal(two.ambiguous, true);
  assert.deepEqual(extractRate('$4,200 and $700 TONU if cancelled').candidates, [4200]);
  assert.equal(extractRate('need $700 deposit').found, false);
  assert.equal(extractRate('I am 700 dh from pickup').found, false);
});
