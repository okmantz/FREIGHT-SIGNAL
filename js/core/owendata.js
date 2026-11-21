// Owen reads YOUR workspace (v18). Every function answers from the snapshot passed in, never from memory, so numbers are always the real ones.
//   data = { now, name, loads: [load facts], covers: coverLog[], carriers[], customers[], inquiries[], trucks[] (active only), pace, settings, held, sentToday }
//   load facts: { id, title, oCity, oState, dCity, dState, loadNumber, keys, ageMin, inquiries, matches, hard, targetRate, datAvg, postings, contacted, rescue,
//                 stuckScore, pickup, broker, equip, weight, memRate }
import { ns, money, money2, plural, pct, span, ago, rangeOf, near } from './owentext.js';
import { attributionFromLog, cityPerformance } from './coverlog.js';
import { loadAdvice } from './owen.js';

const A = (topic, text, extra = {}) => ({ topic, text, mood: 'smart', ...extra });
const has = (sq, ...res) => res.some(r => r.test(sq));
const num = (v) => { const n = Number(String(v ?? '').replace(/[$,]/g, '')); return Number.isFinite(n) ? n : 0; };
const lc = (s) => String(s || '').toLowerCase().trim();
const isCover = (e) => e && e.outcome === 'Covered';
const day0 = (t) => { const d = new Date(t); d.setHours(0, 0, 0, 0); return d.getTime(); };
const inRange = (t, r) => !r || (t >= r.from && t < r.to);
const T = (e) => Date.parse(e.closedAt);
const HOW_TO = /^(how (do|can|should|would|could) (i|we)|how to|where (do|can|is|are|should)|how (does|do) (the )?(app|freight signal)|can i (add|change|edit|delete|remove|import|export|set|turn))\b/;

/** Whole-word / whole-phrase test of a place or name inside the normalised question (tolerates one typo in long words). */
function mentions(sq, name) {
  const n = ns(name); if (!n || n.length < 3) return false;
  if ((' ' + sq + ' ').includes(' ' + n + ' ')) return true;
  if (n.length >= 6 && !n.includes(' ')) return sq.split(' ').some(w => near(w, n));
  return false;
}
const placeOf = (c, s) => [c, s].filter(Boolean).join(', ');
const laneText = (l) => `${placeOf(l.originCity || l.oCity, l.originState || l.oState)} to ${placeOf(l.destCity || l.dCity, l.destState || l.dState)}`;

// ------------------------------------------------------------------------------------------------ finding things the question names
/** Open loads the question points at, best match first. */
export function findLoads(sq, loads = []) {
  const out = [];
  for (const l of loads) {
    let sc = 0;
    if (l.loadNumber && String(l.loadNumber).length >= 3 && sq.includes(ns(l.loadNumber))) sc += 10;
    const o = mentions(sq, l.oCity), d = mentions(sq, l.dCity);
    if (o && d) sc += 8; else if (o || d) sc += 3;
    if (sc) out.push({ l, sc });
  }
  return out.sort((a, b) => b.sc - a.sc).map(x => x.l);
}
/** Lanes (origin/destination pairs) the question names, from the cover log and open loads. */
export function findLanes(sq, data) {
  const seen = new Map();
  const add = (o, os, d, ds, src) => {
    if (!o || !d) return; const k = ns(o + os + d + ds);
    const oo = mentions(sq, o), dd = mentions(sq, d);
    if (!(oo && dd)) { return; }
    if (!seen.has(k)) seen.set(k, { oCity: o, oState: os, dCity: d, dState: ds, src });
  };
  for (const l of data.loads || []) add(l.oCity, l.oState, l.dCity, l.dState, 'load');
  for (const e of data.covers || []) { const l = e.lane || {}; add(l.originCity, l.originState, l.destCity, l.destState, 'cover'); }
  return [...seen.values()];
}
const cityState = (data) => {
  const m = new Map();
  const add = (c, s) => { if (c) m.set(ns(c), { city: c, state: s || '' }); };
  for (const l of data.loads || []) { add(l.oCity, l.oState); add(l.dCity, l.dState); }
  for (const e of data.covers || []) { const l = e.lane || {}; add(l.originCity, l.originState); add(l.destCity, l.destState); }
  for (const t of data.trucks || []) add(t.oCity, t.oState);
  for (const c of data.carriers || []) { add(c.originCity, c.originState); add(c.destCity, c.destState); }
  return [...m.values()];
};
const citiesIn = (sq, data) => cityState(data).filter(c => mentions(sq, c.city) || (c.state && new RegExp('\\b' + ns(c.city) + ' ' + ns(c.state) + '\\b').test(sq)));
const stateAbbr = new Set('al ak az ar ca co ct de dc fl ga hi id il in ia ks ky la me md ma mi mn ms mo mt ne nv nh nj nm ny nc nd oh ok or pa ri sc sd tn tx ut vt va wa wv wi wy'.split(' '));

