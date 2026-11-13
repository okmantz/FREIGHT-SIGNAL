// Carrier e-mail understanding. Pure functions (no DOM, no Outlook): the browser app uses them directly, and the very same
// patterns are written into freight-signal-config.tsv so the Outlook macro (v6) applies identical rules.
//
// WHY THIS EXISTS. The first version looked for a rate anywhere in the e-mail body. A reply to your own message carries the
// whole earlier thread underneath it (your load details, "What is your best all-in rate? ETA to pickup?", dates, ZIP codes,
// weights ...), so a carrier who only wrote "rate?" could be read as quoting some number from the quoted text - and the app then
// drafted "Please confirm your ETA to pickup" and said "ready to book". The rules below fix that at the root:
//
//   1. freshText()      keeps ONLY what the carrier typed: quoted history, signatures and lines copied from our own text are removed.
//   2. extractRate()    finds a rate only in that fresh text, only in clearly rate-shaped phrases, and refuses ambiguous answers
//                       (two different amounts, "$2.50 per mile", numbers followed by lbs / miles / am / pm ...).
//   3. classify()       decides what the carrier MEANT (asked for our rate, asked if it is available, gave an ETA, accepted, declined,
//                       asked a question we cannot answer ...). Anything that is not clearly understood is "unclear" and is never answered.
//   4. planCarrierReply() turns that meaning + where the conversation stands into one reply (or no reply and a flag for you), and says
//                       whether the reply is safe to send without a human (autoSendSafe).

import { formatCurrency0 } from './util.js';
import { ladderReply, ladderStage, templatesOf, fillTemplate } from './ladder.js';

// ------------------------------------------------------------------------------------------------ the shared rule book
// Every entry is a regular-expression SOURCE (no flags). JS uses flags "i" / "gim"; the macro sets IgnoreCase + Multiline.
// Only features that VBScript.RegExp also supports are used (no look-behind, no named groups, no \p{...}).
const NUM = String.raw`(\d{1,3}(?:,\d{3})+|\d{3,5})(?:\.\d{1,2})?(?![0-9])`;
const UNIT_NEG = String.raw`(?!\s*(?:mi\b|miles?\b|lbs?\b|pounds?\b|ft\b|feet\b|foot\b|pallets?\b|plt\b|hrs?\b|hours?\b|a\.?m\b|p\.?m\b|%|/|:\d|-\s*\d|per\s*mi))`;
const LEAD = String.raw`(^|[^0-9a-z/:#.,-])`;
const KW = String.raw`rate|my rate|our rate|offer|counter|counter ?offer|bid|quote|price|asking|ask|looking for|need|want|all[ -]?in|total|(?:can|could|will|would|can you|could you|i can|we can)\s+do(?:\s+it|\s+this|\s+the load)?(?:\s+for|\s+at)?|do it for|do for|go for|go at|take(?:\s+it|\s+this)?(?:\s+for|\s+at)?|(?:haul|cover|run|move)(?:\s+it|\s+this)?(?:\s+for|\s+at)|works? (?:for|at)|deal (?:at|for)`;

