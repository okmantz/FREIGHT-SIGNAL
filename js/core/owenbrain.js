// Owen's general brain (v18): small talk, calculators, freight glossary and broker playbook. Pure and offline: no DOM, no network, no AI service.
// Every function takes the normalised question and returns an answer object or null:
//   { topic, text, mood?, steps?, rows?, facts?, links?, follow? }       mood = which portrait Owen shows: smart | thumbs | think | relax
import { ns, money, money2, plural, cap, evalMath, near } from './owentext.js';

const A = (topic, text, extra = {}) => ({ topic, text, ...extra });
const pick = (list, rand = Math.random) => list[Math.min(list.length - 1, Math.floor(rand() * list.length))];
const has = (sq, ...res) => res.some(r => r.test(sq));
const first = (name) => String(name || '').trim().split(/\s+/)[0] || '';

/** One line about where things stand (used by "how are you" so even small talk is grounded in the real board). */
export function statusLine(data = {}) {
  const loads = data.loads || [];
  const bits = [];
  if (loads.length) { const quiet = loads.filter(l => (l.stuckScore || 0) >= 4).length; bits.push(`${plural(loads.length, 'open load')}${quiet ? ` (${quiet} look${quiet === 1 ? 's' : ''} quiet)` : ''}`); }
  if (data.pace && Number.isFinite(data.pace.week)) bits.push(`${data.pace.week} of ${data.pace.floor} covers this week`);
  if (data.held) bits.push(`${plural(data.held, 'e-mail')} waiting for your eyes`);
  return bits.length ? 'Right now: ' + bits.join(', ') + '.' : 'Your board is empty right now, so it is a good moment to paste a load.';
}

// ------------------------------------------------------------------------------------------------ small talk
const JOKES = [
  'Why did the load stay on the board all night? It was waiting for a carrier with a better rate. Ba dum.',
  'A broker, a carrier and a shipper walk into a bar. The carrier says "rate?" and the bar is still on hold.',
  'What is a dispatcher\'s favourite exercise? Pushing the rate up and pulling the ETA in.',
  'Why do brokers love the 3 x 3 matrix? Nine chances to hear "is this still available?"',
  'My favourite freight poem has one line: "Rate?" The reply is always shorter.',
  'Deadhead miles are like Mondays: nobody wants them, everybody has them.',
];
const FACTS = [
  'Drivers can drive up to 11 hours inside a 14-hour window after 10 hours off, so a truck realistically covers about 500 to 600 miles a day.',
  'The cheapest way to get more eyes on a load is more postings: that is the whole idea of the 3 x 3 matrix.',
  'A reply inside five minutes wins far more loads than a perfect reply an hour later. That is why Cover Desk shows what needs you first.',
  'A truck reported empty an hour ago is worth far more than a "maybe tomorrow". Freight Signal ranks trucks by freshness for that reason.',
  'The best rate you can post is the one a real carrier already took on that lane. Check the lane card before you guess.',
];
const PEP = [
  'One load at a time. Pick the quietest one and give it a fresh rate or a new set of carriers. Momentum builds from the first cover.',
  'You do not need a perfect day, you need the next cover. Start with the load that has a truck already matched.',
  'Hard loads are where brokers earn their margin. Turn on Auto Rescue so it keeps working while you take a breath.',
];

