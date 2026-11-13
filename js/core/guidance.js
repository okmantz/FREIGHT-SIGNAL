// "What should I do next with this load?" - an adaptive, per-load next-step engine.
//
// It reads what has actually happened on THIS load (age, inquiries and how fast they came, rates on the table, what you already tried
// and when) and returns one best next step plus backups. Because every action you apply is logged on the load (`ops`), the advice
// escalates over several iterations instead of repeating itself:
//
//   cold load (no inquiries)      first wave -> reprice -> second wave -> fresh cities -> call out -> bigger reprice -> escalate to the customer
//   interest but no rate          reply to inquiries -> follow up by phone -> small reprice + second wave
//   rate on the table             book it (inside the band) / let the split counter work / phone the carrier
//   hot (many inquiries fast)     do NOT touch the price; work the replies; book the first acceptable rate
//   quotes keep coming in high    the market says the rate is low: raise the target rate toward what carriers are asking
//
// A step may carry an `action` the UI can run with one click: reprice | wave2 | recities | call | outreach | setRate | cover | csv.
// A step may also carry `checks`: a short, load-specific checklist shown under the step.
// Pure functions: groupStats() output in, advice out.
//
// TIMELINE FOR A LOAD THAT HAS DRAWN NO INQUIRIES (the clock starts when the CSV is downloaded for DAT; loads never downloaded use the
// time they were pasted). Loads on DAT normally pull a first inquiry within minutes, so silence is a signal, not something to wait out:
//     0-30 min   fresh        leave the price alone; make sure it is really live; start outreach
//     30-60 min  refresh      refresh the posts (and your inbox); re-post anything missing
//     1-2 h      not working  something is wrong with the post, not the market: check it before touching the price
//     2 h +      escalate     reprice, second wave, fresh cities, phone calls, then the customer
// (A pickup that is close to closing skips straight to "escalate" after the 30-minute mark.)

import { safeNumeric, formatCurrency0 } from './util.js';
import { parseDateText } from './expiry.js';
import { EQUIPMENT } from './defaults.js';

const H = 3600000;
const round25 = (x) => Math.round(x / 25) * 25;

/** The one-click reprice: % of the current rate clamped to the class's min/max dollars, rounded to $25, growing a little each time. */
export function repriceSuggestion(st, iteration = 0) {
  const s = st.strategy;
  const base = st.datRate || (st.mem ? st.mem.last.rate : 0);
  if (!(base > 0)) return null;
  const pct = s.repricePct * (1 + 0.5 * iteration);
  const step = Math.max(25, round25(Math.min(s.repriceMax * (1 + 0.5 * iteration), Math.max(s.repriceMin, base * pct / 100))));
  return { from: st.datRate || 0, to: round25((st.datRate || base) + step), step, basis: st.datRate ? (st.postedOwn ? 'rate posted on DAT' : 'target rate (nothing posted lower)') : 'last cover on this lane' };
}

const count = (st, type) => st.ops.filter(o => o.type === type).length;
const since = (st, type, now) => { const o = [...st.ops].reverse().find(x => x.type === type); return o ? (now.getTime() - Date.parse(o.at)) / H : Infinity; };
const hm = (hrs) => hrs < 1 ? `${Math.max(1, Math.round(hrs * 60))} min` : `${Math.round(hrs * 10) / 10} h`;

