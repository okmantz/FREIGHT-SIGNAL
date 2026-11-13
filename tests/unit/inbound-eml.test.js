import test from 'node:test';
import assert from 'node:assert/strict';
import { processIncomingEmail, extractCarrierRate } from '../../js/core/inbound.js';
import { buildEml, mailtoUrl, owaComposeUrl } from '../../js/core/eml.js';
import { makeZip, crc32 } from '../../js/core/ziparchive.js';
import { blankPosting, initializeLoadControls } from '../../js/core/model.js';
import { DEFAULT_SETTINGS } from '../../js/core/defaults.js';

const posting = () => { const p = blankPosting({ originCity: 'Chicago', originState: 'IL', destCity: 'Atlanta', destState: 'GA', targetRate: 1500, details: 'Pickup: Chicago, IL 60601\nDelivery: Atlanta, GA 30303' }); initializeLoadControls(p); return p; };
const mail = (o) => ({ from: 'carrier@x.example', subject: 'Chicago, IL to Atlanta, GA', body: 'Is this still available?', ...o });

test('rate extraction', () => {
  assert.equal(extractCarrierRate('', 'I can do $1650 all in').rate, 1650);
  assert.equal(extractCarrierRate('', 'total $12000').rate, 12000);
  assert.equal(extractCarrierRate('', 'total $12,000').rate, 12000, 'v8: comma rates are always recognised');
  const fixed = { ...DEFAULT_SETTINGS, recogniseCommaRates: true };
  assert.equal(extractCarrierRate('', 'I can do $1,650 all in', fixed).rate, 1650);
  assert.equal(extractCarrierRate('', 'total $12,000', fixed).rate, 12000);
  assert.equal(extractCarrierRate('', 'rate 1650', fixed).rate, 1650);
  assert.equal(extractCarrierRate('', 'I can do $1,650 all in').rate, 1650, 'v8: $1,650 is read correctly');
  assert.equal(extractCarrierRate('', 'no number here').found, false);
  assert.equal(extractCarrierRate('', 'MC 123456 call 555-0100').found, false, 'ids and phone numbers are not rates');
  assert.equal(extractCarrierRate('', 'I can do $50').found, false, 'below the plausible minimum');
});
test('new inquiry: matches the posting, logs it, drafts a reply (never sends)', () => {
  const p = posting();
  const r = processIncomingEmail({ mail: mail(), postings: [p], inquiries: [], settings: DEFAULT_SETTINGS });
  assert.equal(r.action, 'inquiry-reply');
  assert.equal(r.newInquiry.stage, 'INQUIRY_REPLY_SENT'); assert.equal(r.postingPatch.patch.inquiryCount, 1);
  assert.ok(r.draft.body.includes('What is your best all-in rate? ETA to pickup?')); assert.match(r.draft.subject, /^RE:/);
});
test('no matching lane -> no draft', () => {
  const r = processIncomingEmail({ mail: mail({ subject: 'hello', body: 'hi' }), postings: [posting()], inquiries: [], settings: DEFAULT_SETTINGS });
  assert.equal(r.action, 'no-match'); assert.equal(r.draft, undefined);
});
test('filters: blocklist, automated, forwards', () => {
  const s = { ...DEFAULT_SETTINGS, inboundBlocklist: ['x.example'] };
  assert.equal(processIncomingEmail({ mail: mail(), postings: [posting()], inquiries: [], settings: s }).action, 'ignored');
  assert.equal(processIncomingEmail({ mail: mail({ from: 'mailer-daemon@y.example' }), postings: [posting()], inquiries: [] }).action, 'ignored');
  assert.equal(processIncomingEmail({ mail: mail({ subject: 'FW: Chicago, IL to Atlanta, GA' }), postings: [posting()], inquiries: [] }).action, 'ignored');
});
test('conversation: rate far from target -> negotiate; near target -> ETA; then repeat -> flagged', () => {
  const p = posting(); const inq = [];
  const first = processIncomingEmail({ mail: mail(), postings: [p], inquiries: inq });
  const rec = { id: 'q1', ...first.newInquiry }; inq.push(rec);
  const far = processIncomingEmail({ mail: mail({ body: 'I can do $2400' }), postings: [p], inquiries: inq });
  assert.equal(far.action, 'rate-negotiate'); assert.ok(far.draft.body.startsWith('How close can you come to $1,500?'));
  Object.assign(rec, far.inquiryPatch.patch);
  assert.equal(rec.stage, 'RATE_RESPONSE_SENT');
  const again = processIncomingEmail({ mail: mail({ body: 'any update?' }), postings: [p], inquiries: inq });
  assert.equal(again.action, 'flag-manual'); assert.equal(again.draft, undefined); assert.ok(again.flag, 'v8: an unreadable repeat is flagged for a person');
  const rec2 = { id: 'q2', ...processIncomingEmail({ mail: mail({ from: 'b@x.example' }), postings: [p], inquiries: [] }).newInquiry }; 
  const near = processIncomingEmail({ mail: mail({ from: 'b@x.example', body: '$1540 works' }), postings: [p], inquiries: [rec2] });
  assert.equal(near.action, 'rate-within-target'); assert.ok(near.draft.body.startsWith('Please confirm your ETA to pickup.'));
  // 6.7% over target is the split-the-difference stage (percent ladder: book <= 3%, split <= 8%)
  const rec3 = { id: 'q3', ...processIncomingEmail({ mail: mail({ from: 'c@x.example' }), postings: [p], inquiries: [] }).newInquiry };
  const split = processIncomingEmail({ mail: mail({ from: 'c@x.example', body: '$1600 works' }), postings: [p], inquiries: [rec3] });
  assert.equal(split.action, 'rate-split'); assert.ok(split.draft.body.startsWith('Can we meet in the middle at $1,550?'), split.draft.body);
});
test('.eml is an UNSENT draft with a decodable UTF-8 body', () => {
  const eml = buildEml({ to: 'a@b.example', subject: 'Café – load', body: 'Line1\nLine2 é' });
  assert.ok(eml.startsWith('X-Unsent: 1\r\n')); assert.ok(/Subject: =\?UTF-8\?B\?/.test(eml));
  const b64 = eml.split('\r\n\r\n')[1].replace(/\r\n/g, '');
  assert.equal(Buffer.from(b64, 'base64').toString('utf8'), 'Line1\r\nLine2 é');
  assert.ok(!/^Bcc:|^From:/m.test(eml), 'no sender is invented');
});
test('mailto / OWA links are encoded', () => {
  const u = mailtoUrl({ to: 'a@b.example', subject: 'A & B', body: 'x\ny' });
  assert.ok(u.startsWith('mailto:a@b.example?subject=A%20%26%20B&body=x%0D%0Ay'));
  assert.ok(owaComposeUrl({ to: 'a@b.example', subject: 's', body: 'b' }).startsWith('https://outlook.office.com/mail/deeplink/compose?'));
});
test('store-only ZIP writer: CRC32 and archive structure', () => {
  assert.equal(crc32(new TextEncoder().encode('123456789')), 0xCBF43926);
  const z = makeZip([{ name: 'a.eml', data: 'hello' }, { name: 'b.eml', data: 'world!' }]);
  const dv = new DataView(z.buffer, z.byteOffset, z.byteLength);
  assert.equal(dv.getUint32(0, true), 0x04034b50);
  assert.equal(dv.getUint32(z.length - 22, true), 0x06054b50); assert.equal(dv.getUint16(z.length - 22 + 10, true), 2);
});
