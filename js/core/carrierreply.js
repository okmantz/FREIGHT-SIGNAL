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
//
// v16 (Email Reliability Lab): found by running ~150 realistic carrier replies through the v15 rules (tests/fixtures/email-corpus.json).
//   * Rates the old rules MISSED are now read, with a confidence: "strong" (a rate-shaped phrase) or "weak" (a lone plausible number that is not a
//     phone, ZIP, MC/DOT, street number, date, time or quantity). A weak rate is drafted but NEVER sent without you.
//       "1650 can be there by 3pm" used to be read as "gives ETA" and answered with "what is your rate?": a wrong reply, now fixed.
//   * Negotiation can no longer go backwards (a counter lower than your previous counter) or loop (same answer twice), and "ok" / "1450 works"
//     to your counter is recognised as agreement.
//   * Every message gets an answer for you to review (a suggested draft), except the ones that should never get one (stop, decline, thanks only,
//     out-of-office). The suggested draft is never auto-sent.
//   * New meanings: wants_details, asks_other_loads (a truck lead), gives_info (MC/DOT), redirect, ack, ooo.

import { formatCurrency0 } from './util.js';
import { ladderReply, ladderStage, templatesOf, fillTemplate } from './ladder.js';

// ------------------------------------------------------------------------------------------------ the shared rule book
// Every entry is a regular-expression SOURCE (no flags). JS uses flags "i" / "gim"; the macro sets IgnoreCase + Multiline.
// Only features that VBScript.RegExp also supports are used (no look-behind, no named groups, no \p{...}).
const NUM = String.raw`(\d{1,3}(?:,\d{3})+|\d{3,5})(?:\.\d{1,2})?(?![0-9])`;
// UNIT_NEG: the number must NOT be followed (on the SAME line) by a unit or an extra charge: miles, lbs, deadhead, a lumper / detention fee ...
// Same line only ([ \t]*, never \s*): with \s* the first word of the NEXT line ("Miles 715", "DH 700") cancelled a rate typed at the end of the line above.
const UNIT_NEG = String.raw`(?![ \t]*(?:(?:[nsew]|ne|nw|se|sw)\b\.?[ \t]+[a-z]|(?:st|street|ave|avenue|blvd|rd|road|dr|drive|ln|hwy|highway|pkwy)\b|mi\b|miles?\b|lbs?\b|pounds?\b|ft\b|feet\b|foot\b|pallets?\b|plt\b|hrs?\b|hours?\b|a\.?m\b|p\.?m\b|dh\b|dead[ \t]*head|mpg\b|stops?\b|loads?\b|trucks?\b|units?\b|cents?\b|(?:for[ \t]+)?(?:the[ \t]+|a[ \t]+)?(?:lumpers?|detention|tonu|layover|deposit|fees?|surcharge|advance|quick[ \t]?pay|stop[ \t-]?off)\b|%|/|:\d|-[ \t]*\d|per[ \t]*mi))`;
const LEAD = String.raw`(^|[^0-9a-z/:#.,-])`;
const KW = String.raw`per load|per truck|for the load|rate|my rate|our rate|offer|counter|counter ?offer|bid|quote|price|asking|ask|looking for|need|want|all[ -]?in|total|my best(?: rate)?|best(?: rate)?|bottom line|lowest|minimum|min|floor|i'?m at|im at|we'?re at|usd|ok(?:ay)?|yes|deal|agreed|sure|how about|what about|make it|come up to|go up to|bump(?: it)? to|raise(?: it)? to|meet(?: me)? at|split at|(?:can|could|will|would)\s+(?:you|u)\s+(?:do|pay|go|add)|(?:can|could|will|would|can you|could you|i can|we can)\s+do(?:\s+it|\s+this|\s+the load)?(?:\s+for|\s+at)?|do it for|do for|go for|go at|take(?:\s+it|\s+this)?(?:\s+for|\s+at)?|(?:haul|cover|run|move)(?:\s+it|\s+this)?(?:\s+for|\s+at)|works? (?:for|at)|deal (?:at|for)`;

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
  rateSuffix: String.raw`${LEAD}${NUM}[ \t]*(?:all[ -]?in\b|flat\b|\+\s*fsc\b|(?:is|as) my (?:best|rate|lowest|final)\b|for the load\b|per load\b|per truck\b|fsc\b|plus fuel\b|\+\s*fuel\b|line ?haul\b|lh\b|total\b|usd\b|dollars\b|bucks\b)`,
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
    String.raw`\bavail\s*\?`,
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
  needsInfo: [String.raw`\b(?:live load|live unload|drop (?:and|&|n) hook|dedicated|place to park|parking|(?:needs?|has) to be (?:a )?(?:reefer|dry|van|flatbed))\b`, String.raw`\bwhat(?:'?s| is) (?:it|the freight|being hauled|the load)\s*\?*\s*$`, String.raw`\b(?:weights?|how heavy|lbs?|pounds|commodity|dims?|dimensions|pallets?|piece count|pieces|how many|stops?|appointments?|appt|pick ?up (?:time|window|date)|deliver(?:y|ies) (?:time|window|date)|when (?:is|does|do|can|will)|what time|hours of operation|tarps?|team|hazmat|temperature|temp|detention|layover|lumper|tonu|payment|pay terms|quick ?pay|factoring|net ?\d+|rate ?con|ratecon|mc ?#?|dot|insurance|coi|packet|onboard|set ?up|load number|reference|po ?#?|address|shipper|receiver|consignee|how (?:far|long)|miles|photos?|pictures?|questions?)\b`],
  wantsCall: String.raw`\b(?:call me|give me a call|call (?:us|you)|can you call|please call|text me|txt me|my (?:cell|number|phone)|reach me|best number|phone number)\b`,
  // ---- v16 additions (all VBScript-RegExp safe: no lookbehind, no named groups, no \p{})
  rateUsdAfter: String.raw`${LEAD}${NUM}[ \t]*(?:\$|usd\b|dlls?\b|dollars?\b|bucks\b)`,
  rateUsdBefore: String.raw`\busd\s*\$?\s*${NUM}${UNIT_NEG}`,
  rateOkNum: String.raw`^\s*(?:ok(?:ay)?|yes|yep|sure|deal|agreed|done|fine)\b[\s,.:!-]*\$?\s*${NUM}${UNIT_NEG}`,
  rateWorks: String.raw`${LEAD}\$?\s*${NUM}[ \t]*(?:works?|firm|min(?:imum)?|or better|or more|no less|and it'?s a deal|is good|is fine|is ok(?:ay)?)\b`,
  rateHundred: String.raw`(?:^|[^a-z0-9])(ten|eleven|twelve|thirteen|fourteen|fifteen|sixteen|seventeen|eighteen|nineteen|twenty|twenty[ -]?one|twenty[ -]?two|twenty[ -]?three|twenty[ -]?four|twenty[ -]?five|1[0-9]|2[0-5])\s+hundred\b`,
  weakNum: String.raw`(?:^|[^0-9a-z/:.#$,-])(\d{1,2},\d{3}|\d{4})(?![0-9])(?!\s*(?:mi\b|miles?\b|lbs?\b|pounds\b|am\b|pm\b|%|\/|:|ft\b|feet\b|x\b|pallets?\b|pcs\b|units?\b))`,
  noiseId: String.raw`\b(?:mc|dot|usdot|ref|reference|po|pro|bol|load|order|confirmation|conf|ticket|invoice|tel|ext)\s*(?:#|no\.?|number|num)?\s*[:#-]?\s*[a-z]{0,3}\d[\d-]*`,
  noiseAddress: String.raw`\b\d{1,6}\s+(?:[nsew]\.?\s+|ne\s+|nw\s+|se\s+|sw\s+)?[a-z0-9.]+(?:\s+[a-z0-9.]+){0,2}\s+(?:st|street|ave|avenue|blvd|boulevard|rd|road|dr|drive|ln|lane|hwy|highway|pkwy|parkway|way|ct|court|pl|place|cir|circle)\b\.?`,
  noiseZip: String.raw`\b[a-z]{2}[ ,]+\d{5}(?:-\d{4})?\b|\b\d{5}(?:-\d{4})\b`,
  noiseDate: String.raw`\b\d{1,2}[/.-]\d{1,2}(?:[/.-]\d{2,4})?\b`,
  noiseTime: String.raw`\b(?:pick ?up|pickup|load|loading|deliver|delivery|be there|arrive|arriving|there|empty|ready|eta|by|before|after|until|till|@)\s+(?:at|by|@)?\s*\d{3,4}\b|\b\d{1,2}(?::\d{2})?\s*(?:am|pm|a\.m\.|p\.m\.|hrs|hours?|h)\b|\b\d{3,4}\s*(?:hrs|hours)\b`,
  rateRange: String.raw`(\d{3,5})\s*(?:-|to|or|/)\s*\$?(\d{3,5})(?![0-9])`,
  extras: String.raw`\b(?:lumper|detention|tonu|truck ?order not used|layover|quick ?pay|factoring fee|fuel advance|comchek|t-?chek|extra stops?|stop[- ]?off|tarps?|driver assist|liftgate|lift gate|escort|permit)\b`,
  questionRate: String.raw`^\s*(?:is|are|was|so|that'?s|that is|it'?s)\b[^.?\n]{0,25}\$?\s*(?:\d{1,3}(?:,\d{3})+|\d{3,5})\s*\?\s*$|^\s*(?:so\s+)?\$?\s*(?:\d{1,3}(?:,\d{3})+|\d{3,5})\s*\?\s*$`,
  approx: String.raw`\b(?:around|approx(?:imately)?|about|roughly|ish|somewhere (?:around|near)|or so|give or take|ballpark)\b|\d(?:ish)\b`,
  ack: String.raw`^\s*(?:ok(?:ay)?[\s,.!]*)?(?:thanks?|thank you|thx|ty|much appreciated|appreciate (?:it|that|you)|got it|noted|no problem|np|you'?re welcome|have a (?:good|great|nice) (?:day|one|weekend)|take care)(?:\s+(?:so much|a lot|again|for (?:the (?:info|update|quick reply|reply|response)|reaching out|getting back to me|your help)|you))?(?:\s*(?:,|and)?\s*(?:you too|same to you))?\s*[.!]*\s*$`,
  ooo: String.raw`\booo\b|\b(?:out of (?:the )?office|auto-?reply|automatic reply|i am (?:currently )?(?:away|out)|i will be (?:out|away|back)|on vacation|on holiday|on leave|currently out|will respond (?:when|upon)|will return on|limited access to (?:e-?mail|email)|autoresponder)\b`,
  redirect: String.raw`\b(?:contact|call|e-?mail|email|text|reach|send (?:it|this|that|these|them) to|forward (?:it|this|that) to|talk to|speak (?:to|with)|ask)\s+(?:my |our |the )?(?:dispatch(?:er)?|dispatchers?|broker|booking|owner|office|boss|manager|partner|team|driver)\b`,
  bareDecline: String.raw`^\s*(?:booked|it'?s booked|already booked|covered|already covered|taken|pass|no|nope|nah|negative|not now|not today|no go|no luck|sorry|sorry,? no)\s*[.!]*\s*$`,
  bareCall: String.raw`^\s*(?:call|text|txt|phone|call me|text me|call us)\s*[.!?]*\s*$`,
  wantsDetails: [
    String.raw`^\s*(?:i'?m |we'?re |im |am |very )?(?:interested|intrested|interesed)(?: in (?:this|it|the load|your load|that load))?\s*[.!]*\s*$`,
    String.raw`\b(?:interested in (?:this|it|the|your|that)\b[^.?\n]{0,25})`,
    String.raw`\b(?:send|share|forward|email|e-?mail|give|need|want|can i (?:get|have)|can you send|could you send|please send|pls send)\s+(?:me |us )?(?:the |your |some |more )?(?:load )?(?:details?|info(?:rmation)?|specifics|particulars|bol|rate con|ratecon|paperwork)\b`,
    String.raw`^\s*(?:more )?(?:details?|info(?:rmation)?)\s*[?.!]*\s*$`,
    String.raw`\b(?:what(?:'?s| is) the (?:load )?(?:details?|info))\b`,
    String.raw`\bmore (?:details|info(?:rmation)?)\b`,
  ],
  asksOtherLoads: String.raw`\bwhat else (?:you|u|do you) (?:got|have)\b|\b(?:(?:do|did) (?:you|u) (?:have|got)|have (?:you|u) got|any(?:thing)?|got any|what else|other) (?:else |other |more )?(?:loads?|freight|backhauls?|back ?hauls?|shipments?|lanes?|out of|from|coming out|going (?:back|to|home)|headed|heading|return|work)\b|\bbackhaul\b|\bload(?:s)? (?:out of|from|going)\b|\bany(?:thing)? (?:out of|from|going|headed|heading|coming)\b|\bwhat do you have (?:out of|from|going)\b|\banything else\b`,
  givesInfo: String.raw`\b(?:my |our |the )?(?:mc|dot|usdot|mc#|dot#)\s*(?:#|number|no\.?|is|:)*\s*\d{5,8}\b`,
  askQuestion: String.raw`\?`,
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
 * 2. The rate in the carrier's own words. Returns { found, rate, candidates, ambiguous, perMile, weak, confidence, note }.
 * found = exactly one distinct plausible amount. Two different amounts or a per-mile rate are NOT guessed.
 * confidence: 'strong' (a rate-shaped phrase: "$1,500", "rate 1500", "1500 all in", "ok 1500") | 'weak' (a lone plausible number found only after
 * removing phones, ZIPs, MC/DOT, addresses, dates, times and quantities) | 'none'. A weak rate is drafted but never sent without a person.
 */