export const RULES = {
  // A line that matches any of these ends the carrier's own text: everything from here down is history, signature or boilerplate.
  cutLine: [
    String.raw`^\s*-{2,}\s*(?:original|forwarded|reply)\s+message\s*-{2,}\s*$`,
    String.raw`^\s*_{5,}\s*$`,
    String.raw`^\s*on\s.{3,200}wrote:\s*$`,
    String.raw`^\s*sent from my\b.*$`,
    String.raw`^\s*sent from (?:outlook|mail|yahoo|gmail)\b.*$`,
    String.raw`^\s*sent via\b.*$`,
    String.raw`^\s*get outlook for\b.*$`,
    String.raw`^\s*--\s*$`,
    String.raw`^\s*(?:confidentiality|disclaimer)\b.*$`,
    String.raw`^\s*this (?:e-?mail|message)\b.{0,40}\b(?:confidential|intended)\b.*$`,
  ],
  // A sign-off ends the message only once the carrier has said something (a leading "Thanks," is just a greeting).
  signoffLine: String.raw`^\s*(?:thanks|thank you|thx|regards|best regards|kind regards|warm regards|best|sincerely|cheers|respectfully)\s*[,.!]*\s*$`,
  // Lines that are OUR wording coming back (a reply typed inside our message without quote marks).
  ownPhrase: String.raw`(?:best all-in rate|eta to pickup|how close can you come to|meet in the middle at|please confirm your eta|we are set at|it is still available\.)`,
  // ---- rates (only ever run on fresh text). Capture groups: rateDollar 1, rateKeyword 2, rateSuffix 2, rateK 2.
  rateDollar: String.raw`\$\s*${NUM}${UNIT_NEG}`,
  rateKeyword: String.raw`(^|[^a-z])(?:${KW})\b\s*(?:is\b|of\b|at\b|for\b|would be\b|will be\b|:|=|-)?\s*\$?\s*${NUM}${UNIT_NEG}`,
  rateSuffix: String.raw`${LEAD}${NUM}\s*(?:all[ -]?in\b|flat\b|fsc\b|plus fuel\b|\+\s*fuel\b|linehaul\b|lh\b|total\b|usd\b|dollars\b|bucks\b)`,
  rateK: String.raw`${LEAD}(\d{1,2}(?:\.\d{1,2})?)\s?k\b(?!\s*(?:lbs?|pounds?|mi\b|miles?|ft\b|feet))`,
  rateBare: String.raw`^\s*\$?\s*${NUM}\s*[.?!]*\s*$`,           // the whole message is just a number (applied to the whole text, not per line)
  phone: String.raw`\(?\d{3}\)?[\s.-]?\d{3}[\s.-]?\d{4}`,
  otherNum: String.raw`(?:^|[^0-9a-z/:.])(\d{1,3}(?:,\d{3})+|\d{3,5})(?![0-9])(?!\s*(?:mi\b|miles?\b|lbs?\b|am\b|pm\b|%|\/|:))`,
  perMile: String.raw`\$?\s*\d(?:\.\d{1,2})?\s*(?:/|per|a|x)\s*(?:mi|mile)\b|\brpm\b|\bper mile\b|\ba mile\b|\bcpm\b`,
  // ---- what the carrier meant (a message can hit several)
  stop: String.raw`\b(?:unsubscribe|remove me|take me off|stop (?:emailing|e-mailing|sending|contacting)|do not (?:contact|email|e-mail)|don'?t (?:contact|email|e-mail)|opt out|spam|wrong (?:e-?mail|address|person|number))\b`,
  decline: String.raw`\b(?:not interested|no,? thanks?|no thank you|i'?ll pass|we'?ll pass|will pass|pass on (?:this|it)|can'?t (?:do|make|cover|haul|help|take|run|get)|cannot (?:do|make|cover|haul|help|take|run)|can not (?:do|make|cover|haul|help|take|run)|unable to|won'?t be able to|(?:don'?t|do not) (?:have|run|haul|go|service|cover)|no (?:trucks?|capacity|power|drivers?)|not (?:available|going|running|able)|already (?:covered|booked|loaded|have a load)|got (?:covered|booked)|no longer)\b`,
  pushback: String.raw`\b(?:too (?:low|cheap)|not enough|won'?t work|doesn'?t work|does not work|no way|way too|lowball|can'?t do that|need more|needs? to be higher|higher than that)\b`,
  asksRate: [
    String.raw`\bhow much\b`,
    String.raw`\bwhat(?:'?s|s| is| are| r)?\s+(?:the |your |ur |my )?(?:best |bottom line |target )?(?:rate|pay|paying|price|offer|budget)\b`,
    String.raw`\bwhat (?:are|r) (?:you|u) (?:at|offering|paying|willing)\b`,
    String.raw`\bwhat(?:'?s|s| is) (?:it|this|that|the load) (?:pay|paying)\b`,
    String.raw`\bwhat does (?:it|this|that|the load) pay\b`,
    String.raw`\bwhat do (?:you|u) have (?:on it|for (?:it|this))\b`,
    String.raw`\bwhat can (?:you|u) pay\b`,
    String.raw`^\s*(?:the |your |ur |any )?(?:rate|rates|price|pay)\b[^.\n]{0,30}\??\s*$`,
    String.raw`\brate on (?:this|that|it)\b`,
    String.raw`\b(?:send|give|let me know|need|share|what about)\b[^.?\n]{0,20}\b(?:rate|price|pay)\b`,
  ],
  asksAvail: [
    String.raw`\bstill (?:available|open|there|on|good|up|have|got)\b`,
    String.raw`\bis (?:this|it|that|the load) (?:still )?(?:available|open)\b`,
    String.raw`\bavailable\s*\?`,
    String.raw`^\s*(?:available|open)\s*\?\s*$`,
  ],
  acceptWord: String.raw`^\s*(?:ok(?:ay)?|yes|yep|yeah|yup|sure|deal|agreed|done|perfect|works|sounds good|sounds great|that works|works for me|that'?s fine|i'?ll take it|we'?ll take it|let'?s do it|let'?s go|book it|accepted|confirmed?)\b`,
  accepts: String.raw`^\s*(?:ok(?:ay)?|yes|yep|yeah|yup|sure|deal|agreed|done|perfect|works|sounds good|sounds great|that works|works for me|that'?s fine|i'?ll take it|we'?ll take it|let'?s do it|let'?s go|book it|accepted|confirmed?)\b(?:[\s,.!-]+(?:thanks?|thank you|thx|ty|great|perfect|please|pls|sounds good|that works|works|deal|book it|let'?s do it|let'?s go|i will take it|we are good|all good|confirmed?|booked|ok(?:ay)?))*[\s,.!]*$`,
  condition: String.raw`\b(?:but|if|unless|however|except|as long as|provided|only if)\b`,
  givesEta: String.raw`\b(?:eta|can (?:be|get|pick|load)|could be|i'?ll be|i can be|will be|be there|available (?:today|tomorrow|now|asap)|ready (?:now|today|tomorrow)|empty (?:now|today|tomorrow|at)|loaded? (?:today|tomorrow)|pick ?up (?:today|tomorrow)|today|tomorrow|tonight|this (?:morning|afternoon|evening)|asap|within \d+|in \d+\s*(?:hrs?|hours?|mins?|minutes?)|\d{1,2}(?::\d{2})?\s*(?:am|pm))\b`,
  givesTruck: String.raw`\b(?:(?:i have|i got|we have|we got|have|got)\s+(?:a |an |one |two |\d+ )?(?:\d{2}'? ?)?(?:dry van|van|reefer|flatbed|step ?deck|truck|trucks|trailer|trailers|power only|box truck|sprinter|hot ?shot|unit|units|driver|drivers)|my truck|our truck|truck (?:is|in|at|available|open)|power only|empty in|deadhead|(?:dh|d/h)\s*\d+)\b`,
  // Questions / requests only a person should answer (liberal on purpose: a false hit means "look at it yourself", never a wrong reply).
  needsInfo: [String.raw`\bwhat(?:'?s| is) (?:it|the freight|being hauled|the load)\s*\?*\s*$`, String.raw`\b(?:weights?|how heavy|lbs?|pounds|commodity|dims?|dimensions|pallets?|piece count|pieces|how many|stops?|appointments?|appt|pick ?up (?:time|window|date)|deliver(?:y|ies) (?:time|window|date)|when (?:is|does|do|can|will)|what time|hours of operation|tarps?|team|hazmat|temperature|temp|detention|layover|lumper|tonu|payment|pay terms|quick ?pay|factoring|net ?\d+|rate ?con|ratecon|mc ?#?|dot|insurance|coi|packet|onboard|set ?up|load number|reference|po ?#?|address|shipper|receiver|consignee|how (?:far|long)|miles|photos?|pictures?|questions?)\b`],
  wantsCall: String.raw`\b(?:call me|give me a call|call (?:us|you)|can you call|please call|text me|my (?:cell|number|phone)|reach me|best number|phone number)\b`,
};

