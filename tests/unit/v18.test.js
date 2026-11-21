// v18: Owen's brain, workspace answers, reply lessons and the email patches.
import test from 'node:test';
import assert from 'node:assert/strict';
import { answer } from '../../js/core/owen.js';
import { evalMath, rangeOf } from '../../js/core/owentext.js';
import { teach, findLesson, applyLessons, signature, cleanLessons, LEARN_AUTO } from '../../js/core/replylearn.js';
import { analyseCarrierEmail, planCarrierReply } from '../../js/core/carrierreply.js';
import { DEFAULT_SETTINGS as S } from '../../js/core/defaults.js';

const NOW = Date.parse('2026-11-18T15:00:00');   // a Wednesday
const lane = { originCity: 'Chicago', originState: 'IL', destCity: 'Atlanta', destState: 'GA' };
const cover = (rate, hoursAgo, carrier = { name: 'ACME Trucking', email: 'dispatch@acme.example' }) => ({ outcome: 'Covered', closedAt: new Date(NOW - hoursAgo * 3600e3).toISOString(), rate, targetRate: rate - 100, ageHours: 5, lane, covered: lane, carrier, broker: 'Sam' });
const data = {
  now: NOW, name: 'Owen Smith', held: 2,
  loads: [{ id: 'L1', title: 'Chicago, IL to Atlanta, GA', oCity: 'Chicago', oState: 'IL', dCity: 'Atlanta', dState: 'GA', ageMin: 200, inquiries: 0, matches: 1, stuckScore: 6, postings: 1, targetRate: 1750, keys: ['Chicago'] },
          { id: 'L2', title: 'Dallas, TX to Denver, CO', oCity: 'Dallas', oState: 'TX', dCity: 'Denver', dState: 'CO', ageMin: 30, inquiries: 2, matches: 0, stuckScore: 1, postings: 9, keys: ['Dallas'] }],
  covers: [cover(1800, 3), cover(1700, 30), cover(1900, 80)],
  pace: { today: 1, week: 12, floor: 50, projection: 30, status: 'short', need: 38, daysLeft: 3, perDay: 13 },
  carriers: [{ id: 'c1', carrierName: 'ACME Trucking', email: 'dispatch@acme.example', mc: '123456', phone: '312-555-0100', coverCount: 3 }], customers: [], inquiries: [],
  trucks: [{ carrierName: 'Joe Hauling', oCity: 'Dallas', oState: 'TX', equip: 'V', at: NOW - 3600e3, phone: '214-555-0101' }], settings: { weeklyFloor: 50, brokers: ['Sam'], sendMode: 'shadow' },
};
const ask = (q, mem = {}) => answer(q, { loads: data.loads, data, mem, rand: () => 0 });

test('Owen answers small talk, grounded in the real board', () => {
  for (const q of ['How are you?', 'how r u', "how's it going", 'hows life', "what's up"]) { const r = ask(q); assert.equal(r.topic, 'social', q); assert.match(r.text, /2 open loads|open load/); }
  assert.equal(ask('hello').topic, 'social'); assert.match(ask('good morning').text, /Good morning, Owen/);
  assert.equal(ask('tell me a joke').topic, 'social'); assert.equal(ask('who are you').topic, 'social');
  assert.equal(ask('I am so stressed today').topic, 'social');
  assert.match(ask('what can you do').steps.join(' '), /Analyse your week/);
});
test('Owen reads the user\'s own data', () => {
  assert.equal(ask('give me a summary').topic, 'summary');
  assert.equal(ask('what should I work on first').topic, 'priority');
  assert.match(ask('how am I doing this week').text, /12 covers/);
  assert.match(ask('what did Chicago to Atlanta cover at').text, /\$1,800/);
  assert.equal(ask('tell me about the Dallas load').topic, 'load');
  assert.match(ask('who is acme trucking').text, /ACME Trucking/);
  assert.match(ask('any trucks near Dallas').rows[0][0], /Joe Hauling/);
  assert.equal(ask('analyze my business').topic, 'insights');
  assert.match(ask('how many open loads do I have').text, /2 open loads/);
  assert.match(ask('what is my weekly floor').text, /50/);
});
test('Owen does maths and freight definitions', () => {
  assert.match(ask('1800 for 715 miles').text, /\$2\.52 per mile/);
  assert.match(ask('sell 2000 buy 1700 margin').text, /15\.0% margin/);
  assert.match(ask('what is 15% of 2000').text, /300/);
  assert.equal(evalMath('2+3*4'), 14); assert.equal(evalMath('process.exit()'), null);
  assert.equal(ask('what is deadhead').topic, 'glossary'); assert.equal(ask('what does TONU mean').topic, 'glossary');
  assert.equal(ask('what is the difference between margin and markup').topic, 'glossary');
});
test('Owen keeps its old behaviour: navigation, stuck loads, off-topic, unknown', () => {
  assert.equal(ask('where is the carrier database').topic, 'carrierdb');
  assert.equal(ask('this load is stuck what would owen do').topic, 'stuck');
  assert.equal(ask("what's the weather").topic, 'offtopic'); assert.equal(ask('qwertyuiop').topic, 'unknown'); assert.equal(ask('').topic, 'empty');
  assert.ok(answer('how are you').text.length > 10);                       // works with no workspace data at all
});
test('Owen understands date words', () => {
  const r = rangeOf('covers yesterday', NOW); assert.equal(r.label, 'yesterday'); assert.ok(r.to - r.from === 86400000);
  assert.ok(rangeOf('how many covers last week', NOW).from < rangeOf('this week', NOW).from);
});

