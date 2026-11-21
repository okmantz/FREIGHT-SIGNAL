import test from 'node:test';
import assert from 'node:assert/strict';
import { ledgerKey, buildLedgerEntry, exceptionQueue, sendCounts, shadowStats, ledgerSummary } from '../../js/core/ledger.js';
import { processIncomingEmail } from '../../js/core/inbound.js';
import { blankPosting, initializeLoadControls } from '../../js/core/model.js';
import { DEFAULT_SETTINGS } from '../../js/core/defaults.js';
import { decideSend } from '../../js/core/sendpolicy.js';

const posting = () => { const p = blankPosting({ originCity: 'Chicago', originState: 'IL', destCity: 'Atlanta', destState: 'GA', targetRate: 1500, details: 'Pickup: Chicago, IL 60601\nDelivery: Atlanta, GA 30303' }); initializeLoadControls(p); return p; };
const mail = (o) => ({ from: 'carrier@x.example', subject: 'Chicago, IL to Atlanta, GA', body: 'Is this still available?', ...o });

test('ledger key: Message-ID wins, otherwise a stable hash; same message = same key', () => {
  assert.equal(ledgerKey({ messageId: '<ABC@x>' }), ledgerKey({ internetMessageId: '<abc@x>' }));
  assert.equal(ledgerKey(mail()), ledgerKey(mail()));
  assert.notEqual(ledgerKey(mail()), ledgerKey(mail({ body: 'Rate 1500' })));
});

test('ledger entries: a held message lands in the exception queue with the carrier words and a suggested reply', () => {
  const p = posting();
  const first = processIncomingEmail({ mail: mail(), postings: [p], inquiries: [] });
  const inq = { id: 'q1', ...first.newInquiry };
  const m2 = mail({ body: 'Please call me, need to talk about the pickup' });
  const res = processIncomingEmail({ mail: m2, postings: [p], inquiries: [inq] });
  const e = buildLedgerEntry(res, m2, decideSend({ plan: res.plan, analysis: res.analysis, settings: { ...DEFAULT_SETTINGS, sendMode: 'routine' }, laneScore: 1000, targetConfirmed: true }));
  assert.equal(e.status, 'review'); assert.match(e.fresh, /call me/i); assert.ok(e.suggestText); assert.equal(e.resolved, false);
  assert.equal(exceptionQueue([e]).length, 1);
  assert.equal(exceptionQueue([{ ...e, resolved: true }]).length, 0);
});

test('ledger: a routine reply is "auto" only when the policy sent it; counts feed the caps', () => {
  const p = posting();
  const res = processIncomingEmail({ mail: mail(), postings: [p], inquiries: [] });
  const dec = decideSend({ plan: { kind: 'inquiry', text: res.replyText, autoSendSafe: res.autoSendSafe }, analysis: res.analysis, settings: { ...DEFAULT_SETTINGS, sendMode: 'routine' }, laneScore: res.laneScore, targetConfirmed: true, events: 1 });
  const e = buildLedgerEntry(res, mail(), dec, Date.now());
  assert.equal(dec.send, true); assert.equal(e.status, 'auto');
  const c = sendCounts([e], e.convId, Date.now()); assert.equal(c.sentToday, 1); assert.equal(c.sentLastHour, 1);
  assert.equal(ledgerSummary([e]).auto, 1);
});

test('ledger: shadow stats use your verdicts', () => {
  const rows = Array.from({ length: 35 }, () => ({ status: 'shadow', would: true, verdict: 'ok' }));
  assert.equal(shadowStats(rows).ready, true);
  assert.equal(shadowStats(rows.slice(0, 5)).ready, false);
});

import { ledgerFromEventLines, foldInquiryEvents } from '../../js/core/bridge.js';
test('Outlook event lines become ledger entries with mode, reasons and the carrier words', () => {
  const t = ['c1', '2026-11-20 10:00:00', 'a@x.com', 'Chicago, IL to Atlanta, GA', 'p1', '2', 'RATE_RESPONSE_SENT', '1500', '1400', 'reply-target', '', '2', 'rate', '1400', 'target', 'SENT', 'auto', '', 'Rate 1500', 'Our best is 1400'].join('\t')
    + '\r\n' + ['c2', '2026-11-20 10:05:00', 'b@x.com', 'S', 'p1', '2', 'FOLLOWUP_FLAGGED', '', '1400', 'flag', 'CARRIER WANTS A CALL', '1', 'wants_call', '', '', '', 'review', 'Reply is one you should look at | Weak lane', 'call me', ''].join('\t');
  const e = ledgerFromEventLines(t);
  assert.equal(e.length, 2); assert.equal(e[0].status, 'auto'); assert.equal(e[1].status, 'review'); assert.equal(e[1].holdReasons.length, 2); assert.equal(e[1].fresh, 'call me'); assert.equal(e[1].resolved, false);
  assert.equal(foldInquiryEvents(t)[0].mode, 'auto');
});
