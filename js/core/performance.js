// Is Freight Signal actually making you faster and better? Every finished load (covered OR expired) gets a small "fx" snapshot taken at the moment it
// closed: minutes from entry to cover, calls, carriers contacted, whether a historical carrier or a newly found one covered it, whether the app's
// suggestion was the one that worked, how hard the load was, and the rate against the target and against what that lane covered at before.
// summarize() turns those into the numbers on the Cover Log, with the sample size next to each one so a small sample is not mistaken for a trend.
import { safeNumeric } from './util.js';
import { mean, median, DAY } from './netcommon.js';

const callOps = new Set(['call', 'assign-call', 'call-carrier']);
const round = (n, d = 1) => (n === null || n === undefined || !Number.isFinite(n) ? null : Math.round(n * 10 ** d) / 10 ** d);

/**
 * fxSnapshot(input) -> fx record stored on the Cover Log entry.
 *   input: { entry, ops, outreach (log rows of this group), carrier, dbCarrier, logBefore, diff, plan:{shownAt, keys:Set of suggested carrier keys, assignedKeys:Set}, priorAvgRate, carrierKeyOf }
 */
export function fxSnapshot({ entry, ops = [], outreach = [], carrier = {}, dbCarrier = null, logBefore = [], diff = null, plan = null, priorAvgRate = null, keyOf = () => '' }) {
  const minutes = Number(entry.ageHours) >= 0 && entry.ageHours !== '' ? Math.round(Number(entry.ageHours) * 60) : null;
  const contacted = new Set(outreach.map(o => String(o.email || o.key || '').toLowerCase()).filter(Boolean)).size;
  const calls = (ops || []).filter(o => callOps.has(o.type)).length;
  const ck = keyOf(carrier);
  const covered = entry.outcome === 'Covered';
  const priorCovers = covered ? (logBefore || []).filter(e => e.outcome === 'Covered' && e.carrier && ((e.carrier.id && e.carrier.id === carrier.id) || (ck && keyOf(e.carrier) === ck))).length : 0;
  const historical = covered ? (priorCovers > 0 || (dbCarrier && safeNumeric(dbCarrier.coverCount) > 0) || (dbCarrier && dbCarrier.verified === 'email')) : null;
  let assistedBy = '';
  if (covered && plan && ck) { if (plan.assignedKeys && plan.assignedKeys.has(ck)) assistedBy = 'primary'; else if (plan.keys && plan.keys.has(ck)) assistedBy = 'match'; }
  const target = safeNumeric(entry.targetRate) || 0, rate = safeNumeric(entry.rate) || 0;
  return {
    v: 1, minutes, calls, contacted, outcome: entry.outcome, historical: covered ? !!historical : null, assistedBy, assisted: !!assistedBy, planShown: !!plan,
    score: diff ? diff.score : null, level: diff ? diff.level : '', tags: diff ? diff.tags : [],
    vsTarget: covered && target > 0 && rate > 0 ? Math.round(target - rate) : null, vsPrior: covered && priorAvgRate > 0 && rate > 0 ? Math.round(priorAvgRate - rate) : null, priorAvgRate: priorAvgRate || null,
  };
}

const fxOf = (e) => e.fx && e.fx.v === 1 ? e.fx : null;
const isHard = (fx) => fx && fx.score !== null && fx.score >= 50;

/** The numbers for the Cover Log. `days` limits to the last N days (0 = all). */
export function summarize(log, { now = Date.now(), days = 0 } = {}) {
  const inRange = (e) => !days || (now - Date.parse(e.closedAt)) / DAY <= days;
  const all = (log || []).filter(e => (e.outcome === 'Covered' || e.outcome === 'Expired') && inRange(e));
  const covered = all.filter(e => e.outcome === 'Covered'), expired = all.filter(e => e.outcome === 'Expired');
  const live = covered.filter(e => !e.imported);                         // loads covered inside the app; history imported from e-mail has no stopwatch
  const fx = live.map(fxOf).filter(Boolean);
  const mins = live.map(e => (fxOf(e) && fxOf(e).minutes !== null ? fxOf(e).minutes : (Number(e.ageHours) >= 0 && e.ageHours !== '' ? Number(e.ageHours) * 60 : NaN))).filter(Number.isFinite);
  const calls = fx.map(f => f.calls), contacted = fx.map(f => f.contacted);
  const hist = fx.filter(f => f.historical === true), fresh = fx.filter(f => f.historical === false);
  const vsTarget = fx.map(f => f.vsTarget).filter(Number.isFinite), vsPrior = fx.map(f => f.vsPrior).filter(Number.isFinite);
  const assisted = live.filter(e => fxOf(e) && fxOf(e).assisted), unassisted = live.filter(e => fxOf(e) && !fxOf(e).assisted && fxOf(e).planShown);
  const minOf = (l) => l.map(e => fxOf(e).minutes).filter(Number.isFinite);
  const am = minOf(assisted), um = minOf(unassisted);
  const saved = am.length >= 3 && um.length >= 3 ? Math.round(mean(um) - mean(am)) : null;
  const tier = (hard) => {
    const done = all.filter(e => { const f = fxOf(e); return f && f.score !== null && isHard(f) === hard; });
    const c = done.filter(e => e.outcome === 'Covered');
    const m = c.filter(e => !e.imported).map(e => fxOf(e).minutes).filter(Number.isFinite);
    return { total: done.length, covered: c.length, rate: done.length ? Math.round(c.length / done.length * 100) : null, avgMinutes: m.length ? Math.round(mean(m)) : null, medianMinutes: m.length ? Math.round(median(m)) : null };
  };
  const assistedRate = (() => { const withPlan = live.filter(e => fxOf(e) && fxOf(e).planShown); return withPlan.length ? Math.round(withPlan.filter(e => fxOf(e).assisted).length / withPlan.length * 100) : null; })();
  return {
    covered: covered.length, expired: expired.length, timed: mins.length, measured: fx.length,
    coverRate: covered.length + expired.length ? Math.round(covered.length / (covered.length + expired.length) * 100) : null,
    avgMinutes: mins.length ? Math.round(mean(mins)) : null, medianMinutes: mins.length ? Math.round(median(mins)) : null,
    avgCalls: calls.length ? round(mean(calls)) : null, avgContacted: contacted.length ? round(mean(contacted)) : null,
    pctHistorical: hist.length + fresh.length ? Math.round(hist.length / (hist.length + fresh.length) * 100) : null,
    pctNew: hist.length + fresh.length ? Math.round(fresh.length / (hist.length + fresh.length) * 100) : null,
    marginVsTarget: vsTarget.length ? Math.round(mean(vsTarget)) : null, marginVsTargetN: vsTarget.length, marginVsPrior: vsPrior.length ? Math.round(mean(vsPrior)) : null, marginVsPriorN: vsPrior.length,
    timeSavedMinutes: saved, assistedN: assisted.length, unassistedN: unassisted.length, assistedPct: assistedRate,
    hard: tier(true), easy: tier(false),
    enough: fx.length >= 8,
  };
}

