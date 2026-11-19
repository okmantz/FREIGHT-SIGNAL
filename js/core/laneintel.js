// Shared lane intelligence: what the whole team has actually seen on a lane, and what it took to cover.
//
// Each person's app quietly contributes small, anonymous-by-design LANE EVENTS from work they already did (a carrier inquiry, a cover,
// a carrier contacted). An event holds only: when, the lane (cities and states), equipment, a carrier identity (name, MC) and rates.
// It never holds the customer, the load text, reference numbers, e-mail addresses or phone numbers.
//
// RULE: only VERIFIED, SUFFICIENTLY SAMPLED data may influence a recommendation.
//   verified  = the rate passed the app's own believability check (core/quotes.js: not a stray number from an e-mail, not wildly off the
//               target) and, for covers, a real carrier was credited.
//   sampled   = at least `minSample` verified covers AND `minContributors` different teammates behind the number.
// Anything below that is still shown as information (with its sample size) but never produces advice like "raise the rate $150".

import { safeNumeric } from './util.js';
import { RATE_SANITY, judgeQuote } from './quotes.js';
import { laneMiles } from './lanes.js';
import { equipFamily, carrierKey, hash, marketKey, oneLine, stateCode, median, mean, percentile, roundTo, repriceTotal, DAY } from './netcommon.js';
import { parseMcDot } from './resources.js';

export const DEFAULTS = { minSample: 5, minContributors: 2, days: 180, similarMilesPct: 0.15, similarMilesMin: 75 };
export const KINDS = { i: 'inquiry', c: 'cover', o: 'outreach' };

export const monthKey = (t) => new Date(t).toISOString().slice(0, 7).replace('-', '');
/** The storage shard an event goes to: one per person per month, so each file has exactly one writer. */
export const shardKey = (t, uid) => monthKey(t) + '__' + uid;
export const shardMonth = (key) => String(key).split('__')[0];
export const shardOwner = (key) => String(key).split('__').slice(1).join('__');

/* ------------------------------------------------------------------------------------------------ making events */
const laneFields = (l) => {
  const oc = oneLine(l.originCity, 60), os = stateCode(l.originState), dc = oneLine(l.destCity, 60), ds = stateCode(l.destState);
  return oc && os && dc && ds ? { o: marketKey(oc, os), d: marketKey(dc, ds), oc, os, dc, ds } : null;
};
const carrierFields = (c, carriers) => {
  const email = String(c.email || '').trim().toLowerCase();
  const known = email ? (carriers || []).find(x => String(x.email || '').trim().toLowerCase() === email) : null;
  const mc = c.mc || (known && known.mc) || '';
  const p = parseMcDot(mc);
  return { cr: carrierKey({ mc, email }), cn: oneLine(c.name || c.carrierName || (known && known.carrierName) || '', 80), mc: p ? (p.type === 'DOT' ? 'DOT ' : 'MC ') + p.num : '' };
};
const milesOf = (l, zipMap) => { const m = laneMiles({ originCity: l.originCity, originState: l.originState, originZip: l.originZip, destCity: l.destCity, destState: l.destState, destZip: l.destZip }, zipMap); return Number.isFinite(m) ? Math.round(m) : 0; };

/** A cover from the Cover Log. null when it should not be shared (not a cover, no lane). */
export function coverEvent(entry, me, { zipMap = null, carriers = [] } = {}) {
  if (!entry || entry.outcome !== 'Covered') return null;
  const lane = laneFields(entry.lane || {}); if (!lane) return null;
  const t = Date.parse(entry.closedAt); if (!Number.isFinite(t)) return null;
  const head = (entry.rows || []).find(r => r.variant === 'Original') || (entry.rows || [])[0] || {};
  const rate = Math.round(safeNumeric(entry.rate));
  const target = Math.round(safeNumeric(entry.targetRate) || safeNumeric(entry.datRate));
  const car = carrierFields(entry.carrier || {}, carriers);
  const sane = rate > 0 && (!target || (rate >= target * RATE_SANITY.low && rate <= target * RATE_SANITY.high)) && rate >= 100 && rate <= 25000;
  return {
    id: 'c-' + entry.id, k: 'c', t, u: me.uid, ...lane, e: oneLine(entry.equip || head.equip || 'V', 4).toUpperCase(), mi: milesOf({ ...entry.lane, originZip: head.originZip, destZip: head.destZip }, zipMap),
    ...car, r: rate > 0 ? rate : 0, tg: target || 0, lf: repriceTotal(head.ops), hr: Number.isFinite(Number(entry.ageHours)) ? Math.round(Number(entry.ageHours) * 10) / 10 : 0,
    iq: Math.round(safeNumeric(entry.inquiries)), v: sane && !!car.cr ? 1 : 0,
  };
}

