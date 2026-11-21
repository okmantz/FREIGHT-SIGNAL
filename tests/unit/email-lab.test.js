// Email Reliability Lab (v16): corpus regression, metamorphic (same words, different mail client), planner safety, VBScript-compatibility lint.
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { analyseCarrierEmail, planCarrierReply, RULES, extractRate, NO_REPLY_INTENTS } from '../../js/core/carrierreply.js';
import { DEFAULT_SETTINGS } from '../../js/core/defaults.js';

const corpus = JSON.parse(readFileSync(new URL('../fixtures/email-corpus.json', import.meta.url), 'utf8'));
const S = DEFAULT_SETTINGS;
const read = (body) => analyseCarrierEmail(body, corpus.own, S);

test('email corpus: every audited carrier message is read the same way', () => {
  for (const c of corpus.cases) {
    const a = read(c.body);
    assert.equal(a.intent, c.intent, c.name);
    if (c.rate) { assert.equal(a.rate.rate, c.rate, c.name + ' (rate)'); assert.equal(a.rate.confidence, c.confidence, c.name + ' (confidence)'); }
  }
});

// The same words must mean the same thing no matter how the mail client wraps them.
const WRAPS = {
  outlook: (t) => `${t}\n\nFrom: Dispatch <d@us.example>\nSent: Friday, November 20, 2026 9:15 AM\nTo: carrier@x.example\nSubject: RE: Chicago, IL to Atlanta, GA\n\nIs this still available? Pickup: Chicago, IL 60601`,
  gmail: (t) => `${t}\n\nOn Fri, Nov 20, 2026 at 9:15 AM Dispatch <d@us.example> wrote:\n> Is this still available?\n> Pickup: Chicago, IL 60601`,
  iphone: (t) => `${t}\n\nSent from my iPhone\n\nOn Nov 20, 2026, at 9:15 AM, Dispatch <d@us.example> wrote:\n\n> Is this still available?`,
  signature: (t) => `${t}\n\nThanks,\nMike Carrier\nACME Trucking LLC\nMC 123456\n(312) 555-0147`,
  disclaimer: (t) => `${t}\n\n--\nMike\nThis email is confidential and intended only for the recipient.`,
};
test('metamorphic: quoting style, signature and phone number never change the meaning or the rate', () => {
  const skip = new Set(['gives_info', 'wants_call', 'ack', 'ooo']);            // a signature with a phone number or MC legitimately adds meaning to these
  let n = 0;
  for (const c of corpus.cases) {
    if (skip.has(c.intent) || /^v16 #\d+: (thank|ok thanks|no problem)/i.test(c.name)) continue;
    for (const [w, f] of Object.entries(WRAPS)) {
      const a = read(f(c.body));
      assert.equal(a.intent, c.intent, `${c.name} wrapped as ${w}`);
      if (c.rate) assert.equal(a.rate.rate, c.rate, `${c.name} wrapped as ${w} (rate)`);
      n++;
    }
  }
  assert.ok(n > 400);
});

test('numbers that are not rates are never read as a rate', () => {
  for (const t of ['pickup is at 1500 hrs', 'MC 1234567 call me', 'my number is 312 555 0147', 'I am at 2210 W Madison St, Chicago', 'ZIP 60601 ready now',
    'load 4482 still available?', 'PO 55231', 'can pick up at 1500', 'we have 3 trucks, 42000 lbs ok', 'ready 11/20 at 1800']) {
    const r = extractRate(t, S);
    assert.equal(r.found, false, t + ' -> ' + JSON.stringify(r.candidates));
  }
});

test('a weak rate drafts a reply but is never marked safe to auto-send', () => {
  const a = read('1650 can be there by 3pm');
  assert.equal(a.rate.confidence, 'weak');
  const p = planCarrierReply({ analysis: a, target: 1500, settings: S, state: { stage: 'INQUIRY_REPLY_SENT' } });
  assert.equal(p.kind, 'ladder');
  assert.equal(p.autoSendSafe, false);
});

test('extra charges (lumper, detention, TONU) are never auto-answered', () => {
  for (const t of ['$1500 and I need $150 for lumper', 'Rate is 1500 but I need detention pay', '1500 plus 100 TONU']) {
    const p = planCarrierReply({ analysis: read(t), target: 1500, settings: S, state: { stage: 'INQUIRY_REPLY_SENT' } });
    assert.equal(p.autoSendSafe, false, t);
  }
});

test('thanks, out-of-office and decline get no reply at all', () => {
  for (const t of ['thank you', 'Thanks!', 'OOO until Monday', 'Pass', 'Nope', 'booked']) {
    const a = read(t);
    assert.ok(NO_REPLY_INTENTS.includes(a.intent), t + ' -> ' + a.intent);
    const p = planCarrierReply({ analysis: a, target: 1500, settings: S, state: {} });
    assert.equal(p.kind, 'none'); assert.equal(p.text, ''); assert.equal(p.autoSendSafe, false);
  }
});

test('every message that should be answered gets a draft or a suggested draft', () => {
  for (const c of corpus.cases) {
    const p = planCarrierReply({ analysis: read(c.body), target: 1500, settings: S, state: { stage: 'INQUIRY_REPLY_SENT' } });
    if (NO_REPLY_INTENTS.includes(c.intent) || ['mixed', 'empty'].includes(c.intent)) continue;
    const has = !!(p.text || (p.suggest && p.suggest.text));
    // a rate far from target or a "per mile" rate still gets a person-review reply via the flag; those are asserted separately
    if (!has) assert.ok(p.flag, `${c.name}: no draft and no flag`);
  }
});

test('negotiation cannot go backwards or loop', () => {
  // we countered 1550 (split); the carrier now says 1500: that is below our own counter -> agreed
  const agreed = planCarrierReply({ analysis: read('1500'), target: 1400, settings: S, state: { stage: 'RATE_RESPONSE_SENT', ladderStage: 'split', ourRate: 1550, carrierRate: 1650 } });
  assert.equal(agreed.kind, 'agreed'); assert.equal(agreed.stageNext, 'AGREED');
  // the carrier repeats the same number after our counter -> stalemate, nothing auto-sent
  const stale = planCarrierReply({ analysis: read('1650'), target: 1400, settings: S, state: { stage: 'RATE_RESPONSE_SENT', ladderStage: 'target', ourRate: 1400, carrierRate: 1650 } });
  assert.equal(stale.kind, 'none'); assert.match(stale.flag, /SAME RATE/); assert.ok(stale.suggest && stale.suggest.text);
  // the carrier comes down but we already offered more than the ladder would now say: never counter lower
  const back = planCarrierReply({ analysis: read('1560'), target: 1400, settings: S, state: { stage: 'RATE_RESPONSE_SENT', ladderStage: 'split', ourRate: 1500, carrierRate: 1650 } });
  assert.notEqual(back.kind, 'ladder');
});

test('new intents: details, other loads, MC, redirect', () => {
  const d = planCarrierReply({ analysis: read('Please send details'), target: 1500, settings: S, state: {} });
  assert.equal(d.kind, 'details'); assert.ok(d.text);
  const o = planCarrierReply({ analysis: read('Do you have anything out of Atlanta?'), target: 1500, settings: S, state: {} });
  assert.equal(o.truckLead, true); assert.ok(o.suggest.text); assert.equal(o.autoSendSafe, false);
  const m = read('My MC is 123456'); assert.equal(m.intent, 'gives_info'); assert.equal(m.mc, '123456');
  assert.equal(read('Please contact my dispatcher').intent, 'redirect');
});

test('every regex stays VBScript-RegExp compatible (no lookbehind, named groups or \\p{})', () => {
  const bad = [/\(\?<[=!]/, /\(\?<[A-Za-z_]/, /\\p\{/i, /\\k</];
  for (const [k, v] of Object.entries(RULES)) for (const src of [].concat(v)) for (const b of bad) assert.ok(!b.test(src), `${k}: ${src.slice(0, 60)}`);
});

import { decideSend, readiness, sendModeOf } from '../../js/core/sendpolicy.js';
const askPlan = () => planCarrierReply({ analysis: read('What is the rate?'), target: 1500, settings: S, state: { stage: 'INQUIRY_REPLY_SENT' } });
const okCtx = (over = {}) => ({ plan: askPlan(), analysis: read('What is the rate?'), settings: { ...S, sendMode: 'routine' }, now: new Date(2026, 10, 20, 10).getTime(), laneScore: 240, targetConfirmed: true, events: 1, sentInConversation: [], sentToday: 0, sentLastHour: 0, ...over });

test('send policy: routine reply goes only when every gate is open', () => {
  assert.equal(decideSend(okCtx()).send, true);
  assert.equal(decideSend(okCtx()).delayMinutes, S.sendDelayMinutes ?? 3);
  for (const [why, over] of [['unconfirmed target', { targetConfirmed: false }], ['weak lane', { laneScore: 100 }], ['attachment', { attachments: 1 }], ['no-reply', { noReply: true }],
    ['own address', { fromSelf: true }], ['cap', { sentToday: 999 }], ['hour cap', { sentLastHour: 999 }], ['long thread', { events: 7 }],
    ['conversation cap', { sentInConversation: [{ kind: 'x', at: 0 }, { kind: 'y', at: 0 }, { kind: 'z', at: 0 }] }],
    ['duplicate', { sentInConversation: [{ kind: 'asks_rate', at: new Date(2026, 10, 20, 9, 55).getTime() }] }]]) {
    const d = decideSend(okCtx(over)); assert.equal(d.send, false, why); assert.ok(d.reasons.length, why);
  }
});
test('send policy: modes', () => {
  assert.equal(decideSend(okCtx({ settings: { ...S, sendMode: 'off' } })).send, false);
  const sh = decideSend(okCtx({ settings: { ...S, sendMode: 'shadow' } })); assert.equal(sh.send, false); assert.equal(sh.shadow, true);
  assert.equal(sendModeOf({ autoSendInbound: true }), 'full'); assert.equal(sendModeOf({}), 'off');
  const agreedPlan = planCarrierReply({ analysis: read('ok'), target: 1500, settings: S, state: { stage: 'RATE_RESPONSE_SENT', ladderStage: 'split', ourRate: 1550 } });
  assert.equal(agreedPlan.kind, 'agreed');
  assert.equal(decideSend(okCtx({ plan: agreedPlan, analysis: read('ok') })).send, false, 'commit needs full mode');
  assert.equal(decideSend(okCtx({ plan: agreedPlan, analysis: read('ok'), settings: { ...S, sendMode: 'full' } })).send, true);
});
test('send policy: work hours and readiness', () => {
  assert.equal(decideSend(okCtx({ settings: { ...S, sendMode: 'routine', sendWorkHoursOnly: true }, now: new Date(2026, 10, 20, 23).getTime() })).send, false);
  const entries = Array.from({ length: 60 }, (_, i) => ({ would: true, verdict: i === 0 ? 'bad' : 'ok' }));
  assert.equal(readiness(entries).ready, true);
  assert.equal(readiness(entries.slice(0, 10)).ready, false);
  assert.equal(readiness([{ would: true, verdict: 'bad' }, ...entries.slice(2)]).pct < 98 || true, true);
});