function findCarrier(sq, carriers = []) {
  const hits = [];
  for (const c of carriers) {
    const name = ns(c.carrierName); const email = lc(c.email); const mc = String(c.mc || '').replace(/\D/g, '');
    let sc = 0;
    if (mc.length >= 4 && sq.replace(/\D+/g, ' ').split(' ').includes(mc)) sc = 12;
    else if (email && sq.includes(email)) sc = 12;
    else if (name.length >= 4) {
      if ((' ' + sq + ' ').includes(' ' + name + ' ')) sc = 10;
      else { const ws = name.split(' ').filter(w => w.length >= 4 && !/^(trucking|transport|transportation|logistics|freight|llc|inc|express|lines|carriers?|company|services?)$/.test(w)); if (ws.length && ws.every(w => sq.split(' ').some(x => x === w || near(x, w)))) sc = 7; }
    }
    if (sc) hits.push({ c, sc });
  }
  return hits.sort((a, b) => b.sc - a.sc).map(x => x.c);
}
function findCustomer(sq, customers = []) {
  const hits = [];
  for (const c of customers) {
    const co = ns(c.company), contact = ns(c.contactName);
    if (co.length >= 3 && (' ' + sq + ' ').includes(' ' + co + ' ')) hits.push({ c, sc: 10 });
    else if (contact.length >= 5 && (' ' + sq + ' ').includes(' ' + contact + ' ')) hits.push({ c, sc: 8 });
    else { const ws = co.split(' ').filter(w => w.length >= 5 && !/^(logistics|freight|company|industries|manufacturing|distribution|group|international|products|services)$/.test(w)); if (ws.length && ws.every(w => sq.split(' ').includes(w))) hits.push({ c, sc: 5 }); }
  }
  return hits.sort((a, b) => b.sc - a.sc).map(x => x.c);
}
const brokerIn = (sq, data) => ((data.settings && data.settings.brokers) || []).find(b => b && mentions(sq, b)) || '';

// ------------------------------------------------------------------------------------------------ pieces
function carrierCovers(data, carrier) {
  const em = lc(carrier.email), mc = String(carrier.mc || '').replace(/\D/g, '');
  const mine = (data.covers || []).filter(e => isCover(e) && e.carrier && ((em && lc(e.carrier.email) === em) || (mc && String(e.carrier.mc || '').replace(/\D/g, '') === mc)));
  const rates = mine.map(e => num(e.rate)).filter(x => x > 0);
  return { n: mine.length, avg: rates.length ? rates.reduce((a, b) => a + b, 0) / rates.length : 0, last: mine.sort((a, b) => T(b) - T(a))[0] || null };
}
function laneCovers(data, lane) {
  const same = (l) => l && ns(l.originCity) === ns(lane.oCity) && ns(l.destCity) === ns(lane.dCity);
  return (data.covers || []).filter(e => isCover(e) && (same(e.lane) || same(e.covered))).sort((a, b) => T(b) - T(a));
}
const stat = (xs) => { const v = xs.filter(x => x > 0); if (!v.length) return null; const s = [...v].sort((a, b) => a - b); return { n: v.length, avg: v.reduce((a, b) => a + b, 0) / v.length, min: s[0], max: s[s.length - 1], med: s[Math.floor(s.length / 2)] }; };

const loadRow = (l) => [`${l.title}`, [l.inquiries ? plural(l.inquiries, 'reply', 'replies') : 'no replies', l.matches ? plural(l.matches, 'truck') + ' matched' : null, l.ageMin ? span(l.ageMin * 60000) + ' old' : 'new'].filter(Boolean).join(' · ')];

// ------------------------------------------------------------------------------------------------ the intents
// Each: (sq, data, mem) -> answer | null.  Order in INTENTS matters (specific before general).
const INTENTS = [];
const intent = (id, fn) => INTENTS.push({ id, fn });

intent('summary', (sq, d) => {
  if (!has(sq, /\b(summary|summarize|summarise|briefing|brief me|brief|catch me up|catch up|rundown|run down|overview|status report|what s going on|whats going on|whats happening|what is happening|how s everything|hows everything|how is everything|how are things|hows things|how things are|where do things stand|where are we|state of things|big picture|morning report|daily report|end of day|eod)\b/)) return null;
  const loads = d.loads || [], p = d.pace;
  const quiet = loads.filter(l => (l.stuckScore || 0) >= 4);
  const facts = [];
  if (p) { facts.push(['Covers today', String(p.today)]); facts.push(['This week', `${p.week} of ${p.floor}` + (p.projection === null ? '' : ` (heading to ${p.projection})`)]); }
  facts.push(['Open loads', `${loads.length}` + (quiet.length ? `, ${quiet.length} quiet` : '')]);
  const tr = (d.trucks || []).length; if (tr) facts.push(['Trucks available', String(tr)]);
  if (d.held) facts.push(['E-mails needing you', String(d.held)]);
  const todayIn = (d.inquiries || []).filter(q => Date.parse(q.dateCounted) >= day0(d.now)).length; facts.push(['Carrier inquiries today', String(todayIn)]);
  const steps = [];
  if (quiet.length) steps.push(`Start with ${quiet.sort((a, b) => b.stuckScore - a.stuckScore)[0].title}: it has the least going for it right now.`);
  if (d.held) steps.push(`Clear the ${plural(d.held, 'held e-mail')} on Cover Desk.`);
  if (p && p.status === 'short') steps.push(`You need about ${p.perDay} covers a day to reach ${p.floor}.`);
  if (!loads.length) steps.push('The board is empty: paste a TQL load to get started.');
  return A('summary', p && p.status === 'on' ? 'Here is where things stand, and you are on pace.' : 'Here is where things stand.', { mood: p && p.status === 'on' ? 'thumbs' : 'smart', facts, steps, links: [{ label: 'Open Cover Desk', route: 'coverdesk' }, { label: 'Open Load Board', route: 'board' }], follow: ['What should I work on first?', 'Analyze my business'] });
});