const CUT_RES = RULES.cutLine.map(s => new RegExp(s, 'i'));
const SIGNOFF_RE = new RegExp(RULES.signoffLine, 'i');
const mk = (src, flags = 'gim') => new RegExp(src, flags);
const anyOf = (srcOrList, text) => (Array.isArray(srcOrList) ? srcOrList : [srcOrList]).some(s => new RegExp(s, 'im').test(text));

/** Lines of normalised text, used to recognise lines copied back from our own message. */
export const normLine = (s) => String(s ?? '').toLowerCase().replace(/[^a-z0-9$]+/g, ' ').trim();

/**
 * 1. What the carrier actually typed. `ownText` = text we wrote or posted (load details, notes): any line copied back verbatim is dropped.
 * Order of work, line by line: stop at a quote / signature marker -> skip ">" quoted lines -> skip our own wording -> keep.
 */
export function freshText(body, ownText = '') {
  const lines = String(body ?? '').replace(/\r\n?/g, '\n').replace(/ /g, ' ').split('\n');
  const own = new Set(String(ownText ?? '').replace(/\r\n?/g, '\n').split('\n').map(normLine).filter(l => l.length >= 6));
  const ownPhrase = mk(RULES.ownPhrase, 'i');
  const out = [];
  for (let i = 0; i < lines.length; i++) {
    const ln = lines[i];
    if (CUT_RES.some(r => r.test(ln))) break;
    if (SIGNOFF_RE.test(ln)) { if (out.some(x => x.trim())) break; continue; }
    if (/^\s*on\s.{3,}$/i.test(ln) && i + 1 < lines.length && /wrote:\s*$/i.test(lines[i + 1])) break;     // Gmail wraps "On <date>, <name>\n wrote:"
    if (/^\s*from:\s/i.test(ln)) {                                                                          // Outlook's "From: / Sent: / To: / Subject:" block
      let hdr = 0;
      for (let j = i + 1; j <= Math.min(i + 7, lines.length - 1); j++) if (/^\s*(?:sent|date|to|subject|cc):/i.test(lines[j])) hdr++;
      if (hdr >= 2) break;
    }
    if (/^\s*>/.test(ln)) continue;
    if (ownPhrase.test(ln)) continue;
    if (own.has(normLine(ln))) continue;
    out.push(ln);
  }
  return out.join('\n').replace(/\n{3,}/g, '\n\n').trim();
}

