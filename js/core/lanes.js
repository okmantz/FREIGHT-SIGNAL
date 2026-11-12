// Lane classes (local / regional / long) and the posting strategy that goes with each.
// The class is decided from the straight-line distance between the origin and destination ZIP centres (x ROAD_FACTOR
// to approximate road miles). Everything a strategy controls is editable in System -> Posting strategy by lane length.

import { normalizeZip } from './util.js';

export const ROAD_FACTOR = 1.15;
export const LANE_CLASSES = ['local', 'regional', 'long'];
export const LANE_LABEL = { local: 'Local', regional: 'Regional', long: 'Long-distance' };

/**
 * What each class does differently.
 *  altMin / altIdeal / altMax  - how far (miles) alternate pickup / delivery cities may be; altIdeal is the sweet spot the matrix prefers.
 *  minPop                      - smallest city (population) the matrix will use for an alternate in the first rings.
 *  outreachMultiplier          - x the load's outreach target (Low 5 / Medium 10 / High 15): local freight needs a wide net of nearby trucks,
 *                                long-haul needs fewer, better-matched carriers.
 *  staleHours                  - hours with zero inquiries before a load counts as "aging" (second wave / reprice).
 *  repricePct / repriceMin / repriceMax - the one-click reprice step: % of the DAT rate, clamped to [min, max] dollars, rounded to $25.
 *  closingHours                - how close to pickup (hours) counts as "closing".
 */
export const DEFAULT_STRATEGIES = {
  local:    { altMin: 3,  altIdeal: 8,  altMax: 30, minPop: 20000, outreachMultiplier: 1.5,  staleHours: 1.5, repricePct: 6, repriceMin: 50,  repriceMax: 150, closingHours: 12 },
  regional: { altMin: 4,  altIdeal: 14, altMax: 55, minPop: 25000, outreachMultiplier: 1,    staleHours: 3,   repricePct: 4, repriceMin: 75,  repriceMax: 200, closingHours: 24 },
  long:     { altMin: 5,  altIdeal: 20, altMax: 80, minPop: 30000, outreachMultiplier: 0.75, staleHours: 5,   repricePct: 3, repriceMin: 100, repriceMax: 300, closingHours: 36 },
};

export function strategyFor(settings, cls) {
  const base = DEFAULT_STRATEGIES[cls] || DEFAULT_STRATEGIES.regional;
  const over = (settings && settings.strategies && settings.strategies[cls]) || {};
  const out = { ...base };
  for (const [k, v] of Object.entries(over)) { const n = Number(v); if (Number.isFinite(n) && n >= 0) out[k] = n; }
  return out;
}

export function classForMiles(miles, settings = {}) {
  const local = Number(settings.laneLocalMax) > 0 ? Number(settings.laneLocalMax) : 150;
  const regional = Number(settings.laneRegionalMax) > local ? Number(settings.laneRegionalMax) : Math.max(600, local + 1);
  if (!Number.isFinite(miles)) return 'regional';
  return miles < local ? 'local' : miles <= regional ? 'regional' : 'long';
}

/** Road-mile estimate for a posting's lane using the ZIP Map. null when either end cannot be located. */
export function laneMiles(p, zipMap) {
  if (!zipMap || !zipMap.size) return null;
  const oz = normalizeZip(p.originZip) || zipMap.bestZipForCityState(p.originCity, p.originState);
  const dz = normalizeZip(p.destZip) || zipMap.bestZipForCityState(p.destCity, p.destState);
  if (!oz || !dz) return null;
  const d = zipMap.distanceBetweenZips(oz, dz);
  return d === null ? null : d * ROAD_FACTOR;
}

/** { cls, miles, label, strategy } for a posting (class 'regional' when the lane cannot be measured). */
export function classifyLane(p, zipMap, settings = {}) {
  const miles = laneMiles(p, zipMap);
  const cls = classForMiles(miles, settings);
  return { cls, miles, label: LANE_LABEL[cls], strategy: strategyFor(settings, cls) };
}

/** Matrix search rings for a strategy: tight first, widening only when too few markets are found. */
export function ringsFor(strategy) {
  const { altMin: lo, altMax: hi } = strategy;
  return [
    { min: lo, max: hi, minPop: strategy.minPop },
    { min: lo, max: Math.round(hi * 1.75), minPop: strategy.minPop },
    { min: lo, max: Math.round(hi * 3), minPop: Math.round(strategy.minPop / 2) },
    { min: 0, max: Math.round(hi * 6), minPop: 5000 },
    { min: 0, max: 99999, minPop: 0 },
  ];
}
