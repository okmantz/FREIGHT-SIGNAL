// Outside resources a broker uses to find and vet a truck. Every function only BUILDS a link (or a tel: / mailto: href);
// the app never calls these sites itself, so nothing is sent anywhere until the person clicks. Pure functions, unit-tested.

import { FINDTRUCK_URL, RATEVIEW_BASE, VENTUSKY_URL } from './defaults.js';

export const FMCSA_SAFER_URL = 'https://safer.fmcsa.dot.gov/CompanySnapshot.aspx';

const clean = (s) => String(s ?? '').trim();
const place = (city, st) => [clean(city), clean(st).toUpperCase()].filter(Boolean).join(', ');

/**
 * Read an MC or DOT number out of the free-text MC/DOT column: "MC 123456", "MC#123456", "USDOT 3456789", "123456".
 * When both appear the DOT wins (it is the unique one). A bare number of 7+ digits is taken as a DOT, shorter as an MC.
 */
export function parseMcDot(text) {
  const t = clean(text); if (!t) return null;
  const dot = t.match(/(?:us\s*)?dot\s*(?:no\.?|#|:)?\s*(\d{3,9})/i);
  if (dot) return { type: 'DOT', num: dot[1] };
  const mc = t.match(/\b(?:mc|mx|ff)\s*(?:no\.?|#|:|-)?\s*(\d{3,8})/i);
  if (mc) return { type: 'MC', num: mc[1] };
  const bare = t.match(/^\D*(\d{3,9})\D*$/);
  if (bare) return { type: bare[1].length >= 7 ? 'DOT' : 'MC', num: bare[1] };
  return null;
}

/** The FMCSA SAFER company snapshot for a carrier's MC/DOT: authority, insurance, safety rating, power units. */
export function fmcsaUrl(mcDot) {
  const p = parseMcDot(mcDot); if (!p) return '';
  return `https://safer.fmcsa.dot.gov/query.asp?searchtype=ANY&query_type=queryCarrierSnapshot&query_param=${p.type === 'DOT' ? 'USDOT' : 'MC_MX'}&query_string=${p.num}`;
}

/** Google Maps driving route for a load (origin to destination). '' when either end is missing. */
export function mapsRouteUrl(p) {
  const o = place(p.originCity, p.originState), d = place(p.destCity, p.destState);
  if (!o || !d) return '';
  return `https://www.google.com/maps/dir/?api=1&origin=${encodeURIComponent(o)}&destination=${encodeURIComponent(d)}&travelmode=driving`;
}

/** Google Maps search for trucking companies around the load's origin (a way to find carriers that are not in the database yet). */
export function mapsCarriersNearUrl(p) {
  const o = place(p.originCity, p.originState); if (!o) return '';
  return `https://www.google.com/maps/search/?api=1&query=${encodeURIComponent('trucking companies near ' + o)}`;
}

/** tel: link from a free-text phone number ("(555) 123-4567 x12" -> tel:5551234567). '' when it does not look like a phone number. */
export function telHref(phone) {
  const main = clean(phone).split(/\b(?:ext\.?|x)\s*\d+/i)[0];
  const d = main.replace(/\D/g, '');
  if (d.length < 7 || d.length > 15) return '';
  return 'tel:' + (/^\s*\+/.test(main) ? '+' : '') + d;
}

/** mailto: link, only for something that looks like an address. */
export const mailHref = (email) => (/^[^\s@,;]+@[^\s@,;]+\.[^\s@,;]+$/.test(clean(email)) ? 'mailto:' + clean(email) : '');

/** The Home page "Cover toolkit" strip. */
export const TOOLKIT = [
  { id: 'dat-trucks', label: 'DAT Find Trucks', note: 'Search posted trucks', url: FINDTRUCK_URL, icon: 'truck' },
  { id: 'dat-rates', label: 'DAT RateView', note: 'Lane rate averages', url: RATEVIEW_BASE, icon: 'rateview' },
  { id: 'fmcsa', label: 'FMCSA SAFER', note: 'Check authority and insurance', url: FMCSA_SAFER_URL, icon: 'shield' },
  { id: 'maps', label: 'Google Maps', note: 'Routes and carriers near a pickup', url: 'https://www.google.com/maps', icon: 'route' },
  { id: 'weather', label: 'Ventusky weather', note: 'Weather along the lane', url: VENTUSKY_URL, icon: 'storm' },
];
