// ZIP Map: parsed copy of the "ZIP Map" worksheet (zip, lat, lng, city, state_id, population ...).
// Required headers (ValidateZipMap in Excel v3): zip, lat, lng, city, state_id, population.

import { parseDelimited } from './csv.js';
import { normalizeText, normalizeZip, isSameCity, calculateDistanceMiles, canonHeader } from './util.js';

const REQUIRED = ['zip', 'lat', 'lng', 'city', 'stateid', 'population'];

export class ZipMap {
  constructor() {
    this.rows = [];
    this.byZipFirst = new Map();   // first row per ZIP (ZipMatchesCityState semantics)
    this.byZipGeo = new Map();     // first row per ZIP with numeric lat/lng (distance center semantics)
    this.cityIdx = new Map();      // "city|ST" -> row indexes in file order
    this.missingHeaders = [];
  }

  /** Build from CSV text. Throws if required headers are missing. */
  static fromCsv(text) {
    const table = parseDelimited(text, ',');
    if (!table.length) throw new Error('ZIP Map file is empty.');
    const header = table[0].map(canonHeader);
    const col = (name) => header.indexOf(name);
    const missing = REQUIRED.filter(h => col(h) === -1);
    if (missing.length) {
      const e = new Error('ZIP Map is missing row-1 header(s): ' + missing.map(m => m === 'stateid' ? 'state_id' : m).join(', '));
      e.missing = missing;
      throw e;
    }
    const ci = {
      zip: col('zip'), lat: col('lat'), lng: col('lng'), city: col('city'), st: col('stateid'), pop: col('population'),
      stateName: col('statename'), density: col('density'), county: col('countyname'), tz: col('timezone'),
      military: col('military'), imprecise: col('imprecise'), zcta: col('zcta'),
    };
    const zm = new ZipMap();
    for (let r = 1; r < table.length; r++) {
      const t = table[r];
      if (!t.length || (t.length === 1 && t[0] === '')) continue;
      const lat = t[ci.lat] === '' || t[ci.lat] === undefined ? NaN : Number(t[ci.lat]);
      const lng = t[ci.lng] === '' || t[ci.lng] === undefined ? NaN : Number(t[ci.lng]);
      const pop = Number(t[ci.pop]);
      const row = {
        zip: normalizeZip(t[ci.zip]),
        lat, lng,
        city: String(t[ci.city] ?? '').trim(),
        state: String(t[ci.st] ?? '').trim().toUpperCase(),
        population: Number.isFinite(pop) ? pop : 0,
        stateName: ci.stateName >= 0 ? t[ci.stateName] : '',
        county: ci.county >= 0 ? t[ci.county] : '',
        timezone: ci.tz >= 0 ? t[ci.tz] : '',
        density: ci.density >= 0 ? t[ci.density] : '',
        military: ci.military >= 0 ? t[ci.military] : '',
        imprecise: ci.imprecise >= 0 ? t[ci.imprecise] : '',
      };
      zm._add(row);
    }
    return zm;
  }

  _add(row) {
    const idx = this.rows.length;
    this.rows.push(row);
    if (row.zip && !this.byZipFirst.has(row.zip)) this.byZipFirst.set(row.zip, row);
    if (row.zip && Number.isFinite(row.lat) && Number.isFinite(row.lng) && !this.byZipGeo.has(row.zip)) this.byZipGeo.set(row.zip, row);
    const key = normalizeText(row.city) + '|' + row.state;
    let list = this.cityIdx.get(key);
    if (!list) { list = []; this.cityIdx.set(key, list); }
    list.push(idx);
  }

  get size() { return this.rows.length; }

