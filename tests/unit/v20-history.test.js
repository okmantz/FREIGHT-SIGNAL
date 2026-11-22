import test from 'node:test';
import assert from 'node:assert/strict';
import { analyzeHistory, planImport, normalizeMessage, parseEml, parseExport, readDriverInfo, readIds, readCompany, resolveRate, mergeCarrierPatch, findExisting, lanesInText, attachmentKinds, coverEntryFor } from '../../js/core/history.js';
import { encodeField } from '../../js/core/bridge.js';
import { paceStats } from '../../js/core/coverlog.js';
import { realZipMap } from './helpers.js';

const zip = realZipMap();
const ME = 'owen@tql.example';
let n = 0;
const T = (d, h = 9, m = 0) => new Date(2026, 10, d, h, m, 0).getTime();
const msg = (o) => normalizeMessage({ id: 'm' + (++n), at: T(o.d, o.h || 9, o.m || 0), convId: o.conv, dir: o.dir, from: o.dir === 'out' ? { email: ME } : o.from, to: (o.to || (o.dir === 'out' ? [] : [ME])).map(e => ({ email: e })), subject: o.subject || 'Load: Aiken, SC to Fletcher, OK', body: o.body || '', attachments: o.att || [] });
const CAR = 'dispatch@swifthaul.example';
const SIG = '\n\nThanks,\nJohn Smith\nDispatcher\nSwift Haul LLC\nOffice: (312) 555-0147\nMC 123456';
const car = (o) => msg({ dir: 'in', from: { name: 'John Smith', email: CAR }, ...o });
const us = (o) => msg({ dir: 'out', to: [CAR], ...o });

const bookedThread = (conv, extra = []) => [
  us({ conv, d: 3, h: 9, body: 'Pickup: Aiken, SC\nDelivery: Fletcher, OK\nWhat is your best all-in rate?' }),
  car({ conv, d: 3, h: 10, body: '$2,400' + SIG }),
  us({ conv, d: 3, h: 11, body: 'Can you do $2,300?' }),
  car({ conv, d: 3, h: 12, body: '2300 works' }),
  us({ conv, d: 3, h: 13, body: 'Great, you are booked at $2,300. Please send driver and dispatch info.' }),
  car({ conv, d: 3, h: 14, body: 'Driver: Mike Jones\nCell: 803-555-0199\nTruck #4412\nTrailer 5510' }),
  us({ conv, d: 3, h: 15, subject: 'Rate Confirmation', body: 'Attached is the rate con, please sign and return.', att: ['TQL_RateConfirmation_77.pdf'] }),
  ...extra,
];
const run = (msgs, ctx = {}) => analyzeHistory(msgs, { zipMap: zip, own: [ME], ...ctx });

test('a real booking is verified with MC, company, phone, rate and lane read from the e-mails', () => {
  const a = run(bookedThread('C1'));
  assert.equal(a.candidates.length, 1);
  const c = a.candidates[0];
  assert.equal(c.level, 'high'); assert.equal(c.mc, '123456'); assert.equal(c.name, 'Swift Haul LLC'); assert.equal(c.email, CAR); assert.equal(c.phone, '3125550147');
  assert.equal(c.driverName, 'Mike Jones'); assert.equal(c.lastRate, 2300);
  assert.deepEqual({ ...c.bookings[0].lane }, { originCity: 'Aiken', originState: 'SC', destCity: 'Fletcher', destState: 'OK' });
});

test('"Please send driver and dispatch info" alone proves nothing; with the carrier replying it still needs review, never auto-import', () => {
  const asked = run([us({ conv: 'A', d: 5, body: 'Please send driver and dispatch info.' })]);
  assert.equal(asked.candidates.length, 0);
  const replied = run([us({ conv: 'B', d: 5, body: 'Please send driver and dispatch info.' }), car({ conv: 'B', d: 5, h: 10, body: 'Driver: Mike Jones\nCell: 803-555-0199' + SIG })]);
  assert.equal(replied.candidates.length, 1); assert.equal(replied.candidates[0].level, 'medium');
  const plan = planImport(replied, { carriers: [] }, { levels: ['high'] });
  assert.equal(plan.adds.length, 0);
});

test('a rate confirmation that a CUSTOMER sends you never makes a carrier', () => {
  const a = run([msg({ conv: 'X', dir: 'in', from: { name: 'Plant', email: 'shipping@bigcustomer.example' }, d: 4, subject: 'Rate Confirmation Chicago, IL to Atlanta, GA', body: 'Attached is the rate confirmation.', att: ['RateConfirmation.pdf'] })]);
  assert.equal(a.candidates.length, 0);
});

