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
// A step may carry an `action` the UI can run with one click: reprice | wave2 | recities | call | outreach | setRate | cover.
// Pure functions: groupStats() output in, advice out.

import { safeNumeric, formatCurrency0 } from './util.js';

const H = 3600000;
const round25 = (x) => Math.round(x / 25) * 25;

/** The one-click reprice: % of the current rate clamped to the class's min/max dollars, rounded to $25, growing a little each time. */
export function repriceSuggestion(st, iteration = 0) {
  const s = st.strategy;
  const base = st.datRate || (st.mem ? st.mem.last.rate : 0);
  if (!(base > 0)) return null;
  const pct = s.repricePct * (1 + 0.5 * iteration);
  const step = Math.max(25, round25(Math.min(s.repriceMax * (1 + 0.5 * iteration), Math.max(s.repriceMin, base * pct / 100))));
  return { from: st.datRate || 0, to: round25((st.datRate || base) + step), step, basis: st.datRate ? 'current target rate' : 'last cover on this lane' };
}

const count = (st, type) => st.ops.filter(o => o.type === type).length;
const since = (st, type, now) => { const o = [...st.ops].reverse().find(x => x.type === type); return o ? (now.getTime() - Date.parse(o.at)) / H : Infinity; };
const hm = (hrs) => hrs < 1 ? `${Math.max(1, Math.round(hrs * 60))} min` : `${Math.round(hrs * 10) / 10} h`;

/**
 * Advice for one load. st = groupStats(); extra = { depth: matching carrier count, unusedDepth: matching carriers not yet contacted, now }.
 * Returns { level:'ok'|'watch'|'act'|'urgent', phase, headline, steps:[{id,title,detail,action?,primary?}] }
 */