// ---- plain-language facts about THIS load, used to make every note specific
const equipName = (code) => { const e = EQUIPMENT.find(x => x.code === String(code || '').toUpperCase()); return e ? e.label.toLowerCase() : String(code || 'equipment'); };
export const laneText = (st) => `${st.head.originCity || '?'}, ${st.head.originState || '?'} \u2192 ${st.head.destCity || '?'}, ${st.head.destState || '?'}`;
const laneKind = (st) => (st.miles ? `${Math.round(st.miles).toLocaleString('en-US')} mi ${st.cls}` : st.cls || 'regional');
/** "pickup today (5 PM cut-off)", "pickup tomorrow", "pickup Fri 11/20", "no pickup date". */
export function pickupPhrase(st, now = new Date()) {
  const d = parseDateText(st.head.pickupLatest) || parseDateText(st.head.pickupEarliest);
  if (!d) return 'no pickup date set';
  const t0 = new Date(now); t0.setHours(0, 0, 0, 0);
  const days = Math.round((d.getTime() - t0.getTime()) / 86400000);
  if (days < 0) return 'pickup date has passed';
  if (days === 0) return 'pickup today';
  if (days === 1) return 'pickup tomorrow';
  return `pickup ${['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'][d.getDay()]} ${d.getMonth() + 1}/${d.getDate()}`;
}
/** What is on DAT as the rate, in words. */
function rateWords(st) {
  const r = st.rateInfo || { mode: 'none', count: 0, total: st.postings || 0 };
  if (r.mode === 'own') return `a rate on ${r.count} of ${r.total} postings`;
  if (r.mode === 'target') return `${formatCurrency0(st.target)} on all ${r.total} postings`;
  return 'no rate on any posting';
}
/** How the target compares with what this lane last covered at ("$1,500 is 9% under the last cover of $1,650"). '' when unknown. */
function memCompare(st) {
  if (!st.mem || !(st.target > 0)) return '';
  const last = st.mem.last.rate; const d = st.target - last; const pct = Math.abs(d) / last * 100;
  if (pct < 2) return `Your ${formatCurrency0(st.target)} is in line with the last cover on this lane (${formatCurrency0(last)}).`;
  return `Your ${formatCurrency0(st.target)} is ${pct.toFixed(0)}% ${d < 0 ? 'under' : 'over'} the last cover on this lane (${formatCurrency0(last)}).`;
}

/**
 * The 30-minute coach. The load's clock is split into 30-minute slots; every new slot gets a different note, written from what is
 * known about THIS load: its lane, how many inquiries it has drawn (and how recently), whether there are quotes, and what has
 * already been tried. Returns null before the first slot ends or when a rate is already on the table (those have their own steps).
 */