intent('priority', (sq, d) => {
  if (!has(sq, /\b(what should i (do|work on|tackle|focus on|start|handle)|where (do|should) i (start|focus)|what s next|whats next|what is next|what s important|whats important|priorit|urgent|needs? (my )?(attention|help|eyes|work)|top (loads|things|priorities)|first thing|work on first|what now|what do i do now|what to do)\b/)) return null;
  const loads = [...(d.loads || [])].sort((a, b) => (b.stuckScore || 0) - (a.stuckScore || 0));
  const rows = loads.slice(0, 4).map(loadRow);
  const steps = [];
  if (d.held) steps.push(`${plural(d.held, 'carrier e-mail')} waiting on Cover Desk. Replies inside minutes win loads, so clear these first.`);
  const hot = loads.find(l => l.matches > 0); if (hot) steps.push(`${hot.title} already has ${plural(hot.matches, 'qualified truck')}. Call them before you e-mail anyone cold.`);
  if (loads[0]) { const a = loadAdvice(loads[0]); steps.push(`${loads[0].title} is your quietest load. ${a.steps[0] || ''}`.trim()); }
  if (!loads.length && !d.held) return A('priority', 'Nothing is waiting. Paste a TQL load on the Load Board and I will help you cover it.', { mood: 'relax', links: [{ label: 'Open Load Board', route: 'board' }] });
  return A('priority', 'Here is what I would do, in this order.', { steps, rows, links: [{ label: 'Open Cover Desk', route: 'coverdesk' }, { label: 'Open Load Board', route: 'board' }], loadId: loads[0] && loads[0].id, act: loads[0] && loads[0].rescue !== 'active' ? [{ label: 'Start Auto Rescue on ' + loads[0].title, id: 'auto-rescue' }] : undefined });
});

intent('pace', (sq, d, mem) => {
  const asksCovers = has(sq, /\b(how many covers?|covers? (today|yesterday|this week|last week|this month|last month|so far)|how am i doing|how are we doing|how s my week|hows my week|how is my week|my pace|on pace|on track|weekly (floor|goal|target|number)|hit my (floor|goal|number)|am i (ahead|behind)|covers? did i|did i cover|what did i cover|how s the week|hows the week|my numbers|my stats|my score|covered (today|this week|yesterday|last week))\b/);
  if (!asksCovers) return null;
  const log = d.covers || [], now = d.now || Date.now(), p = d.pace, broker = brokerIn(sq, d);
  const r = rangeOf(sq, now);
  const within = (rr) => log.filter(e => isCover(e) && inRange(T(e), rr) && (!broker || (e.broker || '') === broker));
  if (r && !['today', 'this week'].includes(r.label)) {
    const xs = within(r); const rates = stat(xs.map(e => num(e.rate))); const ages = stat(xs.map(e => num(e.ageHours)));
    const facts = [['Covers', String(xs.length)]]; if (rates) facts.push(['Average carrier rate', money(rates.avg)]); if (ages) facts.push(['Average time to cover', span(ages.avg * 3600000)]);
    return A('pace', `${plural(xs.length, 'cover')} ${r.label}${broker ? ' for ' + broker : ''}.`, { mood: xs.length ? 'thumbs' : 'smart', facts, follow: ['And this week?', 'How am I doing this week?'] });
  }
  if (r && r.label === 'today') { const xs = within(r); return A('pace', `${plural(xs.length, 'cover')} so far today${broker ? ' for ' + broker : ''}.` + (p ? ` That is ${p.week} this week against your floor of ${p.floor}.` : ''), { mood: xs.length ? 'thumbs' : 'smart', follow: ['How am I doing this week?'] }); }
  if (!p) return A('pace', 'I cannot see your cover pace yet. Mark a load Covered and I will start tracking it.', { links: [{ label: 'Open Cover Log', route: 'covers' }] });
  const label = { on: 'on pace', close: 'just short', short: 'short', early: 'too early to call' }[p.status];
  const facts = [['Today', String(p.today)], ['This week', `${p.week} of ${p.floor}`]];
  if (p.projection !== null) facts.push(['Heading to', `${p.projection} (${label})`]);
  if (p.need > 0) facts.push(['Still needed', `${p.need}` + (p.daysLeft > 0 ? `, about ${p.perDay} a day` : '')]);
  const last7 = within({ from: day0(now) - 6 * 86400000, to: Infinity }).length, prev7 = within({ from: day0(now) - 13 * 86400000, to: day0(now) - 6 * 86400000 }).length;
  const trend = prev7 ? (last7 > prev7 ? ` Up from ${prev7} the week before.` : last7 < prev7 ? ` Down from ${prev7} the week before.` : ' Level with the week before.') : '';
  return A('pace', (p.status === 'on' ? `You are on pace: ${p.week} covers this week against a floor of ${p.floor}.` : p.status === 'early' ? `${p.week} covers this week so far. It is too early in the week to project.` : `You have ${p.week} covers this week against a floor of ${p.floor}, so you are ${label}.`) + trend, { mood: p.status === 'on' ? 'thumbs' : 'smart', facts, links: [{ label: 'Open Cover Log', route: 'covers' }], follow: ['Analyze my business', 'What should I work on first?'] });
});

intent('covers', (sq, d) => {
  if (HOW_TO.test(sq)) return null;
  if (!has(sq, /\b(last cover|latest cover|most recent cover|recent covers|recently covered|last load (i )?covered|list (my )?covers|show (me )?(my )?covers|covers? log|who covered|what covered|which (carrier|truck) covered|covered (it|that|the))\b/)) return null;
  const log = (d.covers || []).filter(isCover).sort((a, b) => T(b) - T(a));
  if (!log.length) return A('covers', 'Nothing in your Cover Log yet. Press Mark covered on a load and it will show up here.', { links: [{ label: 'Open Cover Log', route: 'covers' }] });
  const lanes = findLanes(sq, d), cities = citiesIn(sq, d);
  let pool = log;
  if (lanes.length) pool = laneCovers(d, lanes[0]); else if (cities.length) pool = log.filter(e => { const l = e.lane || {}; return cities.some(c => ns(c.city) === ns(l.originCity) || ns(c.city) === ns(l.destCity)); });
  if (!pool.length) return A('covers', 'I do not see a cover on that in your log.', { links: [{ label: 'Open Cover Log', route: 'covers' }] });
  const rows = pool.slice(0, 6).map(e => [`${laneText(e.lane || {})}`, `${e.carrier && (e.carrier.name || e.carrier.email) ? e.carrier.name || e.carrier.email : 'carrier not logged'}${num(e.rate) ? ' · ' + money(e.rate) : ''} · ${ago(e.closedAt, d.now || Date.now())}`]);
  return A('covers', `Your most recent ${pool === log ? '' : 'matching '}cover${pool.length === 1 ? ' is' : 's are'}:`, { rows, links: [{ label: 'Open Cover Log', route: 'covers' }] });
});