test('email: new patterns are read, nothing that was a rate changed', () => {
  const read = (b) => analyseCarrierEmail(b, '', S).intent;
  assert.equal(read('Is this still covered?'), 'asks_available'); assert.equal(read('Load booked already'), 'decline'); assert.equal(read('still waiting on your rate'), 'asks_rate');
  assert.equal(read("whats the lowest you can go"), 'asks_rate'); assert.equal(read('Where do I send the invoice?'), 'needs_info'); assert.equal(read('Any update?'), 'checking');
  assert.equal(read('hello'), 'unclear'); assert.equal(read('1800 all in'), 'rate');
  const p = planCarrierReply({ analysis: analyseCarrierEmail('Checking in on this one', '', S), target: 1700, settings: S, state: {} });
  assert.equal(p.kind, 'none'); assert.ok(p.suggest);                       // never auto-answered
  const t = planCarrierReply({ analysis: analyseCarrierEmail('I have a truck in Joliet tomorrow', '', S), target: 1700, settings: S, state: {} });
  assert.equal(t.kind, 'need_rate'); assert.equal(t.truckLead, true);
});

test('reply lessons: only upgrade unclear messages, never rates, never send themselves until confirmed', () => {
  const words = 'we gotta see what lane looks good for ours';
  assert.equal(analyseCarrierEmail(words, '', S).intent, 'unclear');
  let r = teach([], words, 'asks_available'); assert.ok(r.ok);
  const a1 = applyLessons(analyseCarrierEmail(words, '', S), r.lessons);
  assert.equal(a1.intent, 'asks_available'); assert.equal(a1.learned.count, 1);
  const p1 = planCarrierReply({ analysis: a1, target: 1700, settings: S, state: {} });
  assert.equal(p1.kind, 'available'); assert.equal(p1.autoSendSafe, false);   // taught once: for review
  for (let i = 1; i < LEARN_AUTO; i++) r = teach(r.lessons, words, 'asks_available');
  const a3 = applyLessons(analyseCarrierEmail(words, '', S), r.lessons);
  assert.equal(planCarrierReply({ analysis: a3, target: 1700, settings: S, state: {} }).autoSendSafe, true);
  // a lesson never changes a message the rules understood (rate, decline) and never teaches an unknown meaning
  const rateMsg = analyseCarrierEmail('1800 all in', '', S); assert.equal(applyLessons(rateMsg, r.lessons).intent, 'rate');
  assert.equal(teach([], 'anything here', 'rate').ok, false);
  // near-identical wording matches, different wording does not, numbers are ignored
  assert.ok(findLesson(r.lessons, 'We gotta see what lane looks good for ours!!'));
  assert.equal(findLesson(r.lessons, 'completely different sentence about trucks'), null);
  assert.equal(signature('Can you do 1800?'), signature('can you do 1750'));
  assert.equal(cleanLessons([{ sig: 'x', intent: 'hack' }, null, 5]).length, 0);
});