export function extractRate(fresh, settings = {}) {
  const lo = Number(settings.minReasonableRate) > 0 ? Number(settings.minReasonableRate) : 250;
  const hi = Number(settings.maxReasonableRate) > 0 ? Number(settings.maxReasonableRate) : 20000;
  const text = String(fresh ?? '');
  const cands = [];
  const add = (v) => { if (v >= lo && v <= hi && !cands.includes(v)) cands.push(v); };
  const yearish = (m, v) => !/\$/.test(m[0]) && v >= 2020 && v <= 2035;
  for (const m of text.matchAll(mk(RULES.rateDollar))) add(toNum(m[1]));
  for (const m of text.matchAll(mk(RULES.rateKeyword))) { const v = toNum(m[2]); if (!yearish(m, v)) add(v); }
  for (const m of text.matchAll(mk(RULES.rateSuffix))) add(toNum(m[2]));
  for (const m of text.matchAll(mk(RULES.rateUsdAfter))) add(toNum(m[2]));
  for (const m of text.matchAll(mk(RULES.rateUsdBefore))) add(toNum(m[1]));
  for (const m of text.matchAll(mk(RULES.rateOkNum))) add(toNum(m[1]));
  for (const m of text.matchAll(mk(RULES.rateWorks))) { const v = toNum(m[2]); if (!yearish(m, v)) add(v); }
  for (const m of text.matchAll(mk(RULES.rateK))) { const k = toNum(m[2]); if (k >= 0.25 && k <= 20) add(Math.round(k * 1000)); }
  const bare = new RegExp(RULES.rateBare).exec(text);
  if (bare) add(toNum(bare[1]));
  const perMile = mk(RULES.perMile).test(text);
  for (const m of stripNoise(text).matchAll(mk(RULES.rateRange))) { const a = toNum(m[1]), b = toNum(m[2]); if (a >= lo && a <= hi && b >= lo && b <= hi && a !== b) { add(a); add(b); } }   // "1500-1600" / "1500 or 1600" is two amounts
  let weak = false;
  // weak candidates only when nothing strong was found
  if (!cands.length && !perMile) {
    for (const m of text.matchAll(mk(RULES.rateHundred))) {
      const w = String(m[1]).toLowerCase().replace(/[ -]/g, '');
      const words = { ten: 10, eleven: 11, twelve: 12, thirteen: 13, fourteen: 14, fifteen: 15, sixteen: 16, seventeen: 17, eighteen: 18, nineteen: 19, twenty: 20, twentyone: 21, twentytwo: 22, twentythree: 23, twentyfour: 24, twentyfive: 25 };
      const n = /^\d+$/.test(w) ? Number(w) : words[w];
      if (n) { add(n * 100); weak = true; }
    }
    const clean = stripNoise(text);
    for (const m of clean.matchAll(mk(RULES.weakNum))) { const v = toNum(m[1]); if (v >= lo && v <= hi && !(v >= 2020 && v <= 2035) && !cands.includes(v)) { cands.push(v); weak = true; } }
  }
  const ambiguous = cands.length > 1;
  const found = cands.length === 1 && !perMile;
  const approx = found && mk(RULES.approx).test(text);
  const isWeak = found && (weak || approx);
  return { found, rate: found ? cands[0] : 0, candidates: cands, ambiguous, perMile, weak: isWeak, confidence: !found ? 'none' : isWeak ? 'weak' : 'strong', approx };
}