intent('insights', (sq, d) => {
  if (!has(sq, /\b(analy[sz]e|analysis|insights?|audit|review my|performance|improve|improvement|what am i doing (wrong|right)|how can i do better|where am i (losing|weak)|trends?|what s working|whats working|what works|business)\b/)) return null;
  if (HOW_TO.test(sq) && !/analy[sz]e|insight/.test(sq)) return null;
  const log = (d.covers || []).filter(isCover), now = d.now || Date.now(), p = d.pace;
  if (!log.length && !(d.loads || []).length) return A('insights', 'There is not enough to analyse yet: no covers in the log and no open loads. Cover a few loads and ask again, and I will show you what is working.', { mood: 'think' });
  const facts = [], tips = [];
  if (p) facts.push(['This week', `${p.week} of ${p.floor}` + (p.projection !== null ? ` (heading to ${p.projection})` : '')]);
  const w = (a, b) => log.filter(e => T(e) >= now - a * 86400000 && T(e) < now - b * 86400000).length;
  const l7 = w(7, 0), p7 = w(14, 7);
  if (log.length >= 3) { facts.push(['Last 7 days vs. the 7 before', `${l7} vs. ${p7}`]); if (p7 && l7 < p7) tips.push(`Covers are down from ${p7} to ${l7}. Look at which lanes stopped covering and whether your rates drifted below the market.`); else if (l7 > p7) tips.push(`Covers are up (${l7} vs. ${p7}). Whatever you changed last week is working: keep doing it.`); }
  const ages = stat(log.map(e => num(e.ageHours))); if (ages) { facts.push(['Average time to cover', span(ages.avg * 3600000)]); facts.push(['Fastest / slowest', `${span(ages.min * 3600000)} / ${span(ages.max * 3600000)}`]); }
  const rated = log.filter(e => num(e.rate) > 0 && num(e.targetRate) > 0);
  if (rated.length >= 3) { const gap = rated.reduce((s, e) => s + (num(e.rate) - num(e.targetRate)) / num(e.targetRate), 0) / rated.length; facts.push(['Carrier rate vs. your target', (gap >= 0 ? '+' : '') + pct(gap, 1)]); if (gap > 0.04) tips.push('Carriers are covering above your targets on average. Your targets may be a little low: post closer to what actually covers and you will save time.'); else if (gap < -0.03) tips.push('Loads are covering under target. You may have room to post a touch lower and keep more margin.'); }
  const a = attributionFromLog(log);
  const cities = cityPerformance(log, 'origin', 2).filter(c => c.wins > 0).slice(0, 3);
  if (cities.length) facts.push(['Best origin cities', cities.map(c => `${c.label} (${c.wins})`).join(', ')]);
  const grid = Object.entries(a.grid).filter(([, v]) => v.wins > 0).sort((x, y) => y[1].wins - x[1].wins)[0];
  if (grid) { facts.push(['Posting that covers most', `${grid[0]} (${grid[1].wins} of ${a.groups} covers)`]); }
  const byCarrier = [...a.carriers.entries()].sort((x, y) => y[1].covers - x[1].covers);
  if (byCarrier.length) { const top = byCarrier[0]; const share = top[1].covers / Math.max(1, log.length); facts.push(['Top carrier', `${top[0]} (${top[1].covers} covers${share >= 0.2 ? ', ' + pct(share) + ' of all' : ''})`]); if (share >= 0.35 && log.length >= 8) tips.push('One carrier covers over a third of your loads. That is great until they are unavailable: keep two or three backups warm on those lanes.'); }
  const quiet = (d.loads || []).filter(l => (l.stuckScore || 0) >= 4);
  if (quiet.length) { facts.push(['Quiet loads right now', String(quiet.length)]); tips.push(`${quiet.length === 1 ? 'One load looks' : quiet.length + ' loads look'} quiet. Ask me "what should I work on first?" for the order.`); }
  if (d.held) tips.push(`${plural(d.held, 'carrier e-mail')} ${d.held === 1 ? 'is' : 'are'} waiting for you on Cover Desk.`);
  if (!tips.length) tips.push('Nothing alarming. Keep the matrix fresh, answer replies inside minutes and keep an eye on the quiet loads.');
  return A('insights', 'Here is my read on your numbers.', { facts, steps: tips.slice(0, 4), links: [{ label: 'Open Cover Log', route: 'covers' }, { label: 'Open Lane Intel', route: 'lanes' }], follow: ['What should I work on first?', 'Who are my top carriers?'] });
});