  /**
   * Markets = one entry per city: population summed over its ZIPs, location = population-weighted centre, ZIP = the biggest ZIP.
   * (The old matrix scored single ZIP rows, so a city was judged by one neighbourhood.) Built once, then cached.
   */
  markets() {
    if (this._markets) return this._markets;
    const m = new Map();
    for (const r of this.rows) {
      if (!Number.isFinite(r.lat) || !Number.isFinite(r.lng) || !r.city || !r.state || !r.zip) continue;
      const key = normalizeText(r.city) + '|' + normalizeText(r.state);   // lower-case "city|st" (same shape as coverlog.cityKey)
      let c = m.get(key);
      if (!c) { c = { key, city: r.city, state: r.state, zip: r.zip, pop: 0, _w: 0, _lat: 0, _lng: 0, _best: -1 }; m.set(key, c); }
      const w = Math.max(r.population, 1);
      c.pop += r.population; c._w += w; c._lat += r.lat * w; c._lng += r.lng * w;
      if (r.population > c._best) { c._best = r.population; c.zip = r.zip; }
    }
    for (const c of m.values()) { c.lat = c._lat / c._w; c.lng = c._lng / c._w; delete c._w; delete c._lat; delete c._lng; delete c._best; }
    this._markets = m;
    return m;
  }

  /** Market for a city/state, or null. */
  market(city, state) { return this.markets().get(normalizeText(city) + '|' + normalizeText(state)) || null; }

  findZip(zip) { return this.byZipFirst.get(normalizeZip(zip)) || null; }

  /** BestZipForCityState: highest-population ZIP for city+state; first row wins ties. */
  bestZipForCityState(city, state) {
    const list = this.cityIdx.get(normalizeText(city) + '|' + String(state ?? '').trim().toUpperCase());
    if (!list) return '';
    let best = '', bestPop = 0;
    for (const i of list) {
      const r = this.rows[i];
      if (best === '' || r.population > bestPop) { best = r.zip; bestPop = r.population; }
    }
    return best;
  }

  /** ZipMatchesCityState: looks at the first row with that ZIP. */
  zipMatchesCityState(zip, city, state) {
    const r = this.findZip(zip);
    if (!r) return false;
    return isSameCity(r.city, r.state, city, state);
  }

  /** Distance in miles between two ZIPs (null when either is missing). */
  distanceBetweenZips(zipA, zipB) {
    const a = this.byZipGeo.get(normalizeZip(zipA)), b = this.byZipGeo.get(normalizeZip(zipB));
    if (!a || !b) return null;
    return calculateDistanceMiles(a.lat, a.lng, b.lat, b.lng);
  }

  /** Cities (best ZIP row per city) within [minMiles, maxMiles] of a centre ZIP, nearest first. For the ZIP Map page. */
  searchRadius(centerZip, minMiles, maxMiles, limit = 500) {
    const c = this.byZipGeo.get(normalizeZip(centerZip));
    if (!c) return [];
    const best = new Map();
    for (const r of this.rows) {
      if (!Number.isFinite(r.lat) || !Number.isFinite(r.lng) || !r.city || !r.state || !r.zip) continue;
      const d = calculateDistanceMiles(c.lat, c.lng, r.lat, r.lng);
      if (d < minMiles || d > maxMiles) continue;
      const key = normalizeText(r.city) + '|' + r.state;
      const cur = best.get(key);
      if (!cur || r.population > cur.population) best.set(key, { ...r, miles: d });
    }
    return [...best.values()].sort((x, y) => x.miles - y.miles).slice(0, limit);
  }

  /** Free-text search for the ZIP Map page. */
  search(q, limit = 200) {
    const s = String(q ?? '').trim().toLowerCase();
    if (!s) return this.rows.slice(0, limit);
    const out = [];
    for (const r of this.rows) {
      if (r.zip.startsWith(s) || r.city.toLowerCase().includes(s) || r.state.toLowerCase() === s ||
          (r.stateName && String(r.stateName).toLowerCase().includes(s)) || (r.county && String(r.county).toLowerCase().includes(s))) {
        out.push(r);
        if (out.length >= limit) break;
      }
    }
    return out;
  }
}