/** The text with phones, ZIPs, MC/DOT/reference numbers, street addresses, dates and times blanked out, so a stray number is not mistaken for a rate. */
export function stripNoise(text) {
  let t = String(text ?? '');
  for (const k of ['phone', 'noiseId', 'noiseAddress', 'noiseZip', 'noiseDate', 'noiseTime']) t = t.replace(new RegExp(RULES[k], 'gi'), ' ');
  return t;
}

/** Other 3-5 digit amounts in the text (phone numbers excluded): "1500 but 1400 if I load Friday" has one. */
function otherNumbers(text, rate) {
  const t = stripNoise(text);
  const out = [];
  for (const m of t.matchAll(new RegExp(RULES.otherNum, 'gi'))) { const v = toNum(m[1]); if (v !== rate && v >= 100) out.push(v); }
  return out;
}

/** Which of the meaning patterns hit this fresh text. */
export function tagsOf(fresh) {
  const t = String(fresh ?? '');
  const tags = {};
  for (const k of ['stop', 'decline', 'pushback', 'asksRate', 'asksAvail', 'givesEta', 'givesTruck', 'needsInfo', 'wantsCall', 'condition',
    'wantsDetails', 'asksOtherLoads', 'givesInfo', 'redirect', 'ooo', 'extras']) tags[k] = anyOf(RULES[k], t);
  const one = t.trim();
  tags.bareDecline = new RegExp(RULES.bareDecline, 'i').test(one);
  tags.bareCall = new RegExp(RULES.bareCall, 'i').test(one);
  tags.ack = new RegExp(RULES.ack, 'i').test(one) && one.length <= 90;
  tags.questionRate = new RegExp(RULES.questionRate, 'i').test(one);
  // a message that is only a phone number means "call me"
  tags.onlyPhone = !!one && !stripPhone(one).replace(/[^a-z0-9]/gi, '') && new RegExp(RULES.phone).test(one);
  tags.accepts = new RegExp(RULES.accepts, 'i').test(one) && !tags.condition && one.length <= 70;
  // "ok, can be there at 2pm" / "yes I have a truck": starts like a yes and adds timing or a truck, with no question
  tags.acceptsPlus = !tags.accepts && new RegExp(RULES.acceptWord, 'i').test(one) && !tags.condition && !/\?/.test(one) && (tags.givesEta || tags.givesTruck);
  return tags;
}
const stripPhone = (s) => String(s).replace(new RegExp(RULES.phone, 'g'), ' ');

