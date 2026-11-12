// Weather flags from the US National Weather Service alerts API (api.weather.gov, public domain, no key).
// This file is the PURE part: which alerts count as "severe", whether they overlap the pickup window, and how to summarise them.
// store/weather.js does the (optional, user-switchable) fetching and caching.
//
// Privacy: the only thing ever sent is a latitude/longitude of a pickup or delivery city. No load, customer or carrier data.

export const NWS_ALERTS_URL = 'https://api.weather.gov/alerts/active?status=actual&message_type=alert,update&point=';

// Events that make a pickup fall apart. Severity "Severe"/"Extreme" alerts are always flagged; these are flagged at any severity.
const ALWAYS = /(blizzard|ice storm|winter storm|tornado|hurricane|tropical storm|flash flood|dust storm|extreme cold|extreme wind|high wind warning|snow squall|storm surge|avalanche|excessive heat warning|dense fog advisory)/i;
// Never flagged on their own (noise for a dispatcher).
const IGNORE = /(special weather statement|air quality|beach|rip current|small craft|frost advisory|heat advisory|freeze watch|red flag|hydrologic outlook)/i;

/** [{ event, severity, headline, onset, ends, level }] for one NWS response (a GeoJSON FeatureCollection). */
export function summariseAlerts(json) {
  const feats = json && Array.isArray(json.features) ? json.features : [];
  const out = [];
  for (const f of feats) {
    const p = (f && f.properties) || {};
    const event = String(p.event || '').trim(); if (!event) continue;
    if (String(p.status || 'Actual') !== 'Actual') continue;
    const sev = String(p.severity || '');
    const hit = ALWAYS.test(event) || /^(Severe|Extreme)$/i.test(sev);
    if (!hit || (IGNORE.test(event) && !/^(Severe|Extreme)$/i.test(sev))) continue;
    out.push({
      event, severity: sev || 'Unknown', headline: String(p.headline || event).slice(0, 160),
      onset: p.onset || p.effective || '', ends: p.ends || p.expires || '',
      level: /^(Extreme)$/i.test(sev) || /(blizzard|ice storm|tornado|hurricane|flash flood)/i.test(event) ? 'severe' : 'watch',
    });
  }
  return out;
}

/** Does an alert overlap [from, to]? Missing times count as "now", so a current alert always overlaps today. */
export function overlapsWindow(alert, from, to) {
  const s = Date.parse(alert.onset), e = Date.parse(alert.ends);
  const start = Number.isFinite(s) ? s : -Infinity, end = Number.isFinite(e) ? e : Infinity;
  return start <= to.getTime() && end >= from.getTime();
}

/** Window to protect for a posting: from now until the end of its pickup day (or 24 h when the date is unknown). */
export function pickupWindow(p, now, parse) {
  const d = parse(p.pickupLatest) || parse(p.pickupEarliest);
  const to = d ? new Date(d.getFullYear(), d.getMonth(), d.getDate(), 23, 59, 59) : new Date(now.getTime() + 24 * 3600000);
  return { from: now, to: to.getTime() < now.getTime() ? new Date(now.getTime() + 3600000) : to };
}

export const weatherKey = (lat, lng) => Number(lat).toFixed(2) + ',' + Number(lng).toFixed(2);

/** One-line label for a set of alerts. */
export function alertLabel(alerts) {
  if (!alerts || !alerts.length) return '';
  const sorted = [...alerts].sort((a, b) => (a.level === 'severe' ? 0 : 1) - (b.level === 'severe' ? 0 : 1));
  const names = [...new Set(sorted.map(a => a.event))];
  return names.slice(0, 2).join(' + ') + (names.length > 2 ? ` +${names.length - 2}` : '');
}
