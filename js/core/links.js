// External links: DAT RateView (port of OpenDATRateView) and Ventusky weather.

import { RATEVIEW_BASE, VENTUSKY_URL, FINDTRUCK_URL, EQUIPMENT } from './defaults.js';

/**
 * OpenDATRateView: https://iq.dat.com/rateview/<origin city>-<st>~<dest city>-<st>~<Van|Reefer|Flatbed>
 * City text is lower-cased, "-" becomes "_" and spaces become %20 (state codes lower-cased). Nothing else is encoded,
 * exactly as in the macro. No pricing is fetched or fabricated: the link just opens DAT's own RateView.
 */
export function rateViewUrl(p) {
  let oc = String(p.originCity ?? '').trim().toLowerCase();
  const os = String(p.originState ?? '').trim().toLowerCase();
  let dc = String(p.destCity ?? '').trim().toLowerCase();
  const ds = String(p.destState ?? '').trim().toLowerCase();
  if (!oc || !os || !dc || !ds) return { ok: false, error: 'This row is missing an origin or destination.' };
  oc = oc.replace(/-/g, '_').replace(/ /g, '%20');
  dc = dc.replace(/-/g, '_').replace(/ /g, '%20');
  let equipment;
  switch (String(p.equip ?? '').trim().toUpperCase()) {
    case 'R': case 'RM': equipment = 'Reefer'; break;
    case 'F': case 'SD': equipment = 'Flatbed'; break;   // VM falls through to Van
    default: equipment = 'Van';            // V, VM and SB (straight box truck) all use the Van rate
  }
  return { ok: true, url: `${RATEVIEW_BASE}${oc}-${os}~${dc}-${ds}~${equipment}` };
}

/**
 * Ventusky weather. The workbook has a "VENTUSKY WEATHER APP" button; its exact target URL was not provided,
 * so this opens ventusky.com. With coordinates (from the ZIP Map) it uses Ventusky's map-position URL form.
 * The coordinate URL format is documented as UNVERIFIED in docs/OPEN-QUESTIONS.md.
 */
export function ventuskyUrl(lat, lng) {
  if (!Number.isFinite(lat) || !Number.isFinite(lng)) return VENTUSKY_URL;
  return `${VENTUSKY_URL}?p=${lat.toFixed(3)};${lng.toFixed(3)};8&l=temperature-2m`;
}

/**
 * "Find more carriers": DAT One's Find Trucks page for this load. DAT has no documented URL that pre-fills the search, so this returns the page
 * plus the lane exactly as the form wants it (origin and destination as "City, ST", equipment, pickup date) for the app to copy and show.
 */
export function findTruckInfo(p) {
  const oc = String(p.originCity ?? '').trim(), os = String(p.originState ?? '').trim().toUpperCase();
  const dc = String(p.destCity ?? '').trim(), ds = String(p.destState ?? '').trim().toUpperCase();
  if (!oc || !os || !dc || !ds) return { ok: false, error: 'This load is missing an origin or destination.' };
  const code = String(p.equip ?? '').trim().toUpperCase();
  const e = EQUIPMENT.find(x => x.code === code);
  return { ok: true, url: FINDTRUCK_URL, origin: `${oc}, ${os}`, dest: `${dc}, ${ds}`, equipment: e ? e.label : (code || 'Van'), pickup: String(p.pickupEarliest ?? '').trim() };
}