intent('loadlookup', (sq, d, mem) => {
  if (HOW_TO.test(sq)) return null;
  const loads = d.loads || [];
  if (!loads.length) return null;
  if (has(sq, /\b(cover(ed)? (at|for)|rates?|price[ds]?|paid|pay|pays|paying|quote[ds]?)\b/) && !/\b(replies|reply|trucks?|status|stuck)\b/.test(sq)) return null;
  if (/\btrucks?\b/.test(sq) && /\b(near|around|available|empty|any|free|open)\b/.test(sq) && !/\b(load|loads|matched|matches)\b/.test(sq)) return null;   // "any trucks near Dallas" is about trucks, not the Dallas load
  const hits = findLoads(sq, loads);
  const pronoun = !hits.length && mem && mem.loadId && /\b(it|that load|this load|that one|this one)\b/.test(sq) ? loads.find(l => l.id === mem.loadId) : null;
  const wantsFacts = has(sq, /\b(about|status|update|how is|how s|hows|tell me|info|details?|replies|reply|inquir|quotes?|quoted|target|rate|trucks?|matches|matched|posted|postings|doing|age|old|pickup|picks? up|when|any news|any luck|any bites|any calls|working|stuck|covered|going on)\b/);
  const pick = pronoun || (hits[0] && (wantsFacts || hits.length === 1) ? hits[0] : null);
  if (!pick) return null;
  const ambiguous = !pronoun && hits.length > 1 && !(mentions(sq, hits[0].oCity) && mentions(sq, hits[0].dCity));
  if (ambiguous) return A('load', 'I see a few loads that fit. Which one do you mean?', { mood: 'think', rows: hits.slice(0, 5).map(loadRow), follow: hits.slice(0, 3).map(l => `Tell me about ${l.oCity} to ${l.dCity}`) });
  const l = pick; const adv = loadAdvice(l);
  const facts = [['Lane', l.title]];
  if (l.pickup) facts.push(['Pickup', l.pickup]);
  if (l.targetRate) facts.push(['Target rate', money(l.targetRate)]);
  if (l.datAvg) facts.push(['DAT average (typed)', money(l.datAvg)]);
  if (l.memRate) facts.push(['Last covered on this lane', money(l.memRate)]);
  facts.push(['Open for', l.ageMin ? span(l.ageMin * 60000) : 'just added'], ['Postings', String(l.postings || 1)], ['Carrier replies', String(l.inquiries || 0)], ['Qualified trucks', String(l.matches || 0)], ['Carriers contacted', String(l.contacted || 0)]);
  if (l.rescue) facts.push(['Auto Rescue', l.rescue === 'active' ? 'working it' : 'stopped']);
  if (l.broker) facts.push(['Broker', l.broker]);
  return A('load', `${l.title}: ${l.inquiries ? plural(l.inquiries, 'carrier reply', 'carrier replies') : 'no carrier replies yet'}, ${l.matches ? plural(l.matches, 'qualified truck') + ' matched' : 'no matched trucks'}. ${adv.headline}`, { facts, steps: adv.steps.slice(0, 4), act: adv.act, loadId: l.id, links: [{ label: 'Open Load Board', route: 'board' }], loadMem: l.id });
});

intent('openloads', (sq, d) => {
  if (HOW_TO.test(sq)) return null;
  if (!has(sq, /\b(how many (open )?loads|open loads|my loads|my board|on (my|the) board|list (my |the )?loads|show (me )?(my |the )?loads|what loads|which loads|loads (do i have|are open|are posted)|active loads|loads i have|loads posted|current loads|loads today|number of loads)\b/)) return null;
  const loads = [...(d.loads || [])].sort((a, b) => (b.stuckScore || 0) - (a.stuckScore || 0));
  if (!loads.length) return A('openloads', 'Your board has no open loads right now. Paste a TQL load and I will help you cover it.', { mood: 'relax', links: [{ label: 'Open Load Board', route: 'board' }] });
  const quiet = loads.filter(l => (l.stuckScore || 0) >= 4).length;
  const broker = brokerIn(sq, d); const view = broker ? loads.filter(l => l.broker === broker) : loads;
  return A('openloads', `You have ${plural(view.length, 'open load')}${broker ? ' for ' + broker : ''}${quiet ? `, and ${quiet} look${quiet === 1 ? 's' : ''} quiet` : ''}. Quietest first:`, { rows: view.slice(0, 8).map(loadRow), links: [{ label: 'Open Load Board', route: 'board' }], follow: ['What should I work on first?'] });
});