/** True when the body carries our own wording (a message that is only our text coming back, e.g. a test sent to yourself). */
export const hasOwnPhrase = (body) => mk(RULES.ownPhrase, 'im').test(String(body ?? ''));

const toNum = (s) => { const n = parseFloat(String(s).replace(/,/g, '')); return Number.isFinite(n) ? n : 0; };

/**
 * 2. The rate in the carrier's own words. Returns { found, rate, candidates:[...], ambiguous, perMile }.
 * found = exactly one distinct plausible amount. Two different amounts ("1500, but 1400 if ...") or a per-mile rate are NOT guessed:
 * ambiguous / perMile are set and found is false.
 */
export function extractRate(fresh, settings = {}) {
  const lo = Number(settings.minReasonableRate) > 0 ? Number(settings.minReasonableRate) : 250;
  const hi = Number(settings.maxReasonableRate) > 0 ? Number(settings.maxReasonableRate) : 20000;
  const text = String(fresh ?? '');
  const cands = [];
  const add = (v) => { if (v >= lo && v <= hi && !cands.includes(v)) cands.push(v); };
  for (const m of text.matchAll(mk(RULES.rateDollar))) add(toNum(m[1]));
  for (const m of text.matchAll(mk(RULES.rateKeyword))) {
    const v = toNum(m[2]);
    if (!/\$/.test(m[0]) && v >= 2020 && v <= 2035) continue;          // "need 2026" is a year, not a rate
    add(v);
  }
  for (const m of text.matchAll(mk(RULES.rateSuffix))) add(toNum(m[2]));
  for (const m of text.matchAll(mk(RULES.rateK))) { const k = toNum(m[2]); if (k >= 0.25 && k <= 20) add(Math.round(k * 1000)); }
  const bare = new RegExp(RULES.rateBare).exec(text);
  if (bare) add(toNum(bare[1]));
  const perMile = mk(RULES.perMile).test(text);
  const ambiguous = cands.length > 1;
  return { found: cands.length === 1 && !perMile, rate: cands.length === 1 && !perMile ? cands[0] : 0, candidates: cands, ambiguous, perMile };
}

