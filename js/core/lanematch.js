// How two lanes relate (same / nearby / none). Shared by rate intelligence, carrier matching and load difficulty so they all agree.
import { normalizeText } from './util.js';
import { stateCode } from './netcommon.js';

const nm = (v) => normalizeText(v);
export const placeKey = (city, st) => nm(city) + '|' + stateCode(st).toLowerCase();
const spot = (zipMap, city, st) => { try { const m = zipMap && zipMap.size ? zipMap.market(city, st) : null; return m && m.zip ? m.zip : ''; } catch { return ''; } };
const miles = (zipMap, a, b) => { try { return a && b ? zipMap.distanceBetweenZips(a, b) : null; } catch { return null; } };

/** Plain lane object from anything that has originCity / originState / destCity / destState. */
export const laneOf = (x = {}) => ({ originCity: x.originCity || '', originState: stateCode(x.originState), destCity: x.destCity || '', destState: stateCode(x.destState) });
export const laneKey = (x) => { const l = laneOf(x); return placeKey(l.originCity, l.originState) + '>' + placeKey(l.destCity, l.destState); };

/**
 * relation(a, b, { zipMap, radius }) -> { kind: 'same' | 'near' | 'state' | '', w, oMi, dMi }
 *  same  = same origin city and same destination city (or both ends within 12 miles when the ZIP Map knows them)
 *  near  = both ends within `radius` miles (default 60)
 *  state = same origin state and same destination state (only used when no ZIP Map is available)
 */
export function relation(a, b, { zipMap = null, radius = 60 } = {}) {
  const A = laneOf(a), B = laneOf(b);
  if (!A.originState || !A.destState || !B.originState || !B.destState) return { kind: '', w: 0 };
  if (placeKey(A.originCity, A.originState) === placeKey(B.originCity, B.originState) && placeKey(A.destCity, A.destState) === placeKey(B.destCity, B.destState) && A.originCity && A.destCity) return { kind: 'same', w: 1, oMi: 0, dMi: 0 };
  if (zipMap && zipMap.size) {
    const ao = spot(zipMap, A.originCity, A.originState), bo = spot(zipMap, B.originCity, B.originState), ad = spot(zipMap, A.destCity, A.destState), bd = spot(zipMap, B.destCity, B.destState);
    const oMi = miles(zipMap, ao, bo), dMi = miles(zipMap, ad, bd);
    if (oMi !== null && dMi !== null) {
      if (oMi <= 12 && dMi <= 12) return { kind: 'same', w: 0.95, oMi, dMi };
      if (oMi <= radius && dMi <= radius) return { kind: 'near', w: Math.max(0.25, 0.7 - (oMi + dMi) / (4 * radius)), oMi, dMi };
    }
    return { kind: '', w: 0 };
  }
  if (A.originState === B.originState && A.destState === B.destState) return { kind: 'state', w: 0.3 };
  return { kind: '', w: 0 };
}
