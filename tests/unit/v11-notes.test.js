import test from 'node:test';
import assert from 'node:assert/strict';
import { processIncomingEmail } from '../../js/core/inbound.js';
import { blankPosting, initializeLoadControls } from '../../js/core/model.js';
import { DEFAULT_SETTINGS } from '../../js/core/defaults.js';
import { cleanNote, groupNote, detailsWithNote, applyLoadText } from '../../js/core/loaddetails.js';

const DETAILS = 'Pickup: Chicago, IL 60601\nDelivery: Atlanta, GA 30303\nWeight: 40000';
const posting = (over = {}) => { const p = blankPosting({ originCity: 'Chicago', originState: 'IL', destCity: 'Atlanta', destState: 'GA', targetRate: 1500, details: DETAILS, ...over }); initializeLoadControls(p); return p; };
const mail = (o) => ({ from: 'carrier@x.example', subject: 'Chicago, IL to Atlanta, GA', body: 'Is this still available?', ...o });
const reply = (p) => processIncomingEmail({ mail: mail(), postings: [p], inquiries: [], settings: DEFAULT_SETTINGS }).draft.body;

test('cleanNote: empty, whitespace and the macro "::" placeholder all mean "no note"', () => {
  assert.equal(cleanNote('::'), '');
  assert.equal(cleanNote('  \n '), '');
  assert.equal(cleanNote(undefined), '');
  assert.equal(cleanNote('  Need FMCSA sticker  '), 'Need FMCSA sticker');
});

test('first reply: note sits under the details and above the ETA / rate question', () => {
  const body = reply(posting({ notes: 'Need FMCSA sticker' }));
  const iDetails = body.indexOf('Weight: 40000'), iNote = body.indexOf('Need FMCSA sticker'), iAsk = body.indexOf('What is your best all-in rate? ETA to pickup?');
  assert.ok(iDetails > -1 && iNote > iDetails && iAsk > iNote, 'details < note < ask');
  assert.match(body, /Weight: 40000\r\n\r\nNeed FMCSA sticker\r\n\r\nWhat is your best all-in rate\? ETA to pickup\?/);
});

test('first reply: no note (or the "::" placeholder) leaves the reply exactly as before', () => {
  const plain = reply(posting({ notes: '' }));
  assert.equal(reply(posting({ notes: '::' })), plain);
  assert.ok(!plain.includes('::'));
  assert.match(plain, /Weight: 40000\r\n\r\nWhat is your best all-in rate\? ETA to pickup\?/);
});

test('a multi-line note keeps its lines and uses CRLF in the e-mail', () => {
  const body = reply(posting({ notes: 'Need FMCSA sticker\nNo-touch freight' }));
  assert.match(body, /Need FMCSA sticker\r\nNo-touch freight\r\n\r\nWhat is your best/);
});

test('a carrier who just asks "rate?" still gets the details, the note, then our target (not a request for their rate)', () => {
  const p = posting({ notes: 'Need FMCSA sticker' });
  const r = processIncomingEmail({ mail: mail({ body: 'rate?' }), postings: [p], inquiries: [], settings: DEFAULT_SETTINGS });
  assert.equal(r.action, 'inquiry-reply');
  assert.ok(r.draft.body.indexOf('Need FMCSA sticker') > r.draft.body.indexOf('Weight: 40000'));
  assert.ok(r.draft.body.indexOf('What is your ETA to pickup?') > r.draft.body.indexOf('Need FMCSA sticker'));
});

test('a carrier repeating our note back is not mistaken for an answer', () => {
  const p = posting({ notes: 'Need FMCSA sticker on the truck' });
  const r = processIncomingEmail({ mail: mail({ body: 'Need FMCSA sticker on the truck' }), postings: [p], inquiries: [], settings: DEFAULT_SETTINGS });
  assert.ok(['ignored', 'inquiry-reply'].includes(r.action));
  assert.notEqual(r.newInquiry && r.newInquiry.lastCarrierRate, 'x');
});

test('groupNote reads the Original first, then any other posting; detailsWithNote joins correctly', () => {
  assert.equal(groupNote([{ variant: 'Nearby 1', notes: 'b' }, { variant: 'Original', notes: 'a' }]), 'a');
  assert.equal(groupNote([{ variant: 'Original', notes: '::' }, { variant: 'Nearby 1', notes: 'b' }]), 'b');
  assert.equal(groupNote([]), '');
  assert.equal(detailsWithNote('D', 'N', '\n'), 'D\n\nN');
  assert.equal(detailsWithNote('D', '', '\n'), 'D');
  assert.equal(detailsWithNote('', 'N', '\n'), 'N');
});

test('applyLoadText writes details and note to every posting passed in (the whole load) and nothing else', () => {
  const g = [posting({ groupId: 'G1', variant: 'Original' }), posting({ groupId: 'G1', variant: 'Nearby 1' })];
  const other = posting({ groupId: 'G2', variant: 'Original' });
  applyLoadText(g, { details: 'NEW TEXT  \r\nline2', notes: '  Need sticker ' });
  for (const m of g) { assert.equal(m.details, 'NEW TEXT\nline2'); assert.equal(m.notes, 'Need sticker'); }
  assert.equal(other.details, DETAILS); assert.equal(other.notes, '');
  applyLoadText(g, { notes: '' });                       // clearing the note leaves the details alone
  assert.equal(g[1].notes, ''); assert.equal(g[1].details, 'NEW TEXT\nline2');
  applyLoadText(g, { notes: '::' });
  assert.equal(g[0].notes, '');
});