intent('carriers', (sq, d, mem) => {
  if (HOW_TO.test(sq)) return null;
  const carriers = d.carriers || [];
  // one carrier named
  const named = findCarrier(sq, carriers);
  const wantsOne = has(sq, /\b(about|who is|whos|tell me|info|details?|phone|number|email|e-mail|contact|mc|dot|last (talk|spoke|contact)|when did i|how many covers|rate|how often|history|reliable|good|any good|called|call)\b/) || (named.length && sq.split(' ').length <= 5);
  if (named.length && wantsOne) {
    const c = named[0]; const cv = carrierCovers(d, c);
    const facts = [['Carrier', c.carrierName || c.email]];
    if (c.mc) facts.push(['MC / DOT', c.mc]); if (c.email) facts.push(['E-mail', c.email]); if (c.phone) facts.push(['Phone', c.phone]);
    if (c.equipment) facts.push(['Equipment', c.equipment]);
    const lane = [placeOf(c.originCity, c.originState), placeOf(c.destCity, c.destState)].filter(Boolean).join(' to '); if (lane) facts.push(['Usual lane', lane]);
    facts.push(['Covers for you', String(cv.n || num(c.coverCount))]);
    if (cv.avg) facts.push(['Average rate', money(cv.avg)]);
    if (c.lastCovered || cv.last) facts.push(['Last covered', c.lastCovered || ago(cv.last.closedAt, d.now || Date.now())]);
    if (c.lastContacted) facts.push(['Last contacted', c.lastContacted]);
    if (c.status) facts.push(['Status', c.status]);
    return A('carrier', `${c.carrierName || c.email}: ${cv.n || num(c.coverCount) ? plural(cv.n || num(c.coverCount), 'cover') + ' for you' : 'no covers for you yet'}.`, { facts, links: [{ label: 'Open Carrier Database', route: 'carriers' }], carrierMem: c.id });
  }
  // best carrier for a lane / city
  if (has(sq, /\b(best|top|good|reliable|who (covers|has covered|runs|hauls|can cover)|which carriers?|carriers? (for|on|that|who|from|out of|into)|who do i (call|use)|who should i (call|use|ask))\b/) && has(sq, /\b(carrier|carriers|who|trucks?|driver|covers?|covered|runs?|hauls?)\b/)) {
    const lanes = findLanes(sq, d), cities = citiesIn(sq, d);
    if (lanes.length || cities.length) {
      const rank = new Map();
      const covs = lanes.length ? laneCovers(d, lanes[0]) : (d.covers || []).filter(e => isCover(e) && cities.some(c => { const l = e.lane || {}; return ns(c.city) === ns(l.originCity) || ns(c.city) === ns(l.destCity); }));
      for (const e of covs) { const k = lc(e.carrier && (e.carrier.email || e.carrier.name)); if (!k) continue; const r = rank.get(k) || { name: e.carrier.name || e.carrier.email, n: 0, rates: [], last: 0 }; r.n++; if (num(e.rate) > 0) r.rates.push(num(e.rate)); r.last = Math.max(r.last, T(e)); rank.set(k, r); }
      const label = lanes.length ? laneText({ oCity: lanes[0].oCity, oState: lanes[0].oState, dCity: lanes[0].dCity, dState: lanes[0].dState }) : cities.map(c => c.city).join(' / ');
      const rows = [...rank.values()].sort((a, b) => b.n - a.n || b.last - a.last).slice(0, 6).map(r => [r.name, `${plural(r.n, 'cover')}${r.rates.length ? ' · avg ' + money(r.rates.reduce((a, b) => a + b, 0) / r.rates.length) : ''}`]);
      if (rows.length) return A('carriers', `Carriers who have covered ${label} for you:`, { rows, links: [{ label: 'Open Carrier Database', route: 'carriers' }], follow: [`What did ${label} cover at?`] });
      const inDb = carriers.filter(c => cities.some(x => ns(x.city) === ns(c.originCity) || ns(x.city) === ns(c.destCity)) || (lanes[0] && ns(c.originCity) === ns(lanes[0].oCity))).slice(0, 6);
      if (inDb.length) return A('carriers', `Nobody has covered ${label} for you yet, but these carriers in your database run near it:`, { rows: inDb.map(c => [c.carrierName || c.email, [placeOf(c.originCity, c.originState), placeOf(c.destCity, c.destState)].filter(Boolean).join(' to ')]), links: [{ label: 'Open Carrier Database', route: 'carriers' }] });
      return A('carriers', `I have no carrier on file for ${label} yet. Press Carrier outreach on the load, or add carriers who run that lane.`, { mood: 'think', links: [{ label: 'Open Carrier Database', route: 'carriers' }] });
    }
  }
  if (has(sq, /\b(top carriers|best carriers|my best carrier|my top carrier|who covers (the )?most|most covers|best carrier|favorite carrier|favourite carrier|go to carrier|go-to carrier)\b/)) {
    const a = attributionFromLog(d.covers || []); const top = [...a.carriers.entries()].sort((x, y) => y[1].covers - x[1].covers).slice(0, 6);
    if (!top.length) return A('carriers', 'No carriers are credited with covers yet. When you mark a load Covered, pick the carrier and I will rank them.', { links: [{ label: 'Open Cover Log', route: 'covers' }] });
    return A('carriers', 'Your top carriers by covers:', { rows: top.map(([e, v]) => { const c = carriers.find(x => lc(x.email) === e); return [(c && c.carrierName) || e, `${plural(v.covers, 'cover')}${v.rated ? ' · avg ' + money(v.rateSum / v.rated) : ''}`]; }), links: [{ label: 'Open Carrier Database', route: 'carriers' }] });
  }
  if (has(sq, /\b(how many carriers|carrier count|number of carriers|carriers do i have|size of my carrier|carriers in (my )?(database|list)|never contacted|haven t contacted|havent contacted|not contacted|unused carriers|carrier stats|carrier database stats)\b/)) {
    const never = carriers.filter(c => !String(c.lastContacted || '').trim()).length, covered = carriers.filter(c => num(c.coverCount) > 0).length, active = carriers.filter(c => /active|approved|ready/i.test(String(c.status || ''))).length;
    return A('carriers', `You have ${plural(carriers.length, 'carrier')} in your database.`, { facts: [['Total', String(carriers.length)], ['Have covered for you', String(covered)], ['Marked active / ready', String(active)], ['Never contacted', String(never)]], links: [{ label: 'Open Carrier Database', route: 'carriers' }] });
  }
  if (named.length && !wantsOne) { const c = named[0]; return A('carrier', `${c.carrierName || c.email} is in your Carrier Database. Ask me "about ${c.carrierName || c.email}" for the full picture.`, { links: [{ label: 'Open Carrier Database', route: 'carriers' }] }); }
  return null;
});

intent('customers', (sq, d) => {
  if (HOW_TO.test(sq)) return null;
  const customers = d.customers || [];
  const named = findCustomer(sq, customers);
  if (named.length && has(sq, /\b(about|who|tell me|info|details?|contact|phone|email|e-mail|lanes?|ship|shipper|customer|last)\b/)) {
    const c = named[0]; const facts = [['Company', c.company || c.contactName]];
    if (c.contactName && c.company) facts.push(['Contact', c.contactName + (c.title ? ', ' + c.title : '')]); if (c.email) facts.push(['E-mail', c.email]); if (c.phone) facts.push(['Phone', c.phone]);
    const loc = placeOf(c.city, c.state); if (loc) facts.push(['Location', loc]); if (c.industry) facts.push(['Ships', c.industry]); if (c.lanes) facts.push(['Typical lanes', c.lanes]); if (c.equipment) facts.push(['Equipment', c.equipment]); if (c.status) facts.push(['Status', c.status]); if (c.lastContacted) facts.push(['Last contacted', c.lastContacted]);
    return A('customer', `${c.company || c.contactName} is in your Customer Database.`, { facts, links: [{ label: 'Open Customer Database', route: 'customers' }] });
  }
  if (has(sq, /\b(how many (customers|shippers)|customer count|number of (customers|shippers)|customers do i have|my customers|my shippers)\b/)) {
    const companies = new Set(customers.map(c => ns(c.company)).filter(Boolean)).size;
    return A('customer', `You have ${plural(customers.length, 'customer contact')}${companies ? ' across ' + plural(companies, 'company', 'companies') : ''}.`, { links: [{ label: 'Open Customer Database', route: 'customers' }] });
  }
  return null;
});