export function smalltalk(sq, data = {}, rand = Math.random) {
  const name = first(data.name);
  const status = statusLine(data);
  const hello = () => (name ? name : '');
  if (has(sq, /^(how are you|how are you doing|how are you today|how r u|how are u|how re you|hows it going|how is it going|how you doing|how you been|hows everything|hows life|how have you been|hru|how do you do|how s life|whats up|what is up|wassup|sup|whats good|whats new)\b/)) {
    const lines = [
      `Doing great, thanks for asking${name ? ', ' + name : ''}. Ready to cover some freight. ${status}`,
      `Running smooth on my end. ${status} What are we working on?`,
      `Better when loads are covering. ${status} Want me to look at the quiet ones?`,
    ];
    return A('social', pick(lines, rand), { mood: 'relax', follow: ['Give me a summary', 'What should I work on first?', 'How am I doing this week?'] });
  }
  if (has(sq, /^(hello|hi|hey|heya|howdy|yo|hiya|greetings|good morning|good afternoon|good evening|morning|evening|afternoon)\b/)) {
    const hr = new Date(data.now || Date.now()).getHours();
    const part = /morning/.test(sq) ? 'Good morning' : /afternoon/.test(sq) ? 'Good afternoon' : /evening/.test(sq) ? 'Good evening' : (hr < 5 ? 'Working late' : hr < 12 ? 'Good morning' : hr < 18 ? 'Good afternoon' : 'Good evening');
    return A('social', `${part}${name ? ', ' + name : ''}. Owen here. ${status} Ask me anything: where something is, how a load is doing, what a carrier quoted, or what I would do next.`, { mood: 'thumbs', follow: ['Give me a summary', 'What should I work on first?', 'How am I doing this week?'] });
  }
  if (has(sq, /^(good night|goodnight|gn|night night)\b/)) return A('social', 'Good night. Your board will be here in the morning, and Auto Rescue can keep working the hard ones if you want it to.', { mood: 'relax' });
  if (has(sq, /\b(thank you|thanks|thx|ty|appreciate (it|that|you)|cheers|much appreciated)\b/) && sq.split(' ').length <= 8) return A('social', pick(['Anytime. Go cover something.', 'You got it. Shout when the next one gets stuck.', 'Happy to help. Now go get that cover.'], rand), { mood: 'thumbs' });
  if (has(sq, /\b(good job|great job|nice work|well done|awesome|amazing|you re great|youre great|you are great|you rock|love it|love this|nice one|perfect|brilliant|you re the best|youre the best|you are the best)\b/) && sq.split(' ').length <= 9) return A('social', pick(['Thank you. That is the nicest thing a freight helper has heard all week. Now let us find the next cover.', 'Appreciate it. The credit goes to your board: good loads make easy advice.'], rand), { mood: 'thumbs' });
  if (has(sq, /\b(you suck|useless|stupid|dumb|worthless|terrible|garbage|you re bad|youre bad|not helpful|that was wrong|wrong answer|you re wrong|youre wrong|that is wrong)\b/)) return A('social', 'Fair. I missed on that one. Tell me what you were expecting, or ask it another way, for example "which load is stuck" or "what did Chicago cover at". If something in the app itself is off, the thumbs-down in the System page notes is the fastest way to flag it.', { mood: 'think' });
  if (has(sq, /\b(who are you|your name|what are you|are you real|are you ai|are you a bot|are you human|are you a person|are you chatgpt|are you claude|are you gpt|are you an ai|what is owen|who is owen|who made you|who built you|who created you|are you alive)\b/)) {
    return A('social', 'I am Owen, the helper built into Freight Signal. I am not a person on the line and not a cloud AI service: I am a built-in assistant that reads your own board, covers, carriers, trucks and e-mails right here in your browser, and knows a broker\'s playbook. Nothing you ask leaves this computer.', { mood: 'smart', follow: ['What can you do?', 'Give me a summary'] });
  }
  if (has(sq, /\b(what can you do|what do you do|how can you help|can you help|help me|what do you know|your abilities|your capabilities|what can i ask|what should i ask|what questions|how do you work|show me what you can do)\b/) && !/\b(load|carrier|truck|rate)\b.*\b(help me cover)\b/.test(sq)) {
    return A('social', 'A lot, and it all comes from your real data. A few things I do well:', {
      mood: 'smart',
      steps: ['Analyse your week: covers vs. your floor, pace, trend, best lanes, how fast loads cover.', 'Look up any load, carrier, customer or truck: "tell me about the Chicago load", "who is ACME", "any trucks near Dallas".', 'Tell you what to do next on a stuck load, and what to work on first today.', 'Answer rate questions: what a lane covered at, per-mile and margin math, "what should I sell at for 15%".', 'Explain freight terms (deadhead, TONU, detention, lumper, FSC...) and walk you through the app.', 'Chat. Ask me how I am doing, for a joke, or a pep talk.'],
      follow: ['Give me a summary', 'How am I doing this week?', 'What should I work on first?', 'Analyze my business'],
    });
  }
  if (has(sq, /\b(joke|funny|make me laugh|something funny|cheer me up)\b/)) return A('social', pick(JOKES, rand) + ' Now, which load needs covering?', { mood: 'relax' });
  if (has(sq, /\b(tell me something|fun fact|interesting|did you know|teach me something|random fact)\b/)) return A('social', pick(FACTS, rand), { mood: 'smart' });
  if (has(sq, /\b(i m tired|im tired|i am tired|stressed|stressful|overwhelmed|burned out|burnt out|exhausted|bad day|rough day|long day|frustrated|annoyed|i give up|so much to do|swamped|slammed)\b/)) {
    return A('social', 'Sounds like a lot. ' + pick(PEP, rand) + (data.loads && data.loads.length ? ' Want me to pick your first move?' : ''), { mood: 'relax', follow: ['What should I work on first?'] });
  }
  if (has(sq, /\b(motivate|motivation|inspire|pep talk|encourage|keep me going|i need motivation|cheer)\b/)) return A('social', pick(PEP, rand), { mood: 'thumbs' });
  if (has(sq, /\b(bored|boring)\b/)) return A('social', 'Then let us make it interesting: I can analyse your week, find your quietest load, or quiz you on freight terms. Say "analyze my business" to start.', { mood: 'relax', follow: ['Analyze my business'] });
  if (has(sq, /\b(i love you|love you|you re cute|youre cute|marry me|i like you)\b/)) return A('social', 'That is kind. I am a freight helper, so my love language is a covered load. Let us get one.', { mood: 'relax' });
  if (has(sq, /^(bye|goodbye|see you|see ya|later|talk later|ttyl|gotta go|i m done|im done|that s all|thats all)\b/)) return A('social', pick(['Good luck out there.', 'Go cover some freight. I will be here.', 'See you. Cover the quiet ones first.'], rand), { mood: 'thumbs' });
  if (has(sq, /^(ok|okay|k|cool|nice|great|got it|alright|sounds good|lol|haha|hmm|hm|interesting|yep|yes|yeah|no|nope|sure|right|i see|makes sense|understood|fine)$/)) return A('social', pick(['Got it. Anything else you want me to look at?', 'Okay. Ask me anything else, or say "what should I work on first?"', 'Sure thing. I am here when you need me.'], rand), { mood: 'relax', follow: ['What should I work on first?', 'Give me a summary'] });
  if (has(sq, /\b(what time is it|whats the time|what is the time|current time|time is it)\b/)) {
    const d = new Date(data.now || Date.now()); return A('social', 'It is ' + d.toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' }) + ' on your computer clock.', { mood: 'smart' });
  }
  if (has(sq, /\b(what day is it|whats the date|what is the date|todays date|what is today|whats today|what day is today|current date|date today)\b/)) {
    const d = new Date(data.now || Date.now()); return A('social', 'Today is ' + d.toLocaleDateString([], { weekday: 'long', month: 'long', day: 'numeric', year: 'numeric' }) + '.', { mood: 'smart' });
  }
  if (has(sq, /\b(my name|who am i|what is my name|whats my name|do you know me|do you know who i am)\b/)) {
    return A('social', name ? `You are ${data.name}. You are signed in on this computer, and I only know what is in your own workspace.` : 'I do not have your name yet. Add it on Account Settings and I will use it.', { mood: 'smart', links: name ? undefined : [{ label: 'Account Settings', route: 'account' }] });
  }
  void hello;
  return null;
}

// ------------------------------------------------------------------------------------------------ calculators
const numOf = (s) => Number(String(s).replace(/[$,]/g, ''));
const MILES_PER_DAY = 550;

export function calculator(question) {
  const raw = String(question || '');
  const sq = ns(raw);
  let m;
  // total rate over miles -> per mile:  "1800 for 715 miles", "what is $2400 over 900 miles per mile"
  if ((m = /\$?\s*([\d,]+(?:\.\d+)?)\s*(?:for|over|on|across|in)\s*([\d,]+(?:\.\d+)?)\s*(?:miles|mi)\b/.exec(sq)) && numOf(m[2]) > 0) {
    const t = numOf(m[1]), mi = numOf(m[2]);
    if (t >= 50) return A('calc', `${money(t)} over ${mi.toLocaleString('en-US')} miles is ${money2(t / mi)} per mile.`, { mood: 'think', facts: [['Total', money(t)], ['Miles', mi.toLocaleString('en-US')], ['Per mile', money2(t / mi)]] });
  }
  // per mile x miles -> total:  "$2.10 per mile for 800 miles", "800 miles at 2.10"
  if ((m = /\$?\s*(\d+(?:\.\d+)?)\s*(?:\/\s*mi(?:le)?|per\s*mi(?:le)?|a\s*mile|rpm)\b[^0-9]{0,12}([\d,]+)\s*(?:miles|mi)?\b/.exec(sq)) && numOf(m[2]) > 0) {
    const r = numOf(m[1]), mi = numOf(m[2]);
    if (r < 30 && mi >= 20) return A('calc', `${money2(r)} per mile over ${mi.toLocaleString('en-US')} miles is ${money(r * mi)}.`, { mood: 'think', facts: [['Per mile', money2(r)], ['Miles', mi.toLocaleString('en-US')], ['Total', money(r * mi)]] });
  }
  if ((m = /([\d,]+)\s*(?:miles|mi)\b[^0-9$]{0,14}(?:at|@|for|x)?\s*\$?\s*(\d+(?:\.\d+)?)\b(?!\s*(?:miles|mi))/.exec(sq)) && numOf(m[2]) < 30 && numOf(m[1]) >= 20) {
    const mi = numOf(m[1]), r = numOf(m[2]);
    return A('calc', `${mi.toLocaleString('en-US')} miles at ${money2(r)} per mile is ${money(r * mi)}.`, { mood: 'think', facts: [['Miles', mi.toLocaleString('en-US')], ['Per mile', money2(r)], ['Total', money(r * mi)]] });
  }
  // drive time:  "how long to drive 715 miles"
  if (/\b(how long|how many days|how many hours|transit|drive time|driving time|take to drive|days to)\b/.test(sq) && (m = /([\d,]{2,6})\s*(?:miles|mi)\b/.exec(sq))) {
    const mi = numOf(m[1]); const days = mi / MILES_PER_DAY;
    return A('calc', `${mi.toLocaleString('en-US')} miles is about ${days < 1 ? 'one day' : (Math.round(days * 10) / 10) + ' days'} of driving for one driver (roughly ${MILES_PER_DAY} miles a day inside the 11-hour driving limit). A team can cover it faster; add time for loading, unloading and any appointment.`, { mood: 'think', facts: [['Miles', mi.toLocaleString('en-US')], ['One driver', `${(Math.round(days * 10) / 10)} days`], ['Team (about double)', `${(Math.round(days * 5) / 10)} days`]] });
  }
  // margin from sell + buy
  const sell = /\b(?:sell|sold|selling|charge|charged|bill|billed|customer pays|shipper pays|revenue)\b\D{0,22}\$?\s*([\d,]{3,7})/.exec(sq);
  const buy = /\b(?:buy|bought|buying|pay|paid|paying|carrier|cost|costs)\b\D{0,22}\$?\s*([\d,]{3,7})/.exec(sq);
  if (sell && buy && /\b(margin|profit|spread|make|made|markup|gross)\b/.test(sq)) {
    const s = numOf(sell[1]), b = numOf(buy[1]);
    if (s > 0) return A('calc', `Selling at ${money(s)} and buying at ${money(b)} leaves ${money(s - b)}: a ${((s - b) / s * 100).toFixed(1)}% margin (${(b > 0 ? (s - b) / b * 100 : 0).toFixed(1)}% markup on cost).`, { mood: 'think', facts: [['Sell', money(s)], ['Buy', money(b)], ['Profit', money(s - b)], ['Margin', ((s - b) / s * 100).toFixed(1) + '%'], ['Markup', (b > 0 ? ((s - b) / b * 100).toFixed(1) : '0.0') + '%']] });
  }
  // price for a target margin:  "what should I sell at for a 15% margin on 1700"
  if ((m = /(\d+(?:\.\d+)?)\s*%\s*(?:margin|profit|gross)/.exec(sq)) && (m2()) ) {
    const mg = Number(m[1]) / 100; const cost = numOf(m2());
    if (mg > 0 && mg < 0.95 && cost >= 100) { const sellAt = cost / (1 - mg); return A('calc', `To keep a ${m[1]}% margin on a ${money(cost)} carrier cost, sell at ${money(sellAt)} (that is ${money(sellAt - cost)} of profit).`, { mood: 'think', facts: [['Carrier cost', money(cost)], ['Margin', m[1] + '%'], ['Sell at', money(sellAt)], ['Profit', money(sellAt - cost)]] }); }
  }
  function m2() { const x = /(?:on|at|of|for|cost|buy|pay|paying|carrier)\D{0,12}\$?\s*([\d,]{3,7})(?!\s*%)/.exec(sq.replace(/(\d+(?:\.\d+)?)\s*%/g, ' ')); return x ? x[1] : ''; }
  // plain arithmetic
  const rest = sq.replace(/^(?:what is|whats|calculate|calc|compute|work out|how much is|how much|tell me|solve|figure out|can you (?:calculate|do))\s+/, '').replace(/\?+$/, '').trim();
  if (rest && rest.length <= 80) {
    const v = evalMath(rest);
    if (v !== null) return A('calc', `${rest.replace(/\*/g, ' × ')} = ${Number.isInteger(v) ? v.toLocaleString('en-US') : (Math.round(v * 10000) / 10000).toLocaleString('en-US')}`, { mood: 'think' });
  }
  return null;
}

// ------------------------------------------------------------------------------------------------ freight glossary
export const GLOSSARY = [
  { id: 'deadhead', k: ['deadhead', 'dead head', 'dh'], term: 'Deadhead', def: 'Miles a truck drives empty: from where it dropped its last load to the next pickup, or home again afterwards.', tip: 'Carriers price deadhead into their rate. A load that picks up right where a truck just emptied usually needs a lower rate to cover.' },
  { id: 'tonu', k: ['tonu', 'truck order not used'], term: 'TONU (Truck Order Not Used)', def: 'A fee paid to a carrier when a load is cancelled after the truck was already dispatched or arrived.', tip: 'It is an accessorial, so agree it in writing before the carrier moves. Freight Signal never auto-answers an e-mail that mentions it.' },
  { id: 'detention', k: ['detention'], term: 'Detention', def: 'Pay for a driver\'s waiting time at a pickup or delivery beyond the free time, commonly two hours.', tip: 'Put the free time and the hourly rate on the rate confirmation up front. Detention is one of the most common reasons a carrier raises the rate after booking.' },
  { id: 'layover', k: ['layover'], term: 'Layover', def: 'A charge when a driver has to wait overnight or a full extra day because the load was not ready or could not unload.', tip: 'Like detention, agree it before the truck is dispatched.' },
  { id: 'lumper', k: ['lumper', 'lumper fee'], term: 'Lumper', def: 'A third-party crew a warehouse uses to unload (or load) a truck, with a fee that the carrier usually pays up front and the broker reimburses with a receipt.', tip: 'Ask the shipper or receiver whether a lumper is required, and note who pays, before you book.' },
  { id: 'accessorial', k: ['accessorial', 'accessorials', 'extra charges'], term: 'Accessorial', def: 'Any charge on top of the line-haul rate: detention, layover, lumper, TONU, extra stops, tarps, liftgate and similar.' },
  { id: 'fsc', k: ['fsc', 'fuel surcharge'], term: 'FSC (fuel surcharge)', def: 'A fuel add-on to the base rate. On the spot market most carriers quote "all-in", meaning fuel is already included.', tip: 'When a carrier says "1800 plus FSC", ask for the all-in number so you can compare it with your target.' },
  { id: 'linehaul', k: ['linehaul', 'line haul', 'line-haul'], term: 'Line haul', def: 'The base freight rate for moving the load from A to B, before fuel surcharge and accessorials.' },
  { id: 'allin', k: ['all in', 'all-in', 'allin'], term: 'All-in', def: 'The total the carrier will be paid for the load, fuel and standard charges included. It is the number Freight Signal compares with your target rate.' },
  { id: 'ratecon', k: ['ratecon', 'rate con', 'rate confirmation', 'rate conf'], term: 'Rate confirmation (ratecon)', def: 'The document that confirms the agreed rate, pickup and delivery details and terms between broker and carrier. The carrier signs it before the truck is dispatched.', tip: 'Never let a truck move on an e-mail alone. Get the signed ratecon back first.' },
  { id: 'bol', k: ['bol', 'bill of lading'], term: 'BOL (bill of lading)', def: 'The shipping document the driver signs at pickup. It lists what was loaded and is the receipt for the freight.' },
  { id: 'pod', k: ['pod', 'proof of delivery'], term: 'POD (proof of delivery)', def: 'The signed delivery receipt. Most brokers pay the carrier after the POD arrives.' },
  { id: 'mc', k: ['mc number', 'mc#', 'mc authority', 'operating authority', 'dot number', 'usdot', 'usdot number', 'mc dot', 'mc/dot'], term: 'MC / DOT number', def: 'The MC number is a carrier\'s for-hire operating authority from the FMCSA; the USDOT number identifies the company and its safety record.', tip: 'Look up both on FMCSA SAFER before you book a carrier you have not used. Check the authority is active and the insurance is current.' },
  { id: 'fmcsa', k: ['fmcsa', 'safer', 'safer web'], term: 'FMCSA / SAFER', def: 'The Federal Motor Carrier Safety Administration regulates trucking. SAFER is its public lookup for a carrier\'s authority, insurance, safety rating and inspection history.', links: [{ label: 'Load Board (carrier links)', route: 'board' }] },
  { id: 'coi', k: ['coi', 'certificate of insurance', 'insurance certificate'], term: 'COI (certificate of insurance)', def: 'Proof a carrier carries insurance. Brokers usually ask for auto liability (the federal minimum for general freight is $750,000) and cargo coverage (often $100,000).', tip: 'Ask to be named certificate holder, and check the policy dates, not just the existence of a certificate.' },
  { id: 'w9', k: ['w9', 'w-9', 'w 9'], term: 'W-9', def: 'The tax form a carrier gives you so you can pay them and report the payments. It is part of the carrier packet.' },
  { id: 'packet', k: ['carrier packet', 'onboarding packet', 'set up packet', 'carrier setup'], term: 'Carrier packet', def: 'The paperwork a new carrier fills in before their first load: contract, W-9, COI, authority and payment details.' },
  { id: 'factoring', k: ['factoring', 'factor', 'noa', 'notice of assignment'], term: 'Factoring', def: 'A company that buys a carrier\'s invoices for quick cash. You pay the factor instead of the carrier once you receive a Notice of Assignment (NOA).', tip: 'Never change where you send payment because of an e-mail alone; confirm the NOA with the factor.' },
  { id: 'quickpay', k: ['quick pay', 'quickpay'], term: 'Quick pay', def: 'Paying a carrier in a few days instead of the normal 30 days, for a small percentage fee that comes out of their pay.' },
  { id: 'drophook', k: ['drop and hook', 'drop & hook', 'drop hook', 'drop trailer'], term: 'Drop and hook', def: 'The driver drops a loaded or empty trailer and hooks to another, with no waiting for loading or unloading. It saves detention risk and time.' },
  { id: 'liveload', k: ['live load', 'live unload', 'live loading'], term: 'Live load / live unload', def: 'The driver waits while the truck is loaded or unloaded. It takes longer and is where detention usually happens.' },
  { id: 'fcfs', k: ['fcfs', 'first come first served'], term: 'FCFS (first come, first served)', def: 'A facility that takes trucks in the order they arrive instead of at a fixed appointment time.' },
  { id: 'appt', k: ['appointment', 'appt', 'pickup appointment', 'delivery appointment'], term: 'Appointment', def: 'A set time a truck must be at the dock. A missed appointment can mean rescheduling, detention or a TONU, so confirm the carrier can make it.' },
  { id: 'dryvan', k: ['dry van', 'van', 'dry van trailer'], term: 'Dry van', def: 'The standard enclosed trailer, usually 53 feet, for palletized and boxed freight that needs no temperature control. It is the most common load on the spot market.' },
  { id: 'reefer', k: ['reefer', 'refrigerated', 'temperature controlled', 'temp controlled'], term: 'Reefer', def: 'A refrigerated trailer for freight that must stay cold or frozen. The load needs a set temperature and a continuous or cycle mode, and the trailer should be pre-cooled.' },
  { id: 'flatbed', k: ['flatbed', 'flat bed'], term: 'Flatbed', def: 'An open trailer with no sides or roof for steel, machinery, lumber and oversized freight. Loads are strapped and sometimes tarped.' },
  { id: 'stepdeck', k: ['step deck', 'stepdeck', 'drop deck'], term: 'Step deck', def: 'A flatbed with a lower rear deck so taller freight can legally fit under bridges.' },
  { id: 'poweronly', k: ['power only', 'poweronly'], term: 'Power only', def: 'A truck with no trailer that pulls a trailer the shipper or broker provides.' },
  { id: 'hotshot', k: ['hotshot', 'hot shot'], term: 'Hotshot', def: 'A pickup-and-trailer rig for smaller, time-critical freight, usually up to roughly 16,000 pounds.' },
  { id: 'boxtruck', k: ['box truck', 'straight truck', 'sprinter'], term: 'Box truck / Sprinter', def: 'A smaller straight truck or van for lighter freight and local or regional loads.' },
  { id: 'ltl', k: ['ltl', 'less than truckload', 'less than truck load'], term: 'LTL (less than truckload)', def: 'Freight too small to fill a truck, shipped with other shippers\' freight and priced by weight, class and distance.' },
  { id: 'ftl', k: ['ftl', 'full truckload', 'truckload', 'full truck load'], term: 'FTL (full truckload)', def: 'One shipper\'s freight on one truck, usually 10,000+ pounds or 10+ pallets. It is what Freight Signal posts to DAT.' },
  { id: 'partial', k: ['partial', 'partial load', 'volume ltl'], term: 'Partial', def: 'More than LTL but less than a full truck, often shared with another load.' },
  { id: 'team', k: ['team driver', 'team drivers', 'team truck', 'team load'], term: 'Team drivers', def: 'Two drivers who alternate, so the truck keeps moving and can cover about twice the daily miles. Used for tight, long-distance deliveries and priced higher.' },
  { id: 'hazmat', k: ['hazmat', 'hazardous materials', 'hazardous'], term: 'Hazmat', def: 'Regulated hazardous materials. The driver needs a hazmat endorsement, the truck needs placards, and the carrier needs the right insurance.' },
  { id: 'bobtail', k: ['bobtail'], term: 'Bobtail', def: 'A tractor driving without a trailer attached.' },
  { id: 'headhaul', k: ['headhaul', 'head haul', 'backhaul', 'back haul'], term: 'Headhaul vs. backhaul', def: 'The headhaul is the direction with more freight and higher rates; the backhaul is the return direction, where freight is scarcer and rates are lower.', tip: 'Offering a carrier a backhaul can save them deadhead and win you the load at a better rate. Cover Desk and the load card show backhaul options.' },
  { id: 'spot', k: ['spot market', 'spot rate', 'spot freight', 'contract rate', 'spot vs contract'], term: 'Spot vs. contract', def: 'Spot freight is priced load by load at today\'s market. Contract freight has a fixed rate agreed in advance for a period.' },
  { id: 'doublebroker', k: ['double brokering', 'double broker', 'rebrokering', 're brokering', 'rebroker'], term: 'Double brokering', def: 'A carrier or broker re-brokering a load to someone else without the shipper\'s knowledge. It is a serious fraud and liability risk.', tip: 'Check the MC number and the e-mail domain match, and be wary of a carrier who cannot give you the truck or the driver\'s name.' },
  { id: 'rpm', k: ['rpm', 'rate per mile', 'per mile rate', 'cpm'], term: 'RPM (rate per mile)', def: 'The total rate divided by the loaded miles. It lets you compare lanes and carrier quotes. Ask me "1800 for 715 miles" and I will work it out.' },
  { id: 'margin', k: ['margin vs markup', 'markup vs margin', 'difference between margin and markup', 'margin and markup', 'what is margin', 'what is markup', 'gross margin', 'markup'], term: 'Margin vs. markup', def: 'Margin is profit divided by the selling price; markup is profit divided by the cost. Selling at $2,000 and buying at $1,700 is $300 of profit: a 15% margin, but a 17.6% markup.', tip: 'Ask me "sell 2000 buy 1700" for the numbers, or "what should I sell at for a 15% margin on 1700".' },
  { id: 'hos', k: ['hours of service', 'hos', 'eld', 'driving limit', '11 hour rule', '14 hour rule'], term: 'Hours of Service (HOS)', def: 'For property-carrying drivers: 11 hours of driving inside a 14-hour window after 10 hours off, and a 60 or 70 hour weekly limit. It is why a long load needs a team or an extra day.' },
  { id: 'tender', k: ['tender', 'load tender'], term: 'Tender', def: 'A shipper offering a load to a broker or carrier, or a broker offering it to a carrier, who then accepts or declines.' },
  { id: 'lane', k: ['what is a lane', 'lane meaning'], term: 'Lane', def: 'A pickup-to-delivery route, such as Chicago, IL to Atlanta, GA. Rates and capacity are judged lane by lane.', links: [{ label: 'Open Lane Intel', route: 'lanes' }] },
  { id: 'dat', k: ['what is dat', 'dat one', 'dat load board', 'load board', 'loadboard'], term: 'DAT', def: 'DAT One is the largest freight marketplace: shippers and brokers post loads, carriers search them. Freight Signal builds the posting file and the carrier outreach; you upload the CSV to DAT.', links: [{ label: 'Open Load Board', route: 'board' }] },
  { id: 'eta', k: ['eta'], term: 'ETA', def: 'Estimated time of arrival. For a carrier reply, it is when the truck can be at the pickup. Freight Signal asks for it once the rate is agreed.' },
  { id: 'cross', k: ['cross dock', 'cross-dock', 'crossdock'], term: 'Cross-dock', def: 'Moving freight straight from one truck to another at a terminal, with little or no storage.' },
  { id: 'tarp', k: ['tarp', 'tarps', 'tarping'], term: 'Tarp', def: 'A cover for flatbed freight, charged as an extra when required. Say upfront whether a load needs tarps.' },
  { id: 'pallet', k: ['pallet count', 'pallets', 'linear feet'], term: 'Pallet count / linear feet', def: 'How much trailer space freight uses. A 53-foot van holds up to about 26 standard pallets, fewer if they cannot be stacked or double-stacked.' },
  { id: 'blindshipment', k: ['blind shipment', 'blind bol'], term: 'Blind shipment', def: 'A shipment where the shipper hides the identity of the consignee or origin from the carrier, to prevent being cut out of the deal.' },
];

const DEFINE = /\b(what is|what s|whats|what does|what do|what are|define|definition|meaning|mean|stand for|explain|difference|diff between|tell me about|describe|vs|versus|how does)\b/;

/** A glossary hit when the question is asking what a freight word means (or is little more than the word itself). */
export function glossary(sq) {
  const words = sq.split(' ').length;
  const defined = DEFINE.test(sq) || words <= 4;
  if (!defined) return null;
  let best = null, bl = 0;
  const padded = ' ' + sq + ' ';
  for (const g of GLOSSARY) for (const k of g.k) {
    const kn = ns(k); if (!kn) continue;
    if (padded.includes(' ' + kn + ' ') || (kn.length >= 5 && sq.split(' ').some(w => near(w, kn)))) { if (kn.length > bl) { best = g; bl = kn.length; } }
  }
  if (!best) return null;
  return A('glossary', `${best.term}: ${best.def}`, { mood: 'smart', ...(best.tip ? { steps: [best.tip] } : {}), ...(best.links ? { links: best.links } : {}) });
}

// ------------------------------------------------------------------------------------------------ broker playbook (judgement questions)
export function playbook(sq, data = {}) {
  const s = data.settings || {};
  const book = Number.isFinite(Number(s.ladderBookPct)) ? Number(s.ladderBookPct) : 3, split = Number.isFinite(Number(s.ladderSplitPct)) ? Number(s.ladderSplitPct) : 8;
  if (has(sq, /\b(negotiat|counter|haggl|bargain|lowball|too high|carrier wants more|carrier says|carriers say|push back|pushback|rate too low)\b/) && has(sq, /\b(carrier|rate|how|what|negotiat|counter|say|reply|respond)\b/)) {
    return A('playbook', `Freight Signal counters in steps, measured against your target rate. A carrier at or under ${book}% above target gets "confirm your ETA" (book it). Up to ${split}% above gets a split-the-difference counter. Anything higher gets a counter at your target. It never counters lower than your last offer and never repeats the same answer twice.`, {
      mood: 'smart', steps: ['Anchor on all-in. Ask for the total so fuel and extras are not hiding in a separate number.', 'Counter once, then move in small steps. Splitting the difference signals you are serious without giving the load away.', 'If they repeat the same number, stop countering. Offer something else instead: a better pickup window, a backhaul, quick pay.', 'Check the lane card: if carriers have covered this lane lower before, say so; if the market has moved, raise the target a little and repost.', 'Keep it short. A two-line reply gets answered; a paragraph does not.'],
      links: [{ label: 'Wording and ladder (System)', route: 'system' }],
    });
  }
  if (has(sq, /\b(get more covers|cover more|more loads covered|increase my covers|improve my covers|raise my covers|hit my floor|hit my numbers?|beat my floor|cover faster|how do i cover|how to cover|best way to cover|speed up|faster covers?|work faster|be faster|more efficient)\b/) || /\b(how|ways?) (can|do|to) (i|we) (cover|get more) (more|faster)\b/.test(sq)) {
    return A('playbook', 'The fastest levers, in order of how much they usually move a load:', {
      mood: 'smart', steps: ['Rate first. If a load has no replies after a couple of hours, compare the target with what has covered on that lane and raise it a little.', 'Nine postings beat one. Build the 3 x 3 matrix and keep it fresh; reshuffle when it goes stale.', 'Call the trucks that are already matched before e-mailing cold carriers: a truck empty nearby is the best lead you have.', 'Answer fast. Cover Desk shows what needs you; replies inside minutes win loads.', 'Turn on Auto Rescue for hard lanes so they keep working while you handle easy ones.', 'Ask the team after two hours. Someone often has a truck coming empty into that area.'],
      links: [{ label: 'Open Cover Desk', route: 'coverdesk' }, { label: 'Open Load Board', route: 'board' }], follow: ['What should I work on first?', 'Analyze my business'],
    });
  }
  if (has(sq, /\b(carrier (isn t|isnt|is not|not) (replying|answering|responding)|no response|nobody (replies|responds|answers|is replying)|no one (replies|responds|answers)|ghost|ghosting|not replying|no replies)\b/)) {
    return A('playbook', 'Silence usually means the rate or the timing is wrong, not that carriers are rude.', {
      mood: 'smart', steps: ['Change something before you resend. The same offer twice gets the same silence: move the rate, the pickup window or the pickup radius.', 'Widen the audience: more postings, a second wave of carriers who have run the lane, or a Truck check for trucks near the pickup.', 'Pick up the phone for the top three matched trucks. A call beats five e-mails.', 'Past two hours with no replies, post to the team and let Auto Rescue keep working it.'],
      links: [{ label: 'Open Load Board', route: 'board' }],
    });
  }
  if (has(sq, /\b(vet|vetting|check|verify|trust|scam|fraud|fake|legit|legitimate|safe)\b/) && has(sq, /\b(carrier|carriers|mc|dot|driver|authority)\b/)) {
    return A('playbook', 'Before a new carrier\'s first load, a quick vetting routine protects you from fraud and double brokering:', {
      mood: 'smart', steps: ['Look up the MC and USDOT on FMCSA SAFER: authority active, not newly issued, insurance on file.', 'Match the e-mail domain, phone and address to the company. Be wary of a free e-mail, a brand-new authority, or a carrier who changes details mid-deal.', 'Get the carrier packet: contract, W-9 and a current COI naming you, with cargo and liability limits that fit the load.', 'Confirm the driver and truck at pickup against what you were told, and get the signed rate confirmation back before dispatch.', 'Never change payment instructions on an e-mail alone; call the factor or carrier on a number you already trusted.'],
    });
  }
  if (has(sq, /\b(follow up|follow-up|followup|chase|check back|ping)\b/) && has(sq, /\b(carrier|carriers|shipper|customer|load|quote)\b/)) {
    return A('playbook', 'A good follow-up adds something. Do not send "any update?":', { mood: 'smart', steps: ['Same day: confirm they saw it and offer one new fact (a better pickup window, a backhaul, a rate move).', 'Next morning: a short "still need coverage on X, rate is now Y", after a rate change.', 'After that, move on. Their silence is an answer; spend the time on carriers who respond.', 'Freight Signal never re-sends the same offer on its own; the Inquiry Log shows who has answered.'] });
  }
  return null;
}