/** Other 3-5 digit amounts in the text (phone numbers excluded): "1500 but 1400 if I load Friday" has one. */
function otherNumbers(text, rate) {
  const t = String(text ?? '').replace(new RegExp(RULES.phone, 'g'), ' ');
  const out = [];
  for (const m of t.matchAll(new RegExp(RULES.otherNum, 'gi'))) { const v = toNum(m[1]); if (v !== rate && v >= 100) out.push(v); }
  return out;
}

/** Which of the meaning patterns hit this fresh text. */
export function tagsOf(fresh) {
  const t = String(fresh ?? '');
  const tags = {};
  for (const k of ['stop', 'decline', 'pushback', 'asksRate', 'asksAvail', 'givesEta', 'givesTruck', 'needsInfo', 'wantsCall', 'condition']) tags[k] = anyOf(RULES[k], t);
  const one = t.trim();
  tags.accepts = new RegExp(RULES.accepts, 'i').test(one) && !tags.condition && one.length <= 70;
  // "ok, can be there at 2pm" / "yes I have a truck": starts like a yes and adds timing or a truck, with no question
  tags.acceptsPlus = !tags.accepts && new RegExp(RULES.acceptWord, 'i').test(one) && !tags.condition && !/\?/.test(one) && (tags.givesEta || tags.givesTruck);
  return tags;
}

/**
 * 3. What the carrier meant. Returns { intent, tags, rate, fresh }.
 * intent: empty | stop | decline | mixed | rate | rate_unclear | pushback | wants_call | needs_info | accepts | asks_rate |
 *         asks_available | gives_eta | gives_truck | unclear
 */
export function classify(fresh, settings = {}) {
  const f = String(fresh ?? '').trim();
  const rate = extractRate(f, settings);
  const tags = tagsOf(f);
  let intent;
  if (!f) intent = 'empty';
  else if (tags.stop) intent = 'stop';
  else if (tags.decline && (rate.found || rate.ambiguous || rate.perMile)) intent = 'mixed';
  else if (tags.decline) intent = 'decline';
  else if (rate.ambiguous || rate.perMile) intent = 'rate_unclear';
  else if (rate.found && tags.condition && otherNumbers(f, rate.rate).length) intent = 'rate_unclear';
  else if (rate.found) intent = 'rate';
  else if (tags.pushback) intent = 'pushback';
  else if (tags.wantsCall) intent = 'wants_call';
  else if (tags.needsInfo) intent = 'needs_info';
  else if (tags.accepts || tags.acceptsPlus) intent = 'accepts';
  else if (tags.asksRate) intent = 'asks_rate';
  else if (tags.asksAvail) intent = 'asks_available';
  else if (tags.givesEta) intent = 'gives_eta';
  else if (tags.givesTruck) intent = 'gives_truck';
  else intent = 'unclear';
  return { intent, tags, rate, fresh: f };
}

/** Everything about one inbound e-mail in one call. `own` = load details + notes of the posting it belongs to. */
export function analyseCarrierEmail(body, own = '', settings = {}) {
  const fresh = freshText(body, own);
  const c = classify(fresh, settings);
  return { ...c, echo: !fresh && hasOwnPhrase(body) };
}

// ------------------------------------------------------------------------------------------------ 4. what to do about it
export const MAX_THREAD_EVENTS = 8;          // a thread longer than this is a conversation for a person

const FLAGS = {
  noRate: 'MANUAL REVIEW - NO RATE DETECTED',
  noTarget: 'MANUAL REVIEW - NO TARGET RATE',
  unclear: 'MANUAL REVIEW - CARRIER REPLY NOT UNDERSTOOD',
  questions: 'MANUAL REVIEW - CARRIER ASKED A QUESTION',
  call: 'CARRIER WANTS A CALL',
  pushback: 'MANUAL REVIEW - CARRIER PUSHED BACK ON RATE',
  rateUnclear: 'MANUAL REVIEW - MORE THAN ONE RATE OR PER-MILE RATE',
  rateWrong: 'MANUAL REVIEW - RATE LOOKS WRONG',
  declined: 'CARRIER DECLINED - NO REPLY',
  stop: 'DO NOT CONTACT - CARRIER ASKED TO STOP',
  agreed: 'RATE AGREED - BOOK IT',
  eta: 'ETA RECEIVED - BOOK IT',
  long: 'MANUAL REVIEW - LONG THREAD',
  closed: 'FOLLOW-UP - MANUAL REVIEW - NO AUTO REPLY',
};
export const REPLY_FLAGS = FLAGS;