export function slotNote(st, extra, now, ctx) {
  const T = st.ageHours; if (!(T >= 0.5)) return null;
  const slot = Math.floor(T / 0.5);                     // 1 = the 30-minute mark, 2 = one hour, ...
  const n = st.inquiries.total, quotes = st.inquiries.quotes, lane = laneText(st);
  const mark = hm(slot * 0.5);
  const perHr = n / Math.max(T, 0.5);
  const lastAgo = st.inquiries.lastAt ? (now.getTime() - st.inquiries.lastAt) / H : null;
  const did = ctx.did, rp = ctx.rp;
  const depth = extra.depth || 0, unused = extra.unusedDepth || 0;
  const R = (arr) => arr[(slot - 1) % arr.length];       // rotate so consecutive slots never repeat
  const kind = laneKind(st), pickup = pickupPhrase(st, now);
  if (quotes.length) {
    const best = st.inquiries.bestQuote, lad = st.inquiries.stage;
    if (lad && lad.stage === 'book') return null;        // the 'Book it' step already says it
    const over = st.target > 0 ? ((best - st.target) / st.target * 100).toFixed(1) : null;
    return { slot, title: `${mark} check: ${quotes.length} quote${quotes.length === 1 ? '' : 's'} on the table`,
      detail: R([
        `Best quote on ${lane} is ${formatCurrency0(best)}${over !== null ? ` (${over}% over target)` : ''}. Reply to that carrier first and ask whether ${formatCurrency0(st.target || best)} works if you can confirm today.`,
        `${quotes.length} carrier${quotes.length === 1 ? ' has' : 's have'} quoted so far (${n} replies total). Call the lowest quote now: a phone conversation closes the last 3-5% faster than another email.`,
        `Still no deal at ${mark}. Carriers who quoted early move on fast. Send the best one a firm answer, yes or a specific number, so they stop shopping the load.`,
      ]) };
  }
  if (n === 0) {
    const mem = st.mem ? `This lane last covered at ${formatCurrency0(st.mem.last.rate)}. ` : '';
    const pool = [
      { t: 'Refresh and confirm the post is live', d: `${lane} (${kind}, ${pickup}) has been live ${mark} with no inquiries. Refresh DAT and your inbox (including Junk), and confirm every posting is still showing.`, a: { type: 'csv', label: 'Re-post (download CSV)' } },
      { t: 'Silence at 1 hour: check, then reach out', d: `${mark} with nothing on ${lane}. ${depth ? `Draft outreach to the ${Math.min(depth, extra.wave || 5)} best-matched of ${depth} carriers in your database.` : 'Your database has no carriers for this lane yet, so search DAT Find Trucks and call two.'}`, a: depth && !st.outreachSent ? { type: 'outreach', label: 'Draft first wave' } : null },
      { t: 'Compare your rate with the market', d: `${mem}${st.target > 0 ? memCompare(st) + ' ' : ''}Open RateView for ${lane}: if the posted rate is below the market average, a ${rp ? formatCurrency0(rp.step) + ' raise to ' + formatCurrency0(rp.to) : 'raise'} is the likeliest fix.`, a: rp && did.reprice < 3 ? { type: 'reprice', to: rp.to, label: `Raise to ${formatCurrency0(rp.to)}` } : null },
      { t: 'Widen the reach', d: unused > 0 ? `${mark} live. ${unused} more carrier${unused === 1 ? '' : 's'} that fit ${lane} have not heard about it. Send the second wave.` : `${mark} live. Everyone in your database that fits ${lane} has been contacted, so search DAT Find Trucks for new names.`, a: unused > 0 && did.wave2 < 2 ? { type: 'wave2', label: 'Draft second wave' } : null },
      { t: 'Change what trucks see', d: `Trucks searching near ${st.head.originCity || 'the origin'} may never see these postings. Rebuild the nearby cities with fresh high-traffic markets so ${lane} appears in more searches.`, a: did.recities < 3 ? { type: 'recities', label: 'Reshuffle postings' } : null },
      { t: 'Pick up the phone', d: `${mark} without a single inquiry on ${lane}. Call the three carriers who ran ${kind} freight most recently; a direct ask beats waiting on the post.`, a: { type: 'call', label: 'Call list' } },
      { t: 'Involve the customer', d: `${mark} of silence. If the rate, reach and cities have all been tried, ask the customer for a higher rate or a later pickup (${pickup}) before it gets harder.`, a: null },
    ];
    const pk = slot <= pool.length ? pool[slot - 1] : pool[(slot - 1) % pool.length];
    return { slot, title: `${mark} check: ${pk.t}`, detail: pk.d, action: pk.a };
  }
  // inquiries but no usable rate
  const calm = lastAgo !== null && lastAgo >= 0.5;
  const heat = perHr >= 3 ? 'strong' : perHr >= 1 ? 'steady' : 'light';
  const pool = [
    `${n} inquir${n === 1 ? 'y' : 'ies'} on ${lane} after ${mark} (${heat} interest${lastAgo !== null ? `, latest ${hm(lastAgo)} ago` : ''}). Make sure every one has been answered and asked for an all-in rate and ETA.`,
    calm ? `Nothing new on ${lane} for ${hm(lastAgo)}. Phone the carriers who e-mailed without a rate: a spoken number is faster than another round of email.` : `Interest on ${lane} is still arriving (${n} so far). Do not touch the price; chase the carriers who have not given a rate yet.`,
    heat === 'light' ? `Only ${n} inquir${n === 1 ? 'y' : 'ies'} in ${mark} on ${lane}. ${rp ? `A ${formatCurrency0(rp.step)} raise to ${formatCurrency0(rp.to)} could turn browsers into quotes.` : 'Consider a small rate raise.'}` : `${heat === 'strong' ? 'Strong' : 'Steady'} demand on ${lane}: ${n} inquiries and still no rate. Ask directly for "best all-in rate and ETA" in your next reply.`,
  ];
  return { slot, title: `${mark} check: ${n} inquir${n === 1 ? 'y' : 'ies'}, no rate yet`, detail: R(pool), action: heat === 'light' && rp && did.reprice < 3 ? { type: 'reprice', to: rp.to, label: `Raise to ${formatCurrency0(rp.to)}` } : null };
}

/**
 * Advice for one load. st = groupStats(); extra = { depth: matching carrier count, unusedDepth: matching carriers not yet contacted, wave, now }.
 * Returns { level:'ok'|'watch'|'act'|'urgent', phase, headline, steps:[{id,title,detail,checks?,action?,primary?}] }
 */