/**
 * 3. What the carrier meant. Returns { intent, tags, rate, fresh, mc }.
 * intent: empty | ooo | ack | stop | decline | mixed | redirect | rate | rate_unclear | pushback | wants_call | needs_info | wants_details |
 *         accepts | asks_rate | asks_available | gives_eta | gives_truck | asks_other_loads | gives_info | unclear
 */
export function classify(fresh, settings = {}) {
  const f = String(fresh ?? '').trim();
  const rate = extractRate(f, settings);
  const tags = tagsOf(f);
  const hasRateish = rate.found || rate.ambiguous || rate.perMile;
  let intent;
  if (!f) intent = 'empty';
  else if (tags.ooo && !hasRateish) intent = 'ooo';
  else if (tags.stop) intent = 'stop';
  else if ((tags.decline || tags.bareDecline) && hasRateish) intent = 'mixed';
  else if (tags.decline || tags.bareDecline) intent = 'decline';
  else if (tags.ack && !hasRateish) intent = 'ack';
  else if (tags.redirect) intent = 'redirect';
  else if (tags.questionRate && hasRateish) intent = 'rate_unclear';
  else if (rate.ambiguous || rate.perMile) intent = 'rate_unclear';
  else if (rate.found && tags.condition && otherNumbers(f, rate.rate).length) intent = 'rate_unclear';
  else if (rate.found) intent = 'rate';
  else if (tags.pushback) intent = 'pushback';
  else if (tags.wantsCall || tags.bareCall || tags.onlyPhone) intent = 'wants_call';
  else if (tags.givesInfo && !tags.asksRate && !/\?/.test(f)) intent = 'gives_info';
  else if (tags.needsInfo) intent = 'needs_info';
  else if (tags.accepts || tags.acceptsPlus) intent = 'accepts';
  else if (tags.wantsDetails) intent = 'wants_details';
  else if (tags.asksOtherLoads) intent = 'asks_other_loads';
  else if (tags.asksRate) intent = 'asks_rate';
  else if (tags.asksAvail) intent = 'asks_available';
  else if (tags.givesEta) intent = 'gives_eta';
  else if (tags.givesTruck) intent = 'gives_truck';
  else intent = 'unclear';
  const mcm = new RegExp(RULES.givesInfo, 'i').exec(f);
  return { intent, tags, rate, fresh: f, mc: mcm ? (/\d{5,8}/.exec(mcm[0]) || [''])[0] : '' };
}