export function nextSteps(st, extra = {}) {
  const now = extra.now || new Date();
  const s = st.strategy, n = st.inquiries.total, quotes = st.inquiries.quotes;
  const steps = []; let level = 'ok', phase = 'posted', headline = '';
  const add = (id, title, detail, action, primary = false) => steps.push({ id, title, detail, action: action || null, primary });
  const urgent = st.hoursToPickup !== null && st.hoursToPickup <= s.closingHours;
  const iteration = count(st, 'reprice');
  const cooldown = Math.max(0.5, s.staleHours / 2);          // hours an action is given to work before the next one is suggested
  const sinceAny = st.lastOpAt ? (now.getTime() - st.lastOpAt) / H : Infinity;
  const rp = repriceSuggestion(st, iteration);
  const wait = sinceAny < cooldown;
  const waitText = wait ? `You last changed this ${hm(sinceAny)} ago (${st.lastOp.detail || st.lastOp.type}). Give it about ${hm(cooldown - sinceAny)} more` : '';

  if (!st.rateSet) {
    const memRate = st.mem ? st.mem.last.rate : 0;
    add('setrate', 'Set a target rate', memRate ? `No rate is set yet. This lane last covered at ${formatCurrency0(memRate)}.` : 'Enter the target rate for this load so carrier replies can be judged.', memRate ? { type: 'setRate', rate: memRate, label: `Use ${formatCurrency0(memRate)}` } : null, true);
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
      add('book', 'Book it', `A carrier quoted ${formatCurrency0(best)} - ${lad.pct <= 0 ? 'at or under' : lad.pct.toFixed(1) + '% over'} your ${formatCurrency0(st.target)} target. Confirm the ETA and book.`, { type: 'cover', label: 'Mark covered…' }, true);
      level = 'urgent'; phase = 'booking'; headline = 'Rate is inside your booking band';
    } else if (lad && lad.stage === 'split') {
      add('split', 'Let the split counter work', `Best quote ${formatCurrency0(best)} is ${lad.pct.toFixed(1)}% over target; a counter at ${formatCurrency0(lad.split)} was drafted. If there is no reply in about 30 minutes, call the carrier.`, null, true);
      if (level === 'ok') level = 'watch'; phase = 'negotiating'; headline = 'Negotiating - close to your number';
    } else if (lad) {
      const hi = st.inquiries.avgQuote > 0 && (st.inquiries.avgQuote - st.target) / st.target * 100 > st.splitPct;
      if (quotes.length >= 2 && hi && rp) {
        const to = round25(Math.max(rp.to, (st.datRate || 0) + (st.inquiries.avgQuote - st.target) / 2));
        add('market', 'Carriers are asking more than your target', `${quotes.length} quotes average ${formatCurrency0(st.inquiries.avgQuote)} against a ${formatCurrency0(st.target)} target. The market is telling you the rate is light - raise it toward ${formatCurrency0(to)} or push the customer.`, { type: 'reprice', to, label: `Raise DAT rate to ${formatCurrency0(to)}` }, true);
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
      add('hot', 'Strong interest - do not touch the price', `${st.inquiries.last2h} inquiries in the last 2 hours. Reply fast and push each carrier for an all-in rate and ETA.`, { type: 'call', label: 'Call list' }, true);
      phase = 'hot'; headline = 'High interest'; if (level === 'ok') level = 'watch';
    } else if (st.inquiries.last2h >= 2) {
      add('warm', 'Interest is building', `${st.inquiries.last2h} inquiries in 2 hours but no rate yet. Answer each one and ask for an all-in number.`, null, true);
      phase = 'warm'; headline = 'Interest is building'; if (level === 'ok') level = 'watch';
    } else {
      const stalled = st.inquiries.lastAt && (now.getTime() - st.inquiries.lastAt) / H >= 1;
      add('followup', stalled ? 'Follow up by phone' : 'Answer the inquiry', stalled ? `${n} inquiry${n === 1 ? '' : 'ies'}, none with a rate and nothing new for ${hm((now.getTime() - st.inquiries.lastAt) / H)}. Call them instead of waiting.` : `${n} inquiry${n === 1 ? '' : 'ies'} so far - get an all-in rate and ETA.`, stalled ? { type: 'call', label: 'Call list' } : null, true);
      phase = 'engaged'; headline = 'Engaged but no rate yet'; if (level === 'ok') level = 'watch';
      if (!wait && st.ageHours >= s.staleHours * 1.5 && rp && since(st, 'reprice', now) > cooldown * 2) add('nudge', `Small bump: +${formatCurrency0(rp.step)}`, `Interest is thin after ${hm(st.ageHours)}. A small raise to ${formatCurrency0(rp.to)} can turn inquiries into quotes.`, { type: 'reprice', to: rp.to, label: `Raise to ${formatCurrency0(rp.to)}` });
    }
  }

  // ---- cold: nothing at all
  if (n === 0 && phase === 'posted') {
    phase = 'cold';
    const early = st.ageHours < s.staleHours * 0.5 && !urgent;
    if (early) {
      add('wait', 'Give it time', `Posted ${hm(st.ageHours)} ago. ${s.staleHours <= 2 ? 'Local' : st.cls === 'long' ? 'Long-haul' : 'Regional'} loads usually draw a first inquiry within ${hm(s.staleHours)}.`, null, !steps.length);
      if (!st.outreachSent && extra.depth > 0) add('outreach', `Draft outreach to ${extra.wave || 5} ranked carriers`, `${extra.depth} carrier${extra.depth === 1 ? '' : 's'} fit this lane. Starting early costs nothing.`, { type: 'outreach', label: 'Draft first wave' });
      headline = 'Fresh - on schedule';
    } else {
      level = urgent ? 'urgent' : 'act';
      headline = `No inquiries after ${hm(st.ageHours)}`;
      const did = { reprice: count(st, 'reprice'), wave2: count(st, 'wave2'), recities: count(st, 'recities'), call: count(st, 'call') };
      const order = [];
      if (!st.outreachSent && extra.depth > 0) order.push('outreach');
      if (urgent) order.push('reprice', 'call', 'wave2', 'recities'); else order.push('reprice', 'wave2', 'recities', 'call');
      const pick = order.find(k => k === 'outreach' ? true : k === 'reprice' ? (did.reprice < 3 && rp) : k === 'wave2' ? (did.wave2 < 2 && extra.unusedDepth > 0) : k === 'recities' ? did.recities < 2 : k === 'call' ? did.call < 2 : false);
      const mk = (k, primary) => {
        if (k === 'outreach') add('outreach', `Draft outreach to ${extra.wave || 5} ranked carriers`, `Nobody has been contacted yet and ${extra.depth} carrier${extra.depth === 1 ? '' : 's'} fit the lane.`, { type: 'outreach', label: 'Draft first wave' }, primary);
        else if (k === 'reprice') add('reprice', `Raise the rate +${formatCurrency0(rp.step)}`, `${hm(st.ageHours)} with no inquiries${did.reprice ? ` and ${did.reprice} earlier raise${did.reprice === 1 ? '' : 's'} (the next one is bigger)` : ''}. ${formatCurrency0(rp.from || rp.to - rp.step)} → ${formatCurrency0(rp.to)} (${rp.basis}).`, { type: 'reprice', to: rp.to, label: `Raise to ${formatCurrency0(rp.to)}` }, primary);
        else if (k === 'wave2') add('wave2', `Second wave: ${extra.wave || 5} more carriers`, `${extra.unusedDepth} carrier${extra.unusedDepth === 1 ? '' : 's'} that fit this lane have not been contacted for this load yet.`, { type: 'wave2', label: 'Draft second wave' }, primary);
        else if (k === 'recities') add('recities', 'Swap the alternate cities', `Rebuild the 3 × 3 with fresh high-traffic markets${did.recities ? ' (different from the last try)' : ''} so the posting shows up in other trucks' searches.`, { type: 'recities', label: 'Rebuild cities' }, primary);
        else if (k === 'call') add('call', 'Start calling out', 'Phone the best-matched carriers - a call beats an unanswered post on a load this old.', { type: 'call', label: 'Call list' }, primary);
      };
      if (wait && !urgent) add('wait', 'Let the last change work', `${waitText}. Next up: ${pick === 'reprice' ? 'a rate raise' : pick === 'wave2' ? 'a second wave of outreach' : pick === 'recities' ? 'fresh cities' : 'phone calls'}.`, null, true);
      else if (pick) mk(pick, true);
      const rest = order.filter(k => k !== pick).filter(k => k === 'outreach' ? false : k === 'reprice' ? (did.reprice < 3 && rp) : k === 'wave2' ? (did.wave2 < 2 && extra.unusedDepth > 0) : k === 'recities' ? did.recities < 2 : did.call < 2);
      rest.slice(0, 2).forEach(k => mk(k, false));
      if (did.reprice >= 2 && did.wave2 >= 1 && did.call >= 1) add('customer', 'Talk to the customer', 'The market has had rate, reach and calls. Ask for a higher rate, a later pickup, or release the load.', null, !pick);
    }
  }

  if (urgent && level === 'ok') level = 'watch';
  if (!headline) headline = level === 'ok' ? 'On track' : 'Needs a look';
  if (!steps.length) add('ok', 'Nothing to do right now', 'This load is on track. Check back as inquiries arrive.', null, true);
  if (!steps.some(x => x.primary)) steps[0].primary = true;
  return { level, phase, headline, steps, wait };
}
