import test from 'node:test';
import assert from 'node:assert/strict';
import { encodeField, decodeField, postingsFile, postingsFingerprint, configFile, foldInquiryEvents, planInquirySync, parseStatus, POSTING_COLS, INQUIRY_COLS, inquiriesHeader } from '../../js/core/bridge.js';
import { DEFAULT_SETTINGS } from '../../js/core/defaults.js';
import { blankPosting, initializeLoadControls } from '../../js/core/model.js';
import { findMatchingLoad } from '../../js/core/inbound.js';

const P = (o = {}) => { const p = blankPosting({ originCity: 'Modesto', originState: 'CA', destCity: 'Reno', destState: 'NV', targetRate: 1500, ...o }); initializeLoadControls(p); return p; };

test('field encoding is ASCII-only and reversible for tabs / newlines / backslashes', () => {
  const raw = 'Line1\r\nLine2\tTab \\ back';
  const enc = encodeField(raw);
  assert.ok(!/[\t\r\n]/.test(enc));
  assert.equal(decodeField(enc), 'Line1\nLine2\tTab \\ back');
  assert.equal(encodeField('Café – “quote” \u{1F69B}'), 'Cafe - "quote" ');
});

test('postings feed: header line, column row, one line per live posting, same columns as the macro expects', () => {
  const a = P({ details: 'Pickup: Modesto, CA\nDelivery: Reno, NV' }), b = P({ status: 'Covered' });
  const txt = postingsFile([a, b], new Date('2026-11-11T00:00:00Z'));
  const lines = txt.split('\r\n');
  assert.equal(lines[0], '#FREIGHT-SIGNAL-BRIDGE\tv1\t2026-11-11T00:00:00.000Z\t1');
  assert.equal(lines[1].split('\t').join(','), POSTING_COLS.join(','));
  assert.equal(lines.filter(Boolean).length, 3);
  const cells = lines[2].split('\t');
  assert.equal(cells.length, POSTING_COLS.length);
  assert.equal(cells[0], a.id);
  assert.ok(cells[POSTING_COLS.indexOf('Details')].includes('\\n'));
  assert.ok(/^[\x00-\x7f]*$/.test(txt));
  assert.equal(postingsFingerprint([a]), postingsFingerprint([a]));
});

test('config feed carries the rate rules and inbound blocklist (nothing company-specific is hard-coded)', () => {
  const txt = configFile({ ...DEFAULT_SETTINGS, inboundBlocklist: ['@blocked.example'] });
  assert.match(txt, /rateProximity\t200/);
  assert.match(txt, /inboundBlock\t@blocked\.example/);
});

test('Outlook events fold per conversation: first timestamp kept, last line wins, partial lines ignored', () => {
  const ev = inquiriesHeader()
    + 'C1\t2026-11-11 10:00:00\tcarrier@x.example\tModesto to Reno\tP1\t2\tINQUIRY_REPLY_SENT\t\t1500\tInquiry reply draft created\t\t1\r\n'
    + 'C1\t2026-11-11 10:05:00\tcarrier@x.example\tRE: Modesto to Reno\tP1\t2\tRATE_RESPONSE_SENT\t1700\t1500\tRate $200 from target - negotiation draft created\t\t2\r\n'
    + 'C2\t2026-11-11 11:00:00\ttruncated';
  const f = foldInquiryEvents(ev);
  assert.equal(f.length, 1);
  assert.equal(f[0].stage, 'RATE_RESPONSE_SENT');
  assert.equal(f[0].lastCarrierRate, 1700);
  assert.equal(f[0].eventCount, 2);
  assert.ok(f[0].dateCounted < f[0].lastEventAt);
});

test('sync plan is idempotent: one inquiry + one count bump per conversation, later events only patch', () => {
  const post = P(); post.id = 'P1'; post.inquiryCount = 3;
  const rec = (o) => ({ conversationId: 'C1', dateCounted: '2026-11-11T18:00:00Z', lastEventAt: '2026-11-11T18:00:00Z', senderEmail: 'c@x.example', subject: 's', postingId: 'P1', postingRow: 2, stage: 'INQUIRY_REPLY_SENT', lastCarrierRate: '', targetRate: 1500, lastAction: 'Inquiry reply draft created', flag: '', eventCount: 1, ...o });
  const p1 = planInquirySync([rec()], [], [post]);
  assert.equal(p1.creates.length, 1);
  assert.equal(p1.creates[0].countAfterInquiry, 4);
  assert.deepEqual(p1.postingBumps, [{ id: 'P1', count: 4 }]);
  assert.equal(p1.creates[0].originCity, 'Modesto');
  // apply, then re-run with the same events: nothing to do
  const q = { id: 'Q1', ...p1.creates[0] };
  const again = planInquirySync([rec()], [q], [{ ...post, inquiryCount: 4 }]);
  assert.equal(again.creates.length + again.patches.length + again.postingBumps.length, 0);
  // a rate reply patches the same inquiry
  const upd = planInquirySync([rec({ stage: 'RATE_RESPONSE_SENT', lastCarrierRate: 1700, eventCount: 2, lastAction: 'Rate $200 from target' })], [q], [post]);
  assert.equal(upd.creates.length, 0);
  assert.equal(upd.patches[0].patch.stage, 'RATE_RESPONSE_SENT');
  assert.equal(upd.patches[0].patch.rateResponseSent, 'YES');
});

test('status file parses', () => {
  const s = parseStatus('macroVersion=v4\r\nlastSeen=2026-11-11 10:00:00\r\npostingsRead=9\r\nlastEvent=Engine started\r\n');
  assert.equal(s.macroVersion, 'v4'); assert.equal(s.postingsRead, 9); assert.ok(s.lastSeen.startsWith('2026-11-11'));
});

test('a posting written through the bridge is matched the way the app / Excel macro matches it', () => {
  const a = P({ details: 'Pickup: Modesto, CA 95350\nDelivery: Reno, NV 89501' });
  const hit = findMatchingLoad('Truck for Modesto CA to Reno NV', '', [a]);
  assert.equal(hit.posting.id, a.id);
  assert.equal(INQUIRY_COLS.length, 12);
});
