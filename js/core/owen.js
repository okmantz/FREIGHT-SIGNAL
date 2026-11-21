// "What would Owen do?" (v17): the in-app helper. A local, offline knowledge base: no network, no AI service, nothing leaves the browser.
//   answer(question, ctx)  ->  { text, steps?, links?: [{label, route}], act?: [{label, id}], topic }
//   loadAdvice(load)       ->  { headline, steps:[], act:[] }   what Owen would do next on a stuck load
// Pure: no DOM, no storage. ctx = { loads: [load facts], page }.

export const norm = (s) => String(s || '').toLowerCase().replace(/[^a-z0-9$ ]+/g, ' ').replace(/\s+/g, ' ').trim();
const STOP = new Set('a an the to of in on for is are do does did how can i me my we you it this that what where when why with and or at be get want need find make use'.split(' '));
const tok = (s) => norm(s).split(' ').filter(w => w && !STOP.has(w));
const stem = (w) => w.replace(/(ing|ed|es|s)$/, '');

/** Each topic: keywords (any hit scores), a plain answer, optional steps, and where to go. */
export const TOPICS = [
  { id: 'start', k: ['start', 'begin', 'new', 'first', 'getting', 'tutorial', 'learn', 'how does', 'overview', 'basics'], text: 'Three steps. Paste your TQL load on the Load Board, set one target rate, then download the DAT CSV and upload it to DAT. That is the whole daily loop. Everything else (carrier outreach, Auto Rescue, matches) is there when a load is hard to cover.',
    steps: ['Open Load Board and paste the load into the box at the top.', 'Press Build 3×3 matrix if you want the nearby postings, and set the target rate.', 'Press Download DAT CSV and upload it in DAT’s bulk posting tool.', 'When carriers reply, paste the e-mail into Inquiry Log, or let the Outlook macro log it.'], links: [{ label: 'Open Load Board', route: 'board' }] },
  { id: 'addload', k: ['add load', 'paste load', 'new load', 'post load', 'create load', 'enter load', 'tql', 'upload load'], text: 'Paste the load text from TQL into the box at the top of the Load Board and press Add. The app reads origin, destination, pickup, weight and equipment for you.', steps: ['Load Board → paste box at the top.', 'Check the pickup, weight and equipment on the load card.', 'Set the Target rate.'], links: [{ label: 'Open Load Board', route: 'board' }] },
  { id: 'matrix', k: ['matrix', '3x3', 'nine', '9 posting', 'a-a', 'a-b', 'variation', 'postings', 'reshuffle', 'nearby'], text: 'The matrix is nine DAT postings for one load: the original (A-A) plus nearby origin and destination cities (A-B, B-C and so on). More postings means more carriers see the load. Tick the ones you want, download the CSV, and reshuffle when a set has gone stale.', links: [{ label: 'Open Load Board', route: 'board' }] },
  { id: 'dat', k: ['dat', 'csv', 'download', 'bulk', 'rateview', 'post on dat', 'upload to dat'], text: 'Use Download DAT CSV on the load (or the board toolbar for everything). Then upload that file in DAT’s bulk posting tool. Freight Signal never posts to DAT for you.', links: [{ label: 'Open Load Board', route: 'board' }] },
  { id: 'rate', k: ['rate', 'price', 'target', 'how much', 'suggested', 'raise', 'lower', 'margin', 'pay'], text: 'Each load has one target rate for all its postings. Freight Signal suggests one from your lane history, replies and the market, and the lane card shows whether you are above or below what has covered before. If a load is quiet, raise the target a little and re-upload the CSV.', links: [{ label: 'Open Load Board', route: 'board' }] },
  { id: 'carrierdb', k: ['carrier database', 'carriers', 'carrier list', 'my carriers', 'find carrier', 'import carriers', 'add carrier', 'who covers'], text: 'The Carrier Database lists everyone you cover with. Search at the top, pick a quick view (Active, Ready to contact, Never contacted, Has covered), click a row to open all its details, and use Truck? to ask a carrier if they have a truck.', links: [{ label: 'Open Carrier Database', route: 'carriers' }] },
  { id: 'customerdb', k: ['customer', 'shipper', 'customers'], text: 'The Customer Database holds shippers and contacts, grouped by company. Search, filter by state or status, and click a row to open it.', links: [{ label: 'Open Customer Database', route: 'customers' }] },
  { id: 'coverlog', k: ['cover log', 'covered loads', 'history', 'closed', 'pace', 'covered', 'mark covered', 'how many covers'], text: 'Press Mark covered on a load to log which posting and carrier covered it. The Cover Log shows everything by day, with Restore if you closed one by mistake. It feeds lane memory, carrier ranking and the pace tracker.', links: [{ label: 'Open Cover Log', route: 'covers' }] },
  { id: 'inquiry', k: ['inquiry', 'inquiries', 'reply', 'replies', 'carrier email', 'e-mail', 'email from carrier', 'process email', 'answered'], text: 'Carrier replies live in the Inquiry Log, newest first. Paste an e-mail into Process carrier e-mail and Freight Signal matches it to the load, logs it and drafts the answer.', links: [{ label: 'Open Inquiry Log', route: 'inquiry' }] },
  { id: 'spare', k: ['spare', 'park', 'save load', 'restore load', 'set aside'], text: 'Spare Load Details parks a load so you can bring it back later. Use Save to Spare in the load’s More menu, then Restore to board from the card.', links: [{ label: 'Open Spare Loads', route: 'spare' }] },
  { id: 'drafts', k: ['draft', 'drafts', 'outbox', 'send email', 'outlook', 'sent'], text: 'Everything Freight Signal writes is a draft first. Review it in Drafts, or let it land in Outlook Drafts. By default nothing is sent on its own; you can allow automatic sending in System once you trust it.', links: [{ label: 'Open Drafts', route: 'drafts' }] },
  { id: 'outreach', k: ['outreach', 'contact carriers', 'email carriers', 'blast', 'who to email', 'reach out', 'truck check', 'trucks available'], text: 'Press Carrier outreach on the load for drafts to the best-matched carriers, or Truck check to ask who has a truck near the pickup. Carriers are ranked by lane fit, past covers and how recently you spoke.', links: [{ label: 'Open Load Board', route: 'board' }] },
  { id: 'autorescue', k: ['auto rescue', 'autorescue', 'escalate', 'hard load', 'difficult', 'nobody', 'no one', 'work it until', 'keep working', 'automatic'], text: 'Auto Rescue keeps working a load until it is covered. It matches trucks right away, sends a first wave of offers, widens the markets, rechecks the rate within the limit you set, then asks the team. Every step is different and no carrier is bombarded. Hit the Auto Rescue button on the load.', links: [{ label: 'Open Load Board', route: 'board' }] },
  { id: 'matches', k: ['match', 'matches', 'truck match', 'matching', 'qualified'], text: 'Every load is checked against every available truck (yours and the team’s), and every new truck against every open load. Cover Desk shows how many qualified trucks each load has.', links: [{ label: 'Open Cover Desk', route: 'coverdesk' }] },
  { id: 'trucks', k: ['truck', 'trucks', 'truck book', 'availability', 'capacity', 'posted truck', 'dat truck', 'empty'], text: 'Add trucks you hear about on Cover Desk (paste an e-mail or a list). Fresh trucks rank highest and expire after a day and a half. Team members can share trucks too.', links: [{ label: 'Open Cover Desk', route: 'coverdesk' }, { label: 'Team Truck Board', route: 'trucks' }] },
  { id: 'coverdesk', k: ['cover desk', 'needs my eyes', 'call these', 'what needs me', 'exception', 'held'], text: 'Cover Desk is the "what needs me right now" screen: held e-mails, who to call first, trucks that are free, and truck matches per load.', links: [{ label: 'Open Cover Desk', route: 'coverdesk' }] },
  { id: 'team', k: ['team', 'help from team', 'ask team', 'share', 'colleague', 'coworker', 'rescue', 'load rescue'], text: 'The Team pages let you share trucks, ask for help on a load and see lane intelligence. Join a team on the Team page; then Ask the team appears on quiet loads.', links: [{ label: 'Open Team', route: 'team' }, { label: 'Load Rescue', route: 'rescue' }] },
  { id: 'settings', k: ['setting', 'settings', 'theme', 'dark', 'light', 'color', 'appearance', 'account', 'profile', 'password', 'sign out', 'logout', 'log out'], text: 'Appearance and your account are under Account Settings (the palette icon at the top right). Sign out is the arrow icon next to it. Sending options, e-mail wording and backups are on the System page.', links: [{ label: 'Account Settings', route: 'account' }, { label: 'System', route: 'system' }] },
  { id: 'backup', k: ['backup', 'restore', 'export', 'import', 'data', 'lost', 'sync', 'cloud'], text: 'System has Backup and Restore for all your data, and Cloud sync if you sign in. Carrier and customer lists also export to CSV from their pages.', links: [{ label: 'Open System', route: 'system' }] },
  { id: 'zip', k: ['zip', 'map', 'distance', 'miles', 'zip map'], text: 'ZIP Map shows the ZIP database used for mileage and nearby-city matching. If a city is unknown, add its ZIP there.', links: [{ label: 'Open ZIP Map', route: 'zipmap' }] },
  { id: 'manual', k: ['manual', 'documentation', 'docs', 'guide', 'instructions', 'help'], text: 'The User Manual has the full guide. Ask me about a specific thing and I will point you straight to it.', links: [{ label: 'Open User Manual', route: 'manual' }] },
  { id: 'lanes', k: ['lane intel', 'lane', 'lanes', 'market', 'corridor', 'backhaul'], text: 'Lane Intel shows what is covering on which lanes across the team. On a load card, the coverage strip shows the suggested rate, matching trucks and a backhaul to offer.', links: [{ label: 'Open Lane Intel', route: 'lanes' }] },
];