/** The same numbers for two windows so you can see whether things improved: [this period, previous period]. */
export function compare(log, { now = Date.now(), days = 30 } = {}) {
  const a = summarize(log, { now, days }), b = summarize((log || []).filter(e => { const t = (now - Date.parse(e.closedAt)) / DAY; return t > days && t <= days * 2; }), { now, days: 0 });
  const delta = (x, y) => (x === null || y === null ? null : Math.round((x - y) * 10) / 10);
  return { current: a, previous: b, delta: { avgMinutes: delta(a.avgMinutes, b.avgMinutes), avgCalls: delta(a.avgCalls, b.avgCalls), avgContacted: delta(a.avgContacted, b.avgContacted), coverRate: delta(a.coverRate, b.coverRate), marginVsPrior: delta(a.marginVsPrior, b.marginVsPrior) } };
}

/** One line per metric for the panel: { key, label, value, unit, n, hint, good: 'down'|'up' } */
export function describe(s) {
  const mm = (m) => (m === null ? '' : m < 90 ? m + ' min' : Math.round(m / 6) / 10 + ' h');
  const n = s.measured;
  return [
    { key: 'minutes', label: 'Average time from load entry to cover', value: s.avgMinutes === null ? '' : mm(s.avgMinutes), sub: s.medianMinutes === null ? '' : 'median ' + mm(s.medianMinutes), n: s.timed, good: 'down' },
    { key: 'calls', label: 'Average calls per cover', value: s.avgCalls === null ? '' : String(s.avgCalls), n, good: 'down' },
    { key: 'contacted', label: 'Average carriers contacted per cover', value: s.avgContacted === null ? '' : String(s.avgContacted), n, good: 'down' },
    { key: 'historical', label: 'Covered by historical carriers', value: s.pctHistorical === null ? '' : s.pctHistorical + '%', n, good: 'up' },
    { key: 'new', label: 'Covered by newly discovered carriers', value: s.pctNew === null ? '' : s.pctNew + '%', n, good: 'up' },
    { key: 'margin', label: 'Average margin improvement', value: s.marginVsPrior === null ? (s.marginVsTarget === null ? '' : (s.marginVsTarget >= 0 ? '+$' : '-$') + Math.abs(s.marginVsTarget)) : (s.marginVsPrior >= 0 ? '+$' : '-$') + Math.abs(s.marginVsPrior), sub: s.marginVsPrior === null ? (s.marginVsTarget === null ? '' : 'vs your target rate') : 'vs what the lane covered at before', n: s.marginVsPrior === null ? s.marginVsTargetN : s.marginVsPriorN, good: 'up' },
    { key: 'saved', label: 'Time saved by shared carrier intelligence', value: s.timeSavedMinutes === null ? '' : (s.timeSavedMinutes >= 0 ? '' : '-') + mm(Math.abs(s.timeSavedMinutes)), sub: s.timeSavedMinutes === null ? 'needs 3+ suggested and 3+ unsuggested covers' : 'suggested carriers (' + s.assistedN + ') vs the others (' + s.unassistedN + ')', n: s.assistedN + s.unassistedN, good: 'up' },
    { key: 'hardrate', label: 'Cover rate: difficult lanes', value: s.hard.rate === null ? '' : s.hard.rate + '%', sub: s.hard.total ? s.hard.covered + ' of ' + s.hard.total + (s.hard.avgMinutes ? ', avg ' + mm(s.hard.avgMinutes) : '') : '', n: s.hard.total, good: 'up' },
    { key: 'easyrate', label: 'Cover rate: easy lanes', value: s.easy.rate === null ? '' : s.easy.rate + '%', sub: s.easy.total ? s.easy.covered + ' of ' + s.easy.total + (s.easy.avgMinutes ? ', avg ' + mm(s.easy.avgMinutes) : '') : '', n: s.easy.total, good: 'up' },
  ];
}