/** A carrier inquiry from the Inquiry Log. The rate only counts (v=1) when the app believes it. */
export function inquiryEvent(q, me, { postings = [], carriers = [], settings = {}, zipMap = null } = {}) {
  if (!q || !q.id) return null;
  const lane = laneFields(q); if (!lane) return null;
  const t = Date.parse(q.dateCounted); if (!Number.isFinite(t)) return null;
  const post = postings.find(p => p.id === q.postingId);
  const target = safeNumeric(q.targetRate) || (post ? safeNumeric(post.targetRate) || safeNumeric(post.datRate) : 0);
  const verdict = judgeQuote(q, { target, settings, ownText: post ? [post.details, post.notes].join('\n') : '' });
  const ok = verdict.has && verdict.ok && !verdict.unverified;
  return {
    id: 'i-' + q.id, k: 'i', t, u: me.uid, ...lane, e: oneLine((post && post.equip) || 'V', 4).toUpperCase(),
    mi: milesOf({ originCity: q.originCity, originState: q.originState, originZip: post && post.originZip, destCity: q.destCity, destState: q.destState, destZip: post && post.destZip }, zipMap),
    ...carrierFields({ email: q.senderEmail }, carriers), r: ok ? Math.round(verdict.rate) : 0, tg: Math.round(target) || 0, v: ok ? 1 : 0,
  };
}

/** One carrier contacted about a load (an outreach log line). */
export function outreachEvent(o, me, { postings = [], zipMap = null } = {}) {
  const post = postings.find(p => p.id === o.postingId); if (!post) return null;
  const lane = laneFields(post); if (!lane) return null;
  const t = Date.parse(o.dateTime); if (!Number.isFinite(t)) return null;
  const car = carrierFields({ email: o.email, mc: o.mc, name: o.carrierName }, []);
  if (!car.cr) return null;
  return { id: 'o-' + hash(String(o.key || '') + car.cr + (post.groupId || post.id)), k: 'o', t, u: me.uid, ...lane, e: oneLine(post.equip || 'V', 4).toUpperCase(), mi: milesOf(post, zipMap), ...car, r: 0, tg: 0, v: 0 };
}

/** Read an event from storage (never trust another person's file). */
export function cleanEvent(raw, id = '') {
  if (!raw || typeof raw !== 'object' || !KINDS[raw.k]) return null;
  const n = (v, lo = 0, hi = 1e7) => { const x = Number(v); return Number.isFinite(x) && x >= lo && x <= hi ? x : 0; };
  const e = {
    id: oneLine(raw.id || id, 50), k: raw.k, t: Number(raw.t), u: oneLine(raw.u, 80), o: oneLine(raw.o, 80).toLowerCase(), d: oneLine(raw.d, 80).toLowerCase(),
    oc: oneLine(raw.oc, 60), os: stateCode(raw.os), dc: oneLine(raw.dc, 60), ds: stateCode(raw.ds), e: oneLine(raw.e || 'V', 4).toUpperCase(), mi: n(raw.mi, 0, 6000),
    cr: oneLine(raw.cr, 40), cn: oneLine(raw.cn, 80), mc: oneLine(raw.mc, 30), r: n(raw.r, 0, 25000), tg: n(raw.tg, 0, 25000), lf: Math.max(-5000, Math.min(5000, Math.round(Number(raw.lf)) || 0)),
    hr: n(raw.hr, 0, 24 * 60), iq: n(raw.iq, 0, 10000), v: raw.v ? 1 : 0,
  };
  return e.id && e.u && Number.isFinite(e.t) && e.o && e.d ? e : null;
}

/* ------------------------------------------------------------------------------------------------ aggregation */
const within = (events, now, days) => events.filter(e => e.t >= now - days * DAY && e.t <= now + DAY);
const verifiedRate = (e) => e.v === 1 && e.r > 0;

