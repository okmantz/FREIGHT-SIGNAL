// Weather flags (optional, on by default; System > Weather). Looks up active National Weather Service alerts for the pickup and
// delivery cities of the loads on the board. The ONLY thing sent is a latitude/longitude per city to api.weather.gov (public, no key).
// No load, customer or carrier data leaves the browser. Results are cached for 30 minutes and requests are throttled.

import { state, actions } from './state.js';
import { NWS_ALERTS_URL, summariseAlerts, weatherKey } from '../core/weather.js';
import { normalizeText } from '../core/util.js';

const TTL = 30 * 60 * 1000, MAX_CITIES = 60, PARALLEL = 4;
const cache = new Map();        // "lat,lng" -> { at, alerts }
export const weatherStatus = { lastRun: '', cities: 0, failed: 0, error: '' };
let running = false, timer = null;

const cityKey = (c, s) => normalizeText(c) + '|' + normalizeText(s);

/** Distinct { key, lat, lng } for every city on live loads (pickup cities first so the cap never drops them). */
function wanted() {
  const zm = state.zip; if (!zm) return [];
  const out = new Map();
  const add = (city, st) => {
    if (!city || !st) return; const k = cityKey(city, st); if (out.has(k)) return;
    const m = zm.market(city, st); if (!m || !Number.isFinite(m.lat) || !Number.isFinite(m.lng)) return;
    out.set(k, { key: k, lat: m.lat, lng: m.lng });
  };
  const live = state.postings.filter(p => String(p.status || 'Active').toLowerCase() !== 'covered');
  for (const p of live) add(p.originCity, p.originState);
  for (const p of live) if (p.variant === 'Original' || !p.variant) add(p.destCity, p.destState);
  return [...out.values()].slice(0, MAX_CITIES);
}

async function fetchOne(w) {
  const wk = weatherKey(w.lat, w.lng);
  const hit = cache.get(wk);
  if (hit && Date.now() - hit.at < TTL) return hit.alerts;
  const r = await fetch(NWS_ALERTS_URL + encodeURIComponent(Number(w.lat).toFixed(4) + ',' + Number(w.lng).toFixed(4)), { headers: { Accept: 'application/geo+json' } });
  if (!r.ok) throw new Error('weather.gov answered ' + r.status);
  const alerts = summariseAlerts(await r.json());
  cache.set(wk, { at: Date.now(), alerts });
  return alerts;
}

/** Refresh alerts for every city on the board. Safe to call often (cached, throttled, one run at a time). */
export async function refreshWeather(force = false) {
  if (running) return;
  if (!state.settings.weatherFlags) { if (state.weather.size) actions.setWeather(new Map()); return; }
  running = true;
  try {
    if (force) cache.clear();
    const list = wanted(); const map = new Map(); let failed = 0;
    for (let i = 0; i < list.length; i += PARALLEL) {
      await Promise.all(list.slice(i, i + PARALLEL).map(async (w) => {
        try { const a = await fetchOne(w); if (a.length) map.set(w.key, a); } catch (e) { failed++; weatherStatus.error = String(e.message || e); }
      }));
    }
    weatherStatus.lastRun = new Date().toISOString(); weatherStatus.cities = list.length; weatherStatus.failed = failed;
    if (!failed) weatherStatus.error = '';
    const same = JSON.stringify([...map]) === JSON.stringify([...state.weather]);
    if (!same) actions.setWeather(map);
  } finally { running = false; }
}

/** Start the 30-minute refresh loop (first run shortly after boot). */
export function startWeather() {
  if (timer) return;
  setTimeout(() => refreshWeather(false), 2500);
  timer = setInterval(() => { if (!document.hidden) refreshWeather(false); }, TTL);
}