test('a cancellation after the booking removes the carrier from the import', () => {
  const a = run(bookedThread('C2', [car({ conv: 'C2', d: 4, h: 8, body: 'Sorry, the truck broke down and we cannot cover this load.' })]));
  assert.equal(a.candidates.length, 0);
  assert.ok(a.excluded.some(x => /cancel/.test(x.why)));
});

test('a mass e-mail to many carriers does not count as engagement with any of them', () => {
  const many = Array.from({ length: 8 }, (_, i) => 'c' + i + '@carrier' + i + '.example');
  const a = run([msg({ conv: 'M', dir: 'out', to: many, d: 6, body: 'Please send driver and dispatch info for the load you want.', subject: 'Aiken, SC to Fletcher, OK' })]);
  assert.equal(a.candidates.length, 0);
});

test('rate: only a clearly agreed number is recorded; a renegotiation after booking leaves it blank instead of guessing', () => {
  const a = run(bookedThread('C3', [car({ conv: 'C3', d: 3, h: 16, body: 'We need $2,600 now, fuel went up' })]));
  assert.equal(a.candidates[0].bookings[0].rate, 0);
  const r = resolveRate({ rateEvents: [{ at: 1, dir: 'in', rate: 2400 }], bookAt: 5, acceptedAfterOffer: false, evs: [] });
  assert.equal(r.rate, 2400); assert.equal(r.conf, 'medium');
});

test('duplicates: a carrier already in the database (by MC, e-mail or phone) is never added again', () => {
  const a = run(bookedThread('D1'));
  const byMc = [{ id: 'r1', carrierName: 'Swift Haul', mc: 'MC 123456', email: 'other@x.example', phone: '', originCity: '', originState: '', destCity: '', destState: '' }];
  const byMail = [{ id: 'r2', carrierName: 'Swift', mc: '', email: CAR }];
  const byPhone = [{ id: 'r3', carrierName: 'Swift Haul LLC', mc: '', email: 'x@y.example', phone: '(312) 555-0147' }];
  for (const carriers of [byMc, byMail, byPhone]) { const p = planImport(a, { carriers }, { levels: ['high'] }); assert.equal(p.adds.length, 0, JSON.stringify(carriers)); assert.equal(p.patches.length, 1); }
  assert.equal(planImport(a, { carriers: [] }, { levels: ['high'] }).adds.length, 1);
  const twice = planImport({ ...a, candidates: [a.candidates[0], { ...a.candidates[0], key: 'dup' }] }, { carriers: [] }, { levels: ['high'] });
  assert.equal(twice.adds.length, 1);
});

test('manual data is never overwritten: blanks are filled, different values are kept beside yours', () => {
  const a = run(bookedThread('E1'));
  const row = { id: 'r1', carrierName: 'Swift Haul Transport', mc: 'MC 123456', email: CAR, phone: '(999) 111-2222', equipment: '', rate: '1900', originCity: '', destCity: '' };
  const m = mergeCarrierPatch(row, a.candidates[0]);
  assert.equal(m.fill.phone, undefined); assert.equal(m.fill.carrierName, undefined);
  assert.ok(m.conflicts.some(c => c.field === 'phone' && c.have === '(999) 111-2222'));
  const p = planImport(a, { carriers: [row] }, { levels: ['high'] });
  assert.equal(p.patches[0].patch.rate, undefined); assert.equal(p.patches[0].patch.phone, undefined);
  assert.equal(p.patches[0].patch.verified, 'email');
});

test('a value that came from e-mail at low confidence may be replaced by a high-confidence one, a typed one never', () => {
  const cand = { level: 'high', name: 'Swift Haul LLC', nameConf: 'high', mc: '123456', email: CAR, phone: '3125550147', dispatchPhone: '', equipment: '' };
  const fromMail = { carrierName: 'Swift', mc: 'MC 123456', email: CAR, phone: '(111) 222-3333', fieldMeta: { phone: { src: 'email', conf: 35 } } };
  assert.equal(mergeCarrierPatch(fromMail, cand).fill.phone, '(312) 555-0147');
  const typed = { ...fromMail, fieldMeta: {} };
  assert.equal(mergeCarrierPatch(typed, cand).fill.phone, undefined);
});