export function nextSteps(st, extra = {}) {
  const now = extra.now || new Date();
  const s = st.strategy, n = st.inquiries.total, quotes = st.inquiries.quotes;
  const steps = []; let level = 'ok', phase = 'posted', headline = '';
  // front = put this step first (time-critical advice outranks "set a target rate").
  const add = (id, title, detail, action, primary = false, extras = {}) => { const step = { id, title, detail, action: action || null, primary, ...(extras.checks ? { checks: extras.checks } : {}) }; if (extras.front) steps.unshift(step); else steps.push(step); };
  const urgent = st.hoursToPickup !== null && st.hoursToPickup <= s.closingHours;
  const iteration = count(st, 'reprice');
  const cooldown = 0.5;                                      // an action is given 30 minutes to work before the next one is suggested
  const sinceAny = st.lastOpAt ? (now.getTime() - st.lastOpAt) / H : Infinity;
  const rp = repriceSuggestion(st, iteration);
  const wait = sinceAny < cooldown;
  const waitText = wait ? `You last changed this ${hm(sinceAny)} ago (${st.lastOp.detail || st.lastOp.type}). Give it about ${hm(cooldown - sinceAny)} more` : '';
  const lane = laneText(st);
  const T = st.ageHours;

  if (!st.rateSet) {
    const memRate = st.mem ? st.mem.last.rate : 0;
    add('setrate', 'Set a target rate', memRate ? `No target rate yet. ${lane} last covered at ${formatCurrency0(memRate)}. The target judges carrier replies; it does not have to be posted on every posting.` : 'Enter the target rate for this load so carrier replies can be judged. It does not have to be posted on every posting.', memRate ? { type: 'setRate', rate: memRate, label: `Use ${formatCurrency0(memRate)}` } : null, true);
    level = 'act'; phase = 'unpriced';
  }

  if (st.alerts.length) {
    add('weather', `Weather alert at ${st.alerts[0].where}`, `${st.weatherText}. Confirm the truck early, warn the customer, and keep a backup carrier warm.`, null, !steps.length);
    level = st.alerts.some(a => a.level === 'severe') ? 'urgent' : (level === 'ok' ? 'act' : level);
  }

  // ---- rate on the table
  if (quotes.length && st.target > 0) {
    const best = st.inquiries.bestQuote, lad = st.inquiries.stage;
    if (lad && lad.stage === 'book') {
      add('book', 'Book it', `A carrier quoted ${formatCurrency0(best)} on ${lane} - ${lad.pct <= 0 ? 'at or under' : lad.pct.toFixed(1) + '% over'} your ${formatCurrency0(st.target)} target. Confirm the ETA and book.`, { type: 'cover', label: 'Mark covered…' }, true);
      level = 'urgent'; phase = 'booking'; headline = 'Rate is inside your booking band';
    } else if (lad && lad.stage === 'split') {
      add('split', 'Let the split counter work', `Best quote ${formatCurrency0(best)} is ${lad.pct.toFixed(1)}% over target; a counter at ${formatCurrency0(lad.split)} was drafted. If there is no reply in about 30 minutes, call the carrier.`, null, true);
      if (level === 'ok') level = 'watch'; phase = 'negotiating'; headline = 'Negotiating - close to your number';
    } else if (lad) {
      const hi = st.inquiries.avgQuote > 0 && (st.inquiries.avgQuote - st.target) / st.target * 100 > st.splitPct;
      if (quotes.length >= 2 && hi && rp) {
        const to = round25(Math.max(rp.to, (st.datRate || 0) + (st.inquiries.avgQuote - st.target) / 2));
        add('market', 'Carriers are asking more than your target', `${quotes.length} quotes on ${lane} average ${formatCurrency0(st.inquiries.avgQuote)} against a ${formatCurrency0(st.target)} target. The market is telling you the rate is light - raise it toward ${formatCurrency0(to)} or push the customer.`, { type: 'reprice', to, label: `Raise DAT rate to ${formatCurrency0(to)}` }, true);
        level = 'act'; phase = 'underpriced'; headline = 'Quotes are running above target';
      } else {
        add('counter', 'Hold at target', `Best quote ${formatCurrency0(best)} is ${lad.pct.toFixed(1)}% over target. Counter drafts are asking for ${formatCurrency0(st.target)}; give carriers time to come down before moving.`, null, !steps.length);
        if (level === 'ok') level = 'watch'; phase = 'negotiating';
      }
    }
  }

  // ---- interest but no usable rate yet
  if (n > 0 && !quotes.length && phase === 'posted') {
    if (st.inquiries.last2h >= 5) {
      add('hot', 'Strong interest - do not touch the price', `${st.inquiries.last2h} inquiries on ${lane} in the last 2 hours. Reply fast and push each carrier for an all-in rate and ETA.`, { type: 'call', label: 'Call list' }, true);
      phase = 'hot'; headline = 'High interest'; if (level === 'ok') level = 'watch';
    } else if (st.inquiries.last2h >= 2) {
      add('warm', 'Interest is building', `${st.inquiries.last2h} inquiries in 2 hours on ${lane} but no rate yet. Answer each one and ask for an all-in number.`, null, true);
      phase = 'warm'; headline = 'Interest is building'; if (level === 'ok') level = 'watch';
    } else {
      const stalled = st.inquiries.lastAt && (now.getTime() - st.inquiries.lastAt) / H >= 1;
      add('followup', stalled ? 'Follow up by phone' : 'Answer the inquiry', stalled ? `${n} inquir${n === 1 ? 'y' : 'ies'} on ${lane}, none with a rate and nothing new for ${hm((now.getTime() - st.inquiries.lastAt) / H)}. Call them instead of waiting.` : `${n} inquir${n === 1 ? 'y' : 'ies'} so far on ${lane} - get an all-in rate and ETA.`, stalled ? { type: 'call', label: 'Call list' } : null, true);
      phase = 'engaged'; headline = 'Engaged but no rate yet'; if (level === 'ok') level = 'watch';
      if (!wait && st.ageHours >= s.staleHours * 1.5 && rp && since(st, 'reprice', now) > cooldown * 2) add('nudge', `Small bump: +${formatCurrency0(rp.step)}`, `Interest is thin after ${hm(st.ageHours)} live. A small raise to ${formatCurrency0(rp.to)} can turn inquiries into quotes.`, { type: 'reprice', to: rp.to, label: `Raise to ${formatCurrency0(rp.to)}` });
    }
  }

  // ---- cold: nothing at all
  if (n === 0 && phase === 'posted') {
    phase = 'cold';
    const inbox = st.phone ? 'Your phone is the contact method on these posts: keep it close and answer unknown numbers.' : 'Refresh your inbox and check Junk / Other: inquiries arrive as e-mail.';
    const problemLines = st.problems.slice(0, 4).map(p => `${p.label}: missing ${p.missing.join(', ')}`);
    const live = `${st.postings} posting${st.postings === 1 ? '' : 's'}`;
    const csvAction = { type: 'csv', label: st.posted ? 'Re-post (download CSV)' : 'Download CSV' };

    if (!st.posted && st.addedHours < 0.5) {
      // pasted just now and not downloaded yet: the first job is to get it live
      add('post', 'Post it on DAT', `${live} ready for ${lane} (${laneKind(st)}, ${equipName(st.equip)}, ${pickupPhrase(st, now)}) with ${rateWords(st)}. Download the CSV and upload it in DAT's bulk posting tool. The clock for the notes below starts when you download.`, csvAction, true,
        { front: true, checks: problemLines.length ? ['DAT will reject these until they are filled in:', ...problemLines] : null });
      if (!st.outreachSent && extra.depth > 0) add('outreach', `Draft outreach to ${extra.wave || 5} ranked carriers`, `${extra.depth} carrier${extra.depth === 1 ? '' : 's'} in your database fit ${lane}. Draft the first wave while the post goes live.`, { type: 'outreach', label: 'Draft first wave' });
      headline = 'Not posted yet'; level = level === 'ok' ? 'act' : level; phase = 'unposted';
    } else {
      // 0-30 min fresh | 30-60 min refresh | 1-2 h not working | 2 h+ escalate (a closing pickup skips the middle)
      const band = T < 0.5 ? 'fresh' : T < 1 ? 'refresh' : (T < 2 && !urgent) ? 'stalled' : 'dead';
      const since30 = hm(Math.max(0, 0.5 - T));
      if (band === 'fresh') {
        add('wait', `Live ${hm(T)}: hold the price`, `${lane} (${laneKind(st)}, ${pickupPhrase(st, now)}) normally draws its first inquiry within minutes of posting. If nothing has come in, refresh in about ${since30} (the 30-minute mark). Do not change the rate yet.`, null, !steps.length,
          { checks: [`Open DAT and confirm all ${st.postings} posting${st.postings === 1 ? '' : 's'} are showing (${rateWords(st)}).`, inbox] });
        if (!st.outreachSent && extra.depth > 0) add('outreach', `Draft outreach to ${extra.wave || 5} ranked carriers`, `${extra.depth} carrier${extra.depth === 1 ? '' : 's'} fit ${lane}. Starting while the post is fresh costs nothing and speeds up the first reply.`, { type: 'outreach', label: 'Draft first wave' });
        headline = `Live ${hm(T)} - inquiries should start any minute`;
      } else if (band === 'refresh') {
        level = urgent ? 'urgent' : 'watch';
        add('refresh', `${hm(T)} with no inquiries: refresh now`, `This is the 30-minute check on ${lane}. Refresh your posts and your inbox, and re-post anything that dropped off, then give it 10-15 minutes. If it is still silent at one hour, something is not working.`, csvAction, true,
          { front: true, checks: [inbox, `On DAT, confirm all ${st.postings} postings are live and none expired (${rateWords(st)}).`, problemLines.length ? `Fix first: ${problemLines[0]}` : null].filter(Boolean) });
        if (!st.outreachSent && extra.depth > 0) add('outreach', `Draft outreach to ${extra.wave || 5} ranked carriers`, `Nobody has been contacted about ${lane} yet and ${extra.depth} carrier${extra.depth === 1 ? '' : 's'} fit it. Do not wait for the post alone.`, { type: 'outreach', label: 'Draft first wave' });
        headline = `${hm(T)} with no inquiries - time to refresh`;
      } else {
        level = urgent ? 'urgent' : 'act';
        headline = band === 'stalled' ? `No inquiries after ${hm(T)} - something is not working` : `No inquiries after ${hm(T)}`;
        const did = { reprice: count(st, 'reprice'), wave2: count(st, 'wave2'), recities: count(st, 'recities'), call: count(st, 'call') };
        // what to check first, most likely cause first, using what we know about this load
        const checks = [];
        if (problemLines.length) checks.push('DAT rejects rows with required fields missing, so these may never have gone live: ' + problemLines.join('; '));
        checks.push(`Search your own lane on DAT (${equipName(st.equip)}, ${st.head.originCity || 'origin'}, ${st.head.originState || ''}). All ${st.postings} postings should show. If not, re-upload the CSV.`);
        checks.push(`Pickup is ${st.pickupText || 'not set'} (${pickupPhrase(st, now)}). Make sure DAT shows the same date and it is not in the past.`);
        const r = st.rateInfo || { mode: 'none' };
        if (r.mode === 'none') checks.push('No posting has a rate. Put a rate on at least 2 of the postings (A-A and one nearby pairing); the rest can stay rate-free.');
        else checks.push(`${rateWords(st)[0].toUpperCase() + rateWords(st).slice(1)}. ${memCompare(st) || 'Open RateView for this lane and compare before you assume the market is the problem.'}`);
        checks.push(st.phone ? 'Contact method is Phone: callers will not leave an e-mail. Keep your phone close, or switch the load to Email.' : 'Contact method is Email: check Junk / Other, and that the Outlook connection (System) is on.');
        if (!(st.weight > 0) || !st.equip) checks.push(`${!(st.weight > 0) ? 'Weight' : 'Equipment'} is blank on this load. Fix it and re-post.`);
        else checks.push(`Equipment ${equipName(st.equip)} at ${st.weight.toLocaleString('en-US')} lbs: confirm that is right. The wrong trailer type hides the load from the trucks you want.`);
        const order = [];
        if (!st.outreachSent && extra.depth > 0) order.push('outreach');
        if (band === 'stalled') order.push('reprice', 'call', 'wave2', 'recities'); else if (urgent) order.push('reprice', 'call', 'wave2', 'recities'); else order.push('reprice', 'wave2', 'recities', 'call');
        const can = (k) => k === 'outreach' ? true : k === 'reprice' ? (did.reprice < 3 && rp && r.mode !== 'none') : k === 'wave2' ? (did.wave2 < 2 && extra.unusedDepth > 0) : k === 'recities' ? did.recities < 2 : k === 'call' ? did.call < 2 : false;
        const mk = (k, primary) => {
          if (k === 'outreach') add('outreach', `Draft outreach to ${extra.wave || 5} ranked carriers`, `Nobody has been contacted about ${lane} and ${extra.depth} carrier${extra.depth === 1 ? '' : 's'} fit it.`, { type: 'outreach', label: 'Draft first wave' }, primary);
          else if (k === 'reprice') add('reprice', `Raise the rate +${formatCurrency0(rp.step)}`, `${hm(T)} live with no inquiries${did.reprice ? ` and ${did.reprice} earlier raise${did.reprice === 1 ? '' : 's'} (the next one is bigger)` : ''}. ${formatCurrency0(rp.from || rp.to - rp.step)} → ${formatCurrency0(rp.to)} (${rp.basis}). Re-post after.`, { type: 'reprice', to: rp.to, label: `Raise to ${formatCurrency0(rp.to)}` }, primary);
          else if (k === 'wave2') add('wave2', `Second wave: ${extra.wave || 5} more carriers`, `${extra.unusedDepth} carrier${extra.unusedDepth === 1 ? '' : 's'} that fit ${lane} have not been contacted for this load yet.`, { type: 'wave2', label: 'Draft second wave' }, primary);
          else if (k === 'recities') add('recities', 'Swap the alternate cities', `Rebuild the 3 × 3 with fresh high-traffic markets${did.recities ? ' (different from the last try)' : ''} so ${lane} shows up in other trucks' searches.`, { type: 'recities', label: 'Rebuild cities' }, primary);
          else if (k === 'call') add('call', 'Start calling out', `Phone the best-matched carriers for ${lane}. A call beats an unanswered post on a load that has been live ${hm(T)}.`, { type: 'call', label: 'Call list' }, primary);
        };
        const pick = order.find(can);
        if (band === 'stalled') {
          // an hour of silence: check the post before touching the price (unless you just re-posted: give that a few minutes first)
          const why = `${hm(T)} live on ${lane} with no inquiries is not normal for DAT. Find out why before you move the price.`;
          if (wait) { add('wait', 'Let the last change work', `${waitText}. If ${lane} is still silent after that, work through the checks next.`, null, true, { front: true }); add('diagnose', 'Something is not working: check the post', why, csvAction, false, { checks }); }
          else add('diagnose', 'Something is not working: check the post first', why, csvAction, true, { front: true, checks });
          if (pick) mk(pick, false);
        } else {
          if (wait && !urgent) add('wait', 'Let the last change work', `${waitText}. Next up: ${pick === 'reprice' ? 'a rate raise' : pick === 'wave2' ? 'a second wave of outreach' : pick === 'recities' ? 'fresh cities' : pick === 'outreach' ? 'outreach' : 'phone calls'}.`, null, true);
          else if (pick) mk(pick, true);
          add('diagnose', 'Re-check the post itself', 'If nothing below moves it, rule out a post that is not really live.', null, false, { checks });
        }
        const rest = order.filter(k => k !== pick && k !== 'outreach').filter(can);
        rest.slice(0, 2).forEach(k => mk(k, false));
        if (did.reprice >= 2 && did.wave2 >= 1 && did.call >= 1) add('customer', 'Talk to the customer', `${lane} has had rate, reach and calls. Ask for a higher rate, a later pickup, or release the load.`, null, !pick);
      }
    }
  }

  // ---- v8: a fresh, lane-specific note every 30 minutes the load is live
  const pulse = slotNote(st, extra, now, { rp, did: { reprice: count(st, 'reprice'), wave2: count(st, 'wave2'), recities: count(st, 'recities'), call: count(st, 'call') }, wait });
  if (pulse && st.posted !== false && phase !== 'unposted' && phase !== 'unpriced') {
    const at = Math.min(steps.length, steps.findIndex(x => x.primary) + 1);
    steps.splice(at < 0 ? steps.length : at, 0, { id: 'pulse', title: pulse.title, detail: pulse.detail, action: pulse.action || null, primary: false, slot: pulse.slot, ...(pulse.checks ? { checks: pulse.checks } : {}) });
  }

  if (urgent && level === 'ok') level = 'watch';
  if (!headline) headline = level === 'ok' ? 'On track' : 'Needs a look';
  if (!steps.length) add('ok', 'Nothing to do right now', 'This load is on track. Check back as inquiries arrive.', null, true);
  if (!steps.some(x => x.primary)) steps[0].primary = true;
  return { level, phase, headline, steps, wait };
}