const SOCIAL = [
  { k: ['hello', 'hi', 'hey', 'good morning', 'good afternoon', 'yo'], text: 'Hey, Owen here. Ask me where something is, how to do something, or tell me which load is giving you trouble and I will tell you what I would do.' },
  { k: ['thanks', 'thank you', 'thx', 'appreciate'], text: 'Anytime. Go cover something.' },
  { k: ['who are you', 'your name', 'what are you', 'are you real', 'are you ai', 'are you a bot'], text: 'I am Owen, the helper built into Freight Signal. I am not a person on the line; I am a built-in guide that knows this app and a broker’s playbook for stuck loads. I run entirely in your browser.' },
  { k: ['joke', 'funny', 'tell me something'], text: 'Why did the load stay on the board all night? It was waiting for a carrier with a better rate. Ba dum. Now, which load needs covering?' },
  { k: ['bye', 'goodbye', 'see you'], text: 'Good luck out there.' },
];

/** Score a topic: each keyword scores by how many of its words appear in the question (phrases beat single words). */
function score(q, qt, k) {
  const kn = norm(k); if (!kn) return 0;
  if (q.includes(kn)) return kn.includes(' ') ? 3 + kn.split(' ').length : 3;
  const kt = kn.split(' ').filter(w => !STOP.has(w)); if (!kt.length) return 0;
  const hit = kt.filter(w => qt.some(x => stem(x) === stem(w))).length;
  return hit === kt.length ? 2 : 0;
}