test('imported covers never count toward weekly pace, and importing twice adds nothing', () => {
  const a = run(bookedThread('F1'));
  const p = planImport(a, { carriers: [], coverLog: [] }, { levels: ['high'] });
  assert.equal(p.covers.length, 1);
  const entry = coverEntryFor(p.covers[0], { uid: () => 'e1', zipMap: zip });
  assert.equal(entry.outcome, 'Covered'); assert.equal(entry.imported, true); assert.equal(entry.rate, 2300);
  const now = new Date(T(3, 18));
  assert.equal(paceStats([entry], { weeklyFloor: 50 }, now, null).week, 0);
  const again = planImport(a, { carriers: [], coverLog: [entry] }, { levels: ['high'] });
  assert.equal(again.covers.length, 0);
});

test('parsers: signature MC / company, driver block, lanes in subjects and labelled lines, attachment names', () => {
  assert.deepEqual(readIds('MC# 000123456 DOT 3344556'), { mc: ['123456'], dot: ['3344556'] });
  assert.equal(readCompany('Thanks\nBob\nOne Way Transport Inc\n(555) 111-2222').name, 'One Way Transport Inc');
  const d = readDriverInfo('Driver: Mike Jones\nCell: 803-555-0199\nTruck # 4412'); assert.equal(d.found, true); assert.equal(d.phone, '8035550199');
  assert.equal(readDriverInfo('thanks, we will send it later').found, false);
  const l = lanesInText('Aiken, SC to Fletcher, OK', zip, 'subject'); assert.equal(l.length, 1); assert.equal(l[0].lane.destState, 'OK');
  const k = attachmentKinds(['RC_signed.pdf', 'POD.pdf', 'logo.png']); assert.equal(k.ratecon, true); assert.equal(k.signed, true); assert.equal(k.pod, true);
});

test('export file round trip and .eml reading (quoted-printable, base64, attachments)', () => {
  const enc = encodeField;
  const body = 'Line one\nLine two\twith tab';
  const text = ['#FREIGHT-SIGNAL-HISTORY\tv1\treq1\t30\t2026-11-20 10:00:00\t', 'MsgId\tConvId\tTime\tDir\tFromName\tFromEmail\tTo\tCc\tBcc\tSubject\tAttachments\tFolder\tBody',
    ['id1', 'c1', '2026-11-03 09:00:00', 'Received', 'John', CAR, 'Owen <' + ME + '>;', '', '', 'RE: Aiken, SC to Fletcher, OK', 'RC.pdf|', 'Inbox', enc(body)].join('\t'), '#END\t1'].join('\r\n');
  const r = parseExport(text); assert.equal(r.ok, true); assert.equal(r.messages.length, 1); assert.equal(r.messages[0].body, body); assert.equal(r.messages[0].attachments[0], 'RC.pdf');
  assert.equal(parseExport(text.replace('#END\t1', '')).partial, true);
  const eml = ['From: "John" <' + CAR + '>', 'To: ' + ME, 'Subject: =?utf-8?B?UkU6IExvYWQ=?=', 'Date: Tue, 3 Nov 2026 14:00:00 -0500', 'Message-ID: <a@b>', 'MIME-Version: 1.0', 'Content-Type: multipart/mixed; boundary="BB"', '', '--BB', 'Content-Type: text/plain; charset=utf-8', 'Content-Transfer-Encoding: quoted-printable', '', 'Driver: Mike=20Jones=0D=0ACell: 803-555-0199', '--BB', 'Content-Type: application/pdf; name="RateConfirmation.pdf"', 'Content-Disposition: attachment; filename="RateConfirmation.pdf"', 'Content-Transfer-Encoding: base64', '', 'JVBERi0=', '--BB--'].join('\r\n');
  const m = parseEml(eml); assert.equal(m.subject, 'RE: Load'); assert.equal(m.from.email, CAR); assert.deepEqual(m.attachments, ['RateConfirmation.pdf']); assert.match(m.body, /Mike Jones/);
});

test('findExisting matches by shared company domain plus the same name, not by domain alone', () => {
  const cand = { mc: '', dot: '', email: 'a@swifthaul.example', emails: ['a@swifthaul.example'], phone: '', name: 'Swift Haul LLC' };
  assert.equal(findExisting(cand, [{ id: 'x', carrierName: 'Swift Haul', email: 'b@swifthaul.example' }]).length, 1);
  assert.equal(findExisting(cand, [{ id: 'y', carrierName: 'Other Carrier', email: 'b@swifthaul.example' }]).length, 0);
});