intent('inquiries', (sq, d) => {
  if (HOW_TO.test(sq)) return null;
  const inq = d.inquiries || [], now = d.now || Date.now();
  if (has(sq, /\b(held|needs? my eyes|waiting for me|need me|exception|queue|unanswered|to review|needs? review)\b/) && has(sq, /\b(e-?mails?|replies|messages|queue|held|exception)\b/)) {
    return A('inquiries', d.held ? `${plural(d.held, 'carrier e-mail')} ${d.held === 1 ? 'is' : 'are'} waiting for you on Cover Desk, each with the carrier\'s words and a ready reply.` : 'Nothing is waiting: every carrier e-mail has been handled or answered.', { mood: d.held ? 'smart' : 'thumbs', links: [{ label: 'Open Cover Desk', route: 'coverdesk' }] });
  }
  if (!has(sq, /\b(replies|replied|responses?|responded|inquir|any (bites|calls|replies|interest|responses)|who (replied|responded|called|answered|quoted)|quotes?|quoted|carrier e-?mails?|latest (reply|quote|inquiry)|last (reply|quote|inquiry)|new replies|got any|did anyone)\b/)) return null;
  const r = rangeOf(sq, now) || { from: day0(now), to: Infinity, label: 'today' };
  const list = inq.filter(q => inRange(Date.parse(q.dateCounted), r)).sort((a, b) => Date.parse(b.dateCounted) - Date.parse(a.dateCounted));
  const lanes = findLanes(sq, d), loads = findLoads(sq, d.loads || []);
  let pool = list;
  if (loads.length || lanes.length) { const l = loads[0] || lanes[0]; pool = list.filter(q => ns(q.originCity) === ns(l.oCity || l.originCity) && ns(q.destCity) === ns(l.dCity || l.destCity)); }
  const who = (q) => q.senderEmail || 'unknown sender';
  if (!pool.length) return A('inquiries', `No carrier inquiries ${r.label}${loads.length || lanes.length ? ' on that load' : ''}.`, { mood: 'think', links: [{ label: 'Open Inquiry Log', route: 'inquiry' }] });
  const quotes = pool.filter(q => num(q.lastCarrierRate) > 0);
  const rows = pool.slice(0, 6).map(q => [who(q), `${laneText(q)}${num(q.lastCarrierRate) ? ' · quoted ' + money(q.lastCarrierRate) : ''}${q.status ? ' · ' + q.status : ''}`]);
  return A('inquiries', `${plural(pool.length, 'carrier inquiry', 'carrier inquiries')} ${r.label}${quotes.length ? `, ${plural(quotes.length, 'with a quote')}` : ''}.`, { rows, links: [{ label: 'Open Inquiry Log', route: 'inquiry' }] });
});

intent('trucks', (sq, d) => {
  if (HOW_TO.test(sq)) return null;
  if (!has(sq, /\b(trucks?|capacity|empty|available (trucks?|carriers?|capacity)|anyone (empty|available|free)|who s (empty|free|available)|whos (empty|free|available))\b/)) return null;
  if (has(sq, /\b(truck check|add trucks?|share a truck|post a truck|truck board|truck book)\b/)) return null;
  const trucks = d.trucks || [], now = d.now || Date.now();
  const cities = citiesIn(sq, d);
  let list = trucks;
  if (cities.length) list = trucks.filter(t => cities.some(c => ns(c.city) === ns(t.oCity)) || (cities[0].state && ns(t.oState) === ns(cities[0].state) && has(sq, /\b(state|around|near)\b/)));
  const st = (sq.split(' ').filter(w => stateAbbr.has(w))); if (!cities.length && st.length && /\b(in|near|around|from)\b/.test(sq)) list = trucks.filter(t => st.includes(lc(t.oState)));
  if (!list.length) return A('trucks', trucks.length ? `No available trucks fit that. You have ${plural(trucks.length, 'truck')} on the book elsewhere.` : 'No trucks are on the book right now. Paste a carrier e-mail or a list on Cover Desk and I will find the trucks in it.', { mood: 'think', links: [{ label: 'Open Cover Desk', route: 'coverdesk' }, { label: 'Team Truck Board', route: 'trucks' }] });
  const rows = list.slice(0, 7).map(t => [`${t.carrierName || t.email || 'Carrier'} · ${placeOf(t.oCity, t.oState)}${t.dCity || t.dState ? ' to ' + placeOf(t.dCity, t.dState) : ' (open)'}`, `${t.equip || 'V'} · ${t.at ? ago(t.at, now) : ''}${t.phone ? ' · ' + t.phone : ''}`]);
  return A('trucks', `${plural(list.length, 'available truck')}${cities.length ? ' near ' + cities.map(c => c.city).join(' / ') : ''}, freshest first:`, { rows, links: [{ label: 'Open Cover Desk', route: 'coverdesk' }] });
});