const manual = (flag, reason, extra = {}) => ({ kind: 'none', text: '', flag, reason, autoSendSafe: false, stageNext: null, ...extra });

/**
 * state = { stage, ladderStage, ourRate, events } : where the conversation stands (stage names as in the Inquiry Log).
 * Returns { kind, text, flag, reason, stageNext, ladderNext, ourRateNext, ladder?, autoSendSafe, intent }
 *   kind: ladder | asks_rate | available | need_rate | need_rate_eta | agreed | none
 * `text` is the sentence(s) to put above the quoted thread. kind 'none' = nothing is drafted; `flag` says why a person should look.
 */
export function planCarrierReply({ analysis, target, settings = {}, state = {} }) {
  const a = analysis; const t = Number(target) || 0;
  const stage = String(state.stage || 'INQUIRY_REPLY_SENT').toUpperCase();
  const events = Number(state.events) || 0;
  const tpl = templatesOf(settings);
  const done = (r) => ({ intent: a.intent, ...r });
  const questions = a.tags.needsInfo || a.tags.wantsCall || a.tags.pushback;

  if (a.echo) return done({ ...manual('', 'This message is only our own wording coming back (for example a test sent to yourself).'), kind: 'none', ignore: true });
  if (a.intent === 'stop') return done(manual(FLAGS.stop, 'The carrier asked not to be contacted.', { stageNext: 'DECLINED' }));
  if (a.intent === 'decline') return done(manual(FLAGS.declined, 'The carrier is not interested or cannot cover it.', { stageNext: 'DECLINED' }));

  // a finished conversation never gets another automatic reply (but an ETA after "book it" is worth shouting about)
  if (stage === 'DECLINED' || stage === 'ETA_RECEIVED') return done(manual(FLAGS.closed, 'This conversation is already finished; a new e-mail needs a person.', { stageNext: stage }));
  if (events >= MAX_THREAD_EVENTS) return done(manual(FLAGS.long, 'Long thread - a person should take over.'));
  const afterBook = stage === 'AGREED' || (stage === 'RATE_RESPONSE_SENT' && state.ladderStage === 'book');
  if (afterBook && (a.intent === 'gives_eta' || (a.intent === 'accepts' && a.tags.givesEta))) return done(manual(FLAGS.eta, 'The carrier answered the ETA question: book it.', { stageNext: 'ETA_RECEIVED' }));
  if (stage === 'AGREED') return done(manual(FLAGS.closed, 'The rate is already agreed; anything further needs a person.', { stageNext: 'AGREED' }));
  if (afterBook && a.intent !== 'rate') return done(manual(FLAGS.closed, 'The carrier already has a book-it reply; anything further needs a person.', { stageNext: 'FOLLOWUP_FLAGGED' }));

  switch (a.intent) {
    case 'empty': return done(manual(FLAGS.noRate, 'The e-mail has no new text from the carrier (only quoted history or an attachment).', { stageNext: 'FOLLOWUP_FLAGGED' }));
    case 'mixed': return done(manual(FLAGS.unclear, 'The carrier both declined and mentioned a rate: read it yourself.', { stageNext: 'FOLLOWUP_FLAGGED' }));
    case 'rate_unclear': return done(manual(FLAGS.rateUnclear, a.rate.perMile ? 'The carrier quoted a per-mile rate.' : 'The carrier mentioned more than one amount (' + a.rate.candidates.map(formatCurrency0).join(', ') + ').', { stageNext: 'FOLLOWUP_FLAGGED' }));
    case 'pushback': return done(manual(FLAGS.pushback, 'The carrier said the rate does not work.', { stageNext: 'FOLLOWUP_FLAGGED' }));
    case 'wants_call': return done(manual(FLAGS.call, 'The carrier asked you to call or text.', { stageNext: 'FOLLOWUP_FLAGGED' }));
    case 'needs_info': return done(manual(FLAGS.questions, 'The carrier asked something only a person should answer.', { stageNext: 'FOLLOWUP_FLAGGED' }));
    case 'unclear': return done(manual(FLAGS.unclear, 'The reply was not clearly a rate, a question about the rate, an ETA or an answer.', { stageNext: 'FOLLOWUP_FLAGGED' }));
    case 'accepts': {
      const our = Number(state.ourRate) || 0;
      if (our > 0 && stage === 'RATE_RESPONSE_SENT' && state.ladderStage !== 'book' && a.tags.givesEta) return done(manual(FLAGS.agreed + ' (ETA GIVEN)', 'The carrier agreed to ' + formatCurrency0(our) + ' and gave an ETA: book it.', { stageNext: 'ETA_RECEIVED' }));
      if (!(our > 0) || !(stage === 'RATE_RESPONSE_SENT') || state.ladderStage === 'book') return done(manual(FLAGS.unclear, '"Yes / ok" but there is no counter on the table to agree to.', { stageNext: 'FOLLOWUP_FLAGGED' }));
      return done({ kind: 'agreed', text: fillTemplate(tpl.agreed, { ourRate: formatCurrency0(our), target: formatCurrency0(t) }), flag: FLAGS.agreed, reason: 'The carrier agreed to ' + formatCurrency0(our) + '.',
        stageNext: 'AGREED', ladderNext: 'book', ourRateNext: our, autoSendSafe: true });
    }
    case 'rate': {
      const r = a.rate.rate;
      if (!(t > 0)) return done(manual(FLAGS.noTarget, 'Carrier rate ' + formatCurrency0(r) + ' received, but this posting has no target rate to compare it with.', { stageNext: 'FOLLOWUP_RECEIVED', rate: r }));
      if (r < t * 0.5 || r > t * 3) return done(manual(FLAGS.rateWrong, 'Carrier rate ' + formatCurrency0(r) + ' is far from the ' + formatCurrency0(t) + ' target: check it is a real quote.', { stageNext: 'FOLLOWUP_RECEIVED', rate: r }));
      const lad = ladderReply(r, t, settings);
      const flag = lad.stage === 'book' ? 'RATE RECEIVED - REVIEW / ETA' : lad.stage === 'split' ? 'RATE RECEIVED - SPLIT COUNTER DRAFTED' : '';
      const our = lad.stage === 'split' ? lad.split : lad.stage === 'target' ? t : r;
      return done({ kind: 'ladder', text: lad.text, flag, reason: 'Carrier rate ' + formatCurrency0(r) + ' vs target ' + formatCurrency0(t) + ' (' + (lad.pct >= 0 ? '+' : '') + lad.pct.toFixed(1) + '%).',
        stageNext: 'RATE_RESPONSE_SENT', ladderNext: lad.stage, ourRateNext: our, rate: r, ladder: { stage: lad.stage, pct: lad.pct, split: lad.split },
        autoSendSafe: !questions && !a.tags.condition });
    }
    case 'asks_rate': {
      if (!(t > 0)) return done(manual(FLAGS.noTarget, 'The carrier asked for the rate but this posting has no target rate yet.', { stageNext: 'FOLLOWUP_FLAGGED' }));
      const lead = a.tags.asksAvail ? tpl.availableLead + ' ' : '';
      return done({ kind: 'asks_rate', text: lead + fillTemplate(tpl.askRate, { target: formatCurrency0(t) }), flag: '', reason: 'The carrier asked what the rate is: answered with your target.',
        stageNext: 'RATE_RESPONSE_SENT', ladderNext: 'target', ourRateNext: t, autoSendSafe: true });
    }
    case 'asks_available':
      return done({ kind: 'available', text: tpl.available, flag: '', reason: 'The carrier asked whether the load is still available.', stageNext: 'FOLLOWUP_RECEIVED', autoSendSafe: true });
    case 'gives_eta':
      return done({ kind: 'need_rate', text: tpl.needRate, flag: '', reason: 'The carrier gave timing but no rate.', stageNext: 'FOLLOWUP_RECEIVED', autoSendSafe: true });
    case 'gives_truck':
      return done({ kind: 'need_rate_eta', text: tpl.needRateEta, flag: '', reason: 'The carrier described a truck but gave no rate or ETA.', stageNext: 'FOLLOWUP_RECEIVED', autoSendSafe: true });
    default: return done(manual(FLAGS.unclear, 'Not understood.', { stageNext: 'FOLLOWUP_FLAGGED' }));
  }
}

export { ladderStage };