const GENERIC_STUCK = ['stuck', 'cant cover', "can't cover", 'cannot cover', 'not covering', 'wont cover', 'sitting', 'no replies', 'no calls', 'nobody called', 'dead load', 'how do i cover', 'help me cover', 'hard to cover', 'what would owen do', 'what would you do'];

export function answer(question, ctx = {}) {
  const q = norm(question); const qt = tok(question);
  if (!q) return { topic: 'empty', text: 'Ask me anything about Freight Signal, or tell me which load is stuck.' };
  const loads = ctx.loads || [];
  // a stuck-load question gets load-aware advice
  if (GENERIC_STUCK.some(w => q.includes(norm(w))) || /\b(stuck|cover|covering)\b/.test(q) && /\b(load|lane|it)\b/.test(q) && !/\b(log|database)\b/.test(q)) {
    const named = loads.find(l => l.keys && l.keys.some(x => x && q.includes(norm(x))));
    const pick = named || [...loads].sort((a, b) => (b.stuckScore || 0) - (a.stuckScore || 0))[0];
    if (pick) { const a = loadAdvice(pick); return { topic: 'stuck', text: `Here is what I would do on ${pick.title}. ${a.headline}`, steps: a.steps, act: a.act, loadId: pick.id }; }
    return { topic: 'stuck', text: 'When a load will not cover: check the rate against what has covered on that lane, post more of the matrix, ask carriers who have run it, and turn on Auto Rescue so it keeps working while you handle other loads. Add a load and I can get specific.', links: [{ label: 'Open Load Board', route: 'board' }] };
  }
  for (const s of SOCIAL) if (s.k.some(k => q === norm(k) || q.startsWith(norm(k) + ' ') || (norm(k).includes(' ') && q.includes(norm(k))))) return { topic: 'social', text: s.text };
  let best = null, bs = 0;
  for (const t of TOPICS) { let sc = 0; for (const k of t.k) sc = Math.max(sc, score(q, qt, k)); if (sc > bs) { bs = sc; best = t; } }
  if (best && bs >= 2) return { topic: best.id, text: best.text, steps: best.steps, links: best.links };
  if (/\b(weather|stock|news|score|recipe|politic|election)\b/.test(q)) return { topic: 'offtopic', text: 'That is outside my lane. I can help with Freight Signal and with covering freight. Try asking where something is, or tell me which load is stuck.' };
  return { topic: 'unknown', text: 'I am not sure what you mean yet. Try something like "where do I add a carrier", "how do I post on DAT", or "this load is stuck". I know every page in the app.', links: [{ label: 'User Manual', route: 'manual' }] };
}