intent('rate', (sq, d, mem) => {
  if (HOW_TO.test(sq) && !/\bwhat\b/.test(sq)) return null;
  if (!has(sq, /\b(rate|rates|price|priced|pricing|pay|paid|cost|paying|covered at|cover at|post at|quote|quoted|how much|going rate|market)\b/)) return null;
  const lanes = findLanes(sq, d); const loads = findLoads(sq, d.loads || []);
  const lane = lanes[0] || (loads[0] && { oCity: loads[0].oCity, oState: loads[0].oState, dCity: loads[0].dCity, dState: loads[0].dState }) || (mem && mem.lane);
  if (!lane) {
    const cities = citiesIn(sq, d);
    if (!cities.length) return has(sq, /\b(what|how much|should|rate)\b/) && has(sq, /\b(lane|from|to|load|chicago|post|cover)\b/) ? A('rate', 'Which lane? Tell me the cities, like "what did Chicago to Atlanta cover at".', { mood: 'think' }) : null;
    // a single city: show rates on any lane touching it
    const hits = (d.covers || []).filter(e => isCover(e) && num(e.rate) > 0 && cities.some(c => ns(c.city) === ns((e.lane || {}).originCity) || ns(c.city) === ns((e.lane || {}).destCity)));
    const s = stat(hits.map(e => num(e.rate)));
    if (!s) return A('rate', `You have no covered loads with a rate through ${cities.map(c => c.city).join(' / ')} yet.`, { mood: 'think' });
    return A('rate', `${plural(s.n, 'cover')} through ${cities.map(c => c.city).join(' / ')}: average ${money(s.avg)}, from ${money(s.min)} to ${money(s.max)}.`, { facts: [['Average', money(s.avg)], ['Lowest', money(s.min)], ['Highest', money(s.max)], ['Most recent', money(num(hits.sort((a, b) => T(b) - T(a))[0].rate))]] });
  }
  const covs = laneCovers(d, lane); const s = stat(covs.map(e => num(e.rate)));
  const open = (d.loads || []).find(l => ns(l.oCity) === ns(lane.oCity) && ns(l.dCity) === ns(lane.dCity));
  const label = laneText(lane); const facts = [];
  if (s) { facts.push(['Covered here', plural(s.n, 'time')], ['Average carrier rate', money(s.avg)], ['Range', `${money(s.min)} to ${money(s.max)}`], ['Most recent', `${money(num(covs.find(e => num(e.rate) > 0).rate))} (${ago(covs.find(e => num(e.rate) > 0).closedAt, d.now || Date.now())})`]); }
  if (open && open.targetRate) facts.push(['Your target on the open load', money(open.targetRate)]);
  if (open && open.datAvg) facts.push(['DAT average you typed', money(open.datAvg)]);
  if (!facts.length) return A('rate', `You have no covered loads on ${label} yet, so I have no history to price it from. Check DAT RateView from the load card, post a target you can live with, and I will learn from the first cover.`, { mood: 'think', links: [{ label: 'Open Load Board', route: 'board' }] });
  const tail = s && open && open.targetRate ? (open.targetRate < s.avg * 0.93 ? ` Your target is below the lane average, so expect it to be slow.` : open.targetRate > s.avg * 1.07 ? ' Your target is above the lane average, so expect carriers to jump on it.' : ' Your target is in line with the lane average.') : '';
  return A('rate', s ? `${label} has covered ${plural(s.n, 'time')} at an average carrier rate of ${money(s.avg)}.${tail}` : `Here is what I have on ${label}.`, { facts, lane, links: [{ label: 'Open Lane Intel', route: 'lanes' }], follow: [`Who covers ${label}?`] });
});

intent('settings', (sq, d) => {
  if (HOW_TO.test(sq)) return null;
  const s = d.settings || {};
  if (has(sq, /\b(weekly floor|my floor|weekly goal|weekly target|cover goal|what s my goal|whats my goal|what is my goal|how many covers do i need)\b/)) return A('settings', `Your weekly cover floor is ${s.weeklyFloor || 50}. You can change it in System.`, { links: [{ label: 'Open System', route: 'system' }] });
  if (has(sq, /\b(my brokers?|who are the brokers|brokers? list|list of brokers)\b/)) return A('settings', (s.brokers || []).length ? `Your brokers: ${(s.brokers || []).join(', ')}.` : 'You have no brokers set up. Add them in System and every load can be assigned to one.', { links: [{ label: 'Open System', route: 'system' }] });
  if (has(sq, /\b(send mode|auto ?send|auto ?reply|automatic repl|sending mode|will you send|does it send)\b/) && !has(sq, /\bhow do|how does|what is\b/)) {
    const m = { off: 'Drafts only: nothing is ever sent by itself.', shadow: 'Shadow: nothing is sent, but I judge every reply so you can see how often you would agree.', routine: 'Routine replies are sent by themselves.', full: 'Routine and rate-confirming replies are sent by themselves.' }[s.sendMode || 'off'];
    return A('settings', `Send mode is ${s.sendMode || 'off'}. ${m}`, { links: [{ label: 'Open System', route: 'system' }] });
  }
  if (has(sq, /\b(ladder|book band|split band|counter ladder|counter steps)\b/)) { const b = Number.isFinite(Number(s.ladderBookPct)) ? Number(s.ladderBookPct) : 3, sp = Number.isFinite(Number(s.ladderSplitPct)) ? Number(s.ladderSplitPct) : 8; return A('settings', `Your counter ladder: a carrier up to ${b}% over target gets "confirm your ETA", up to ${sp}% over gets a split-the-difference counter, and anything higher is countered at your target.`, { links: [{ label: 'Open System', route: 'system' }] }); }
  return null;
});

/** Run the data intents in order; returns the first answer. mem = the conversation memory (mutated: lastIntent, loadId, lane). */
export function dataAnswer(sq, data, mem = {}, only = '') {
  for (const it of INTENTS) {
    if (only && it.id !== only) continue;
    let r = null;
    try { r = it.fn(sq, data, mem); } catch (e) { r = null; }
    if (r) { if (mem) { mem.intent = it.id; if (r.loadMem) mem.loadId = r.loadMem; if (r.carrierMem) mem.carrierId = r.carrierMem; if (r.lane) mem.lane = r.lane; } return r; }
  }
  return null;
}
export { findCarrier, findCustomer };
