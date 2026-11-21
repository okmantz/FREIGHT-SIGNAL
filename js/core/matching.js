// Two-way matching (v17): every open load is matched against every available truck, and every newly reported truck against every open load.
// Pure: no DOM, no storage. The store runs `reconcileMatches` whenever a load or a truck arrives and keeps the result in the `matches` store,
// so "how many qualified trucks did this load get without anybody searching?" is a number you can read (matchStats).

import { activeTrucks, matchTrucksToLoad, carrierHistoryFromLog, truckKeyOf } from './truckbook.js';
import { headsOf } from './corridor.js';

/** Tiers from truckbook.scoreTruck that count as a qualified match. */
export const QUALIFIED = ['hot', 'good'];
export const matchId = (loadId, truckKey) => String(loadId) + '|' + String(truckKey);
export const isOpenLoad = (p) => p && p.status !== 'Covered' && p.status !== 'Expired' && (!p.variant || p.variant === 'Original');
export const openLoads = (postings) => headsOf(postings).filter(isOpenLoad);
const keyOf = (t) => t.key || truckKeyOf(t);

/**
 * Cross every open load with every active truck.
 * in:  { existing:[match], loads:[posting heads], trucks:[truck], zipMap, now, coverLog, newLoadIds:Set, newTruckKeys:Set, radius }
 * out: { matches:[match], added:[match], dropped:[match], newTrucks:[{truck, loads:[match]}] }
 * match = { id, loadId, truckKey, truckId, carrierName, email, phone, score, tier, deadhead, reasons, firstAt, lastAt, via:'load'|'truck'|'sweep', status:'new'|'seen'|'contacted'|'dismissed', team }
 */
export function reconcileMatches({ existing = [], loads = [], trucks = [], zipMap = null, now = Date.now(), coverLog = [], newLoadIds = new Set(), newTruckKeys = new Set(), radius = 150 } = {}) {
  const active = activeTrucks(trucks, now);
  const ctx = { zipMap, now, carrierHistory: carrierHistoryFromLog(coverLog), radius };
  const old = new Map(existing.map(m => [m.id, m]));
  const matches = []; const added = []; const seen = new Set();
  for (const load of loads.filter(isOpenLoad)) {
    for (const r of matchTrucksToLoad(load, active, ctx)) {
      if (!QUALIFIED.includes(r.tier)) continue;
      const tk = keyOf(r.truck); const id = matchId(load.id, tk); seen.add(id);
      const prev = old.get(id);
      const via = prev ? prev.via : newTruckKeys.has(tk) ? 'truck' : newLoadIds.has(load.id) ? 'load' : 'sweep';
      const m = { id, loadId: load.id, truckKey: tk, truckId: r.truck.id, carrierName: r.truck.carrierName || '', email: r.truck.email || '', phone: r.truck.phone || '', score: r.score, tier: r.tier,
        deadhead: r.deadhead, reasons: r.reasons, firstAt: prev ? prev.firstAt : now, lastAt: now, via, status: prev ? prev.status : 'new', team: !!(r.truck.by && r.truck.source === 'team') };
      matches.push(m); if (!prev) added.push(m);
    }
  }
  // contacted / dismissed matches stay for their load while the load is open, so the history is not lost when the truck fades
  const openIds = new Set(loads.filter(isOpenLoad).map(l => l.id));
  for (const m of existing) if (!seen.has(m.id) && openIds.has(m.loadId) && (m.status === 'contacted' || m.status === 'dismissed')) matches.push(m);
  const dropped = existing.filter(m => !matches.some(x => x.id === m.id));
  const byTruck = new Map();
  for (const m of added.filter(x => x.via === 'truck')) { const e = byTruck.get(m.truckKey) || { truck: active.find(t => keyOf(t) === m.truckKey) || null, loads: [] }; e.loads.push(m); byTruck.set(m.truckKey, e); }
  return { matches, added, dropped, newTrucks: [...byTruck.values()] };
}

/** The success metric: qualified truck matches generated automatically per load. */
export function matchStats(matches = [], loads = []) {
  const open = loads.filter(isOpenLoad); const per = new Map(open.map(l => [l.id, 0]));
  let hot = 0, total = 0;
  for (const m of matches) { if (m.status === 'dismissed' || !per.has(m.loadId)) continue; per.set(m.loadId, per.get(m.loadId) + 1); total++; if (m.tier === 'hot') hot++; }
  const withMatch = [...per.values()].filter(n => n > 0).length;
  return { loads: open.length, total, hot, withMatch, withoutMatch: open.length - withMatch, avgPerLoad: open.length ? Math.round((total / open.length) * 10) / 10 : 0, perLoad: per };
}

export const matchesForLoad = (matches, loadId) => (matches || []).filter(m => m.loadId === loadId && m.status !== 'dismissed').sort((a, b) => b.score - a.score);
export const matchesForTruck = (matches, truckKey) => (matches || []).filter(m => m.truckKey === truckKey && m.status !== 'dismissed').sort((a, b) => b.score - a.score);