/** Everything about one inbound e-mail in one call. `own` = load details + notes of the posting it belongs to. */
export function analyseCarrierEmail(body, own = '', settings = {}) {
  const fresh = freshText(body, own);
  const c = classify(fresh, settings);
  // "Thank you" alone is a sign-off, so freshText() leaves nothing: that is a thank-you, not an empty e-mail
  if (c.intent === 'empty') {
    const lines = String(body ?? '').split(/\r?\n/).map(x => x.trim()).filter(Boolean);
    if (lines.length && lines.length <= 2 && new RegExp(RULES.ack, 'i').test(lines[0]) && !/[>]/.test(lines[0])) c.intent = 'ack';
  }
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
  weak: 'MANUAL REVIEW - RATE NOT CLEARLY STATED',
  extras: 'MANUAL REVIEW - CARRIER ASKED FOR EXTRA CHARGES',
  stalemate: 'MANUAL REVIEW - CARRIER REPEATED THE SAME RATE',
  details: 'CARRIER WANTS DETAILS',
  lead: 'TRUCK LEAD - CARRIER ASKED FOR OTHER LOADS',
  redirect: 'MANUAL REVIEW - CARRIER SENT YOU TO SOMEONE ELSE',
  info: 'CARRIER SENT MC / DOT',
};
export const REPLY_FLAGS = FLAGS;