/** { ok, n, contributors, needN, needContributors } for a set of events: is it enough to base advice on? */
export function confidence(events, opts = {}) {
  const o = { ...DEFAULTS, ...opts };
  const covers = events.filter(e => e.k === 'c' && verifiedRate(e));
  const contributors = new Set(covers.map(e => e.u)).size;
  return { ok: covers.length >= o.minSample && contributors >= o.minContributors, n: covers.length, contributors, needN: o.minSample, needContributors: o.minContributors };
}

/** Everything the team knows about one lane (origin market > destination market). `events` may be unfiltered; `uid` marks the viewer's own. */
export function summarizeLane(events, { o, d }, { now = Date.now(), uid = '', ...opts } = {}) {
  const cfg = { ...DEFAULTS, ...opts };
  const evs = within(events, now, cfg.days).filter(e => e.o === o && e.d === d);
  const inq = evs.filter(e => e.k === 'i'), cov = evs.filter(e => e.k === 'c'), out = evs.filter(e => e.k === 'o');
  const asks = inq.filter(verifiedRate).map(e => e.r);
  const paid = cov.filter(verifiedRate).sort((a, b) => b.t - a.t);
  const head = evs[0] || {};
  const eq = {}; for (const e of evs) { const f = equipFamily(e.e); eq[f] = (eq[f] || 0) + 1; }
  const carriers = new Map();
  for (const e of evs) {
    if (!e.cr) continue;
    const c = carriers.get(e.cr) || { cr: e.cr, name: '', mc: '', replies: 0, covers: 0, contacted: 0, rates: [], last: 0, by: new Set() };
    if (e.cn) c.name = e.cn; if (e.mc) c.mc = e.mc;
    if (e.k === 'i') c.replies++; else if (e.k === 'c') c.covers++; else c.contacted++;
    if (verifiedRate(e)) c.rates.push(e.r);
    c.last = Math.max(c.last, e.t); c.by.add(e.u);
    carriers.set(e.cr, c);
  }
  const responsive = [...carriers.values()].filter(c => c.replies + c.covers > 0)
    .map(c => ({ cr: c.cr, name: c.name, mc: c.mc, replies: c.replies, covers: c.covers, contacted: c.contacted, avgRate: c.rates.length ? Math.round(mean(c.rates)) : 0, last: c.last, by: [...c.by] }))
    .sort((a, b) => b.covers * 3 + b.replies - (a.covers * 3 + a.replies) || b.last - a.last).slice(0, 8);
  const byMonth = new Map();
  for (const e of [...inq, ...cov].filter(verifiedRate)) { const m = monthKey(e.t); (byMonth.get(m) || byMonth.set(m, { ask: [], paid: [] }).get(m))[e.k === 'c' ? 'paid' : 'ask'].push(e.r); }
  const trend = [...byMonth.entries()].sort((a, b) => a[0].localeCompare(b[0])).map(([m, v]) => ({ month: m, ask: v.ask.length ? Math.round(median(v.ask)) : 0, askN: v.ask.length, paid: v.paid.length ? Math.round(median(v.paid)) : 0, paidN: v.paid.length }));
  const lifts = cov.filter(e => verifiedRate(e)).map(e => e.lf);
  return {
    o, d, oc: head.oc || '', os: head.os || '', dc: head.dc || '', ds: head.ds || '', miles: Math.round(median(evs.map(e => e.mi).filter(x => x > 0)) || 0),
    inquiries: inq.length, carriersContacted: new Set(out.map(e => e.cr)).size, covers: cov.length,
    avgAsk: asks.length ? Math.round(mean(asks)) : 0, askN: asks.length,
    lastCover: paid[0] ? { rate: paid[0].r, t: paid[0].t, name: paid[0].cn, mc: paid[0].mc } : null, coverN: paid.length,
    medianLift: lifts.length ? roundTo(median(lifts), 5) : null,
    equipment: eq, responsive, trend,
    contributors: new Set(evs.map(e => e.u)).size, mine: uid ? evs.filter(e => e.u === uid).length : 0, lastAt: Math.max(0, ...evs.map(e => e.t)),
    confidence: confidence(evs, cfg),
  };
}