/** What Owen would do next on one load. load = { title, ageMin, inquiries, quotes, matches, hot, hard, targetRate, datRate, memRate, rescue ('active'|'stopped'|'' ), postings, posted, contacted } */
export function loadAdvice(l) {
  const steps = []; const act = []; const hrs = Math.round((l.ageMin || 0) / 6) / 10;
  if (!l.postings || l.postings < 3) { steps.push('Build the 3×3 matrix so nine postings are working instead of one. It is the cheapest way to get more eyes on the load.'); act.push({ label: 'Open the load', id: 'open-load' }); }
  if (!l.targetRate) steps.push('Set a target rate. Without one there is nothing to judge replies against.');
  else if (l.memRate && l.targetRate < l.memRate * 0.93) steps.push(`Your target is below what has covered on this lane (about $${Math.round(l.memRate)}). A modest raise is the fastest fix.`);
  else if (hrs >= 3 && !l.inquiries) steps.push('It has been up a few hours with no replies. Raise the target a little and re-upload the CSV so it reposts fresh.');
  if (l.matches > 0) steps.push(`${l.matches} qualified truck${l.matches === 1 ? ' is' : 's are'} already matched. Call them first; a truck that is already empty nearby beats a cold e-mail.`);
  else steps.push('No qualified trucks match right now. Add any trucks you have heard about on Cover Desk and I will match them the moment they fit.');
  if (!l.contacted) steps.push('Nobody has been contacted yet. Run Carrier outreach for drafts to the best-ranked carriers.');
  else steps.push('Do not send the same offer again. Change something: the rate, the pickup window, or a wider pickup radius.');
  if (l.rescue !== 'active') { steps.push('Turn on Auto Rescue so it keeps matching, widening and repricing within your limit while you work other loads.'); act.push({ label: 'Start Auto Rescue', id: 'auto-rescue' }); }
  else steps.push('Auto Rescue is already working it. Check its log to see what it has tried.');
  if (hrs >= 2) steps.push('Past two hours, ask the team. Someone often has a truck coming empty into that area.');
  const headline = l.hard ? `This is a hard lane (${l.title}), so expect it to need more than one pass. ` + (hrs ? `It has been open about ${hrs} hours.` : '') : (hrs ? `It has been open about ${hrs} hours.` : 'It is new, so start with the basics.');
  return { headline, steps: steps.slice(0, 6), act };
}

export const SUGGESTIONS = ['This load is stuck, what would you do?', 'How do I post on DAT?', 'Where is the carrier database?', 'What is Auto Rescue?', 'How do I add trucks?'];