// Every reply a person can review quickly: what the engine would say. Never auto-sent (suggest.review = true).
const manual = (flag, reason, extra = {}) => ({ kind: 'none', text: '', flag, reason, autoSendSafe: false, stageNext: null, ...extra });
const GENERIC_ASK = (tpl) => tpl.generic;

/** Intents that never get a drafted reply of any kind. */
export const NO_REPLY_INTENTS = ['stop', 'decline', 'ack', 'ooo'];

/**
 * state = { stage, ladderStage, ourRate, carrierRate, events } : where the conversation stands (stage names as in the Inquiry Log).
 * Returns { kind, text, flag, reason, stageNext, ladderNext, ourRateNext, ladder?, autoSendSafe, intent, suggest? }
 *   kind: ladder | asks_rate | available | need_rate | need_rate_eta | agreed | details | none
 * `text` is the sentence(s) to put above the quoted thread. kind 'none' = nothing is auto-drafted; `suggest` = {kind,text} is a reply for a person
 * to review (always present when a reply makes sense). `flag` says why a person should look.
 */
export function planCarrierReply({ analysis, target, settings = {}, state = {} }) {
  const a = analysis; const t = Number(target) || 0;
  const stage = String(state.stage || 'INQUIRY_REPLY_SENT').toUpperCase();
  const events = Number(state.events) || 0;
  const tpl = templatesOf(settings);
  const our = Number(state.ourRate) || 0, lastCarrier = Number(state.carrierRate) || 0;
  const done = (r) => ({ intent: a.intent, ...r });
  const questions = a.tags.needsInfo || a.tags.wantsCall || a.tags.pushback;
  const sug = (kind, text) => ({ suggest: { kind, text, review: true } });
  const extras = !!a.tags.extras;

  if (a.echo) return done({ ...manual('', 'This message is only our own wording coming back (for example a test sent to yourself).'), kind: 'none', ignore: true });
  if (a.intent === 'stop') return done(manual(FLAGS.stop, 'The carrier asked not to be contacted.', { stageNext: 'DECLINED', markInactive: true }));
  if (a.intent === 'decline') return done(manual(FLAGS.declined, 'The carrier is not interested or cannot cover it.', { stageNext: 'DECLINED' }));
  if (a.intent === 'ack') return done({ ...manual('', 'The carrier only said thanks: nothing to answer.', { stageNext: stage }), ignore: true, quiet: true });
  if (a.intent === 'ooo') return done({ ...manual('', 'Automatic out-of-office reply: ignored.', { stageNext: stage }), ignore: true, quiet: true });

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
    case 'redirect': return done(manual(FLAGS.redirect, 'The carrier pointed you to a dispatcher or someone else: send your details to them.', { stageNext: 'FOLLOWUP_FLAGGED', ...sug('details', tpl.details) }));
    case 'rate_unclear': return done(manual(FLAGS.rateUnclear,
      a.rate.perMile ? 'The carrier quoted a per-mile rate.' : a.tags.questionRate ? 'The carrier asked a question with an amount in it (' + a.rate.candidates.map(formatCurrency0).join(', ') + ').'
        : 'The carrier mentioned more than one amount (' + a.rate.candidates.map(formatCurrency0).join(', ') + ').', { stageNext: 'FOLLOWUP_FLAGGED', ...sug('confirmRate', tpl.confirmRate) }));
    case 'pushback': return done(manual(FLAGS.pushback, 'The carrier said the rate does not work.', { stageNext: 'FOLLOWUP_FLAGGED', ...sug('pushback', tpl.pushback) }));
    case 'wants_call': return done(manual(FLAGS.call, 'The carrier asked you to call or text.', { stageNext: 'FOLLOWUP_FLAGGED', ...sug('wantsCall', tpl.wantsCall) }));
    case 'needs_info': return done(manual(FLAGS.questions, 'The carrier asked something only a person should answer.', { stageNext: 'FOLLOWUP_FLAGGED', ...sug('details', tpl.details) }));
    case 'wants_details': return done({ kind: 'details', text: tpl.details, flag: FLAGS.details, reason: 'The carrier asked for the load details: resend them and ask for rate and ETA.', stageNext: 'FOLLOWUP_RECEIVED', autoSendSafe: !questions });
    case 'asks_other_loads': return done(manual(FLAGS.lead, 'The carrier asked for other loads: a truck lead. Capture the truck and offer a match.', { stageNext: 'FOLLOWUP_FLAGGED', truckLead: true, ...sug('otherLoads', tpl.otherLoads) }));
    case 'gives_info': return done(manual(FLAGS.info, 'The carrier sent an MC/DOT number' + (a.mc ? ' (' + a.mc + ')' : '') + '. Saved to the carrier.', { stageNext: 'FOLLOWUP_RECEIVED', mc: a.mc, ...sug('generic', GENERIC_ASK(tpl)) }));
    case 'unclear': return done(manual(FLAGS.unclear, 'The reply was not clearly a rate, a question about the rate, an ETA or an answer.', { stageNext: 'FOLLOWUP_FLAGGED', ...sug('generic', GENERIC_ASK(tpl)) }));
    case 'accepts': {
      if (our > 0 && stage === 'RATE_RESPONSE_SENT' && state.ladderStage !== 'book' && a.tags.givesEta) return done(manual(FLAGS.agreed + ' (ETA GIVEN)', 'The carrier agreed to ' + formatCurrency0(our) + ' and gave an ETA: book it.', { stageNext: 'ETA_RECEIVED' }));
      if (!(our > 0) || !(stage === 'RATE_RESPONSE_SENT') || state.ladderStage === 'book') return done(manual(FLAGS.unclear, '"Yes / ok" but there is no counter on the table to agree to.', { stageNext: 'FOLLOWUP_FLAGGED', ...sug('generic', GENERIC_ASK(tpl)) }));
      return done({ kind: 'agreed', text: fillTemplate(tpl.agreed, { ourRate: formatCurrency0(our), target: formatCurrency0(t) }), flag: FLAGS.agreed, reason: 'The carrier agreed to ' + formatCurrency0(our) + '.',
        stageNext: 'AGREED', ladderNext: 'book', ourRateNext: our, autoSendSafe: !extras });
    }
    case 'rate': {
      const r = a.rate.rate, weak = !!a.rate.weak;
      const note = weak ? ' The amount was not clearly labelled as a rate' + (a.rate.approx ? ' ("about")' : '') + ': check it.' : '';
      if (!(t > 0)) return done(manual(FLAGS.noTarget, 'Carrier rate ' + formatCurrency0(r) + ' received, but this posting has no target rate to compare it with.', { stageNext: 'FOLLOWUP_RECEIVED', rate: r }));
      if (r < t * 0.5 || r > t * 3) return done(manual(FLAGS.rateWrong, 'Carrier rate ' + formatCurrency0(r) + ' is far from the ' + formatCurrency0(t) + ' target: check it is a real quote.', { stageNext: 'FOLLOWUP_RECEIVED', rate: r }));
      const countered = stage === 'RATE_RESPONSE_SENT' && our > 0 && state.ladderStage !== 'book';
      // the carrier came down to (or under) the number we last offered: that is a yes, whatever the percentages say
      if (countered && r <= our) {
        return done({ kind: 'agreed', text: fillTemplate(tpl.agreed, { ourRate: formatCurrency0(r), target: formatCurrency0(t) }), flag: FLAGS.agreed + (weak ? ' (CHECK RATE)' : ''),
          reason: 'Carrier rate ' + formatCurrency0(r) + ' is at or under your last offer of ' + formatCurrency0(our) + '.' + note, stageNext: 'AGREED', ladderNext: 'book', ourRateNext: r, rate: r,
          autoSendSafe: !weak && !extras && !questions && !a.tags.condition });
      }
      // the same number again after our counter: asking a third time gets nowhere
      if (countered && lastCarrier > 0 && r === lastCarrier) {
        return done(manual(FLAGS.stalemate, 'The carrier repeated ' + formatCurrency0(r) + ' after your counter of ' + formatCurrency0(our) + '. Decide whether to move or let it go.', { stageNext: 'FOLLOWUP_FLAGGED', rate: r, ...sug('holding', tpl.holding) }));
      }
      const lad = ladderReply(r, t, settings);
      let counter = lad.stage === 'split' ? lad.split : lad.stage === 'target' ? t : r;
      // never go backwards: a counter lower than the one already sent is not a negotiation
      if (countered && lad.stage !== 'book' && counter < our) {
        return done(manual(FLAGS.stalemate, 'The carrier is at ' + formatCurrency0(r) + ', you already offered ' + formatCurrency0(our) + '. Another counter would go backwards.', { stageNext: 'FOLLOWUP_FLAGGED', rate: r, ...sug('holding', tpl.holding) }));
      }
      const flag = weak ? FLAGS.weak : lad.stage === 'book' ? 'RATE RECEIVED - REVIEW / ETA' : lad.stage === 'split' ? 'RATE RECEIVED - SPLIT COUNTER DRAFTED' : '';
      return done({ kind: 'ladder', text: lad.text, flag: extras ? FLAGS.extras : flag, reason: 'Carrier rate ' + formatCurrency0(r) + ' vs target ' + formatCurrency0(t) + ' (' + (lad.pct >= 0 ? '+' : '') + lad.pct.toFixed(1) + '%).' + note + (extras ? ' The carrier also mentioned extra charges.' : ''),
        stageNext: 'RATE_RESPONSE_SENT', ladderNext: lad.stage, ourRateNext: counter, rate: r, rateConfidence: a.rate.confidence, ladder: { stage: lad.stage, pct: lad.pct, split: lad.split },
        autoSendSafe: !weak && !extras && !questions && !a.tags.condition });
    }
    case 'asks_rate': {
      if (!(t > 0)) return done(manual(FLAGS.noTarget, 'The carrier asked for the rate but this posting has no target rate yet.', { stageNext: 'FOLLOWUP_FLAGGED' }));
      const lead = a.tags.asksAvail ? tpl.availableLead + ' ' : '';
      return done({ kind: 'asks_rate', text: lead + fillTemplate(tpl.askRate, { target: formatCurrency0(t) }), flag: '', reason: 'The carrier asked what the rate is: answered with your target.',
        stageNext: 'RATE_RESPONSE_SENT', ladderNext: 'target', ourRateNext: t, autoSendSafe: !extras });
    }
    case 'asks_available':
      return done({ kind: 'available', text: tpl.available, flag: '', reason: 'The carrier asked whether the load is still available.', stageNext: 'FOLLOWUP_RECEIVED', autoSendSafe: true });
    case 'gives_eta':
      return done({ kind: 'need_rate', text: tpl.needRate, flag: '', reason: 'The carrier gave timing but no rate.', stageNext: 'FOLLOWUP_RECEIVED', autoSendSafe: true });
    case 'gives_truck':
      return done({ kind: 'need_rate_eta', text: tpl.needRateEta, flag: '', reason: 'The carrier described a truck but gave no rate or ETA.', stageNext: 'FOLLOWUP_RECEIVED', autoSendSafe: true, truckLead: true });
    default: return done(manual(FLAGS.unclear, 'Not understood.', { stageNext: 'FOLLOWUP_FLAGGED', ...sug('generic', GENERIC_ASK(tpl)) }));
  }
}

export { ladderStage };