/** Every lane the team has data for, busiest first. */
export function summarizeLanes(events, { now = Date.now(), uid = '', ...opts } = {}) {
  const cfg = { ...DEFAULTS, ...opts };
  const keys = new Map();
  for (const e of within(events, now, cfg.days)) { const k = e.o + '>' + e.d; if (!keys.has(k)) keys.set(k, { o: e.o, d: e.d }); }
  return [...keys.values()].map(k => summarizeLane(events, k, { now, uid, ...opts })).sort((a, b) => (b.inquiries + b.covers * 2) - (a.inquiries + a.covers * 2) || b.lastAt - a.lastAt);
}

/* ------------------------------------------------------------------------------------------------ recommendations */
/**
 * "How much did similar loads need before they covered?"  Looks at verified covers (the same lane first, then similar lanes: same
 * equipment family and a similar length). load: { o, d, equip, miles, os, ds }.
 * Returns { ok:true, level, n, contributors, medianLift, p75Lift, shareRaised, medianHours } or { ok:false, reason, n, contributors }.
 */
export function liftAdvice(events, load, { now = Date.now(), ...opts } = {}) {
  const cfg = { ...DEFAULTS, ...opts };
  const fam = equipFamily(load.equip);
  const pool = within(events, now, cfg.days).filter(e => e.k === 'c' && verifiedRate(e) && e.tg > 0 && equipFamily(e.e) === fam);
  const exact = pool.filter(e => e.o === load.o && e.d === load.d);
  const tol = Math.max(cfg.similarMilesMin, (load.miles || 0) * cfg.similarMilesPct);
  const similar = load.miles > 0 ? pool.filter(e => e.mi > 0 && Math.abs(e.mi - load.miles) <= tol) : pool.filter(e => e.os === load.os && e.ds === load.ds);
  const tiers = [['lane', exact], ['similar', similar]];
  let best = { n: 0, contributors: 0 };
  for (const [level, set] of tiers) {
    const c = confidence(set, cfg);
    if (c.n > best.n) best = { n: c.n, contributors: c.contributors };
    if (!c.ok) continue;
    const lifts = set.map(e => Math.max(0, e.lf)), hours = set.map(e => e.hr).filter(h => h > 0);
    return { ok: true, level, n: c.n, contributors: c.contributors, medianLift: roundTo(median(lifts), 25), p75Lift: roundTo(percentile(lifts, 0.75), 25), shareRaised: lifts.filter(x => x > 0).length / lifts.length, medianHours: hours.length ? Math.round(median(hours) * 10) / 10 : null };
  }
  return { ok: false, reason: `Not enough verified team data on loads like this yet (${best.n} of ${cfg.minSample} covers, ${best.contributors} of ${cfg.minContributors} teammates).`, n: best.n, contributors: best.contributors };
}

/** One sentence for the board. `raised` = what the owner has already added to the rate. */
export function liftText(a, raised = 0) {
  if (!a) return '';
  if (!a.ok) return a.reason;
  const where = a.level === 'lane' ? 'this lane' : 'similar lanes';
  const need = a.medianLift > 0 ? `the rate was raised a median ${'$' + a.medianLift} before it covered` : 'the first posted rate usually covered it';
  const share = a.medianLift > 0 || a.shareRaised > 0 ? ` (${Math.round(a.shareRaised * 100)}% needed any raise)` : '';
  const mine = raised > 0 ? ` You have raised it $${Math.round(raised)} so far.` : '';
  return `On ${a.n} verified covers on ${where} (${a.contributors} teammates), ${need}${share}.${mine}`;
}

/**
 * The next reprice step the team data supports: what is still missing to reach the typical raise, in $25 steps. null when the data is not
 * sufficient (the caller keeps the app's normal percentage step) or when the load has already been raised past the typical amount.
 */
export function suggestStep(a, raised = 0) {
  if (!a || !a.ok) return null;
  const left = Math.max(0, (a.medianLift || 0) - Math.max(0, raised));
  if (left > 0) return { step: Math.min(500, Math.max(25, roundTo(left, 25))), basis: 'typical' };
  const more = Math.max(0, (a.p75Lift || 0) - Math.max(0, raised));
  return more > 0 ? { step: Math.min(500, Math.max(25, roundTo(more, 25))), basis: 'upper' } : null;
}

/** Key of a lane for the viewer's own load. */
export const laneOf = (p) => ({ o: marketKey(p.originCity, p.originState), d: marketKey(p.destCity, p.destState), os: stateCode(p.originState), ds: stateCode(p.destState) });
