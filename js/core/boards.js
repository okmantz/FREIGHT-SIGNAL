// Other load boards: TruckSmarter and Trucker Path (TruckLoads).
//
// Freight Signal never logs in to a load board and never sends anything by itself. It builds the file (or the text) you hand to the board:
//   * TruckSmarter publishes its CSV format (docs.trucksmarter.com, "Row-Per-Load"). This module writes exactly those columns, so the file
//     uploads in the Broker Portal (Add Loads > CSV/Excel upload) or goes by e-mail to the intake address TruckSmarter gave you.
//   * Trucker Path / TruckLoads does not publish a fixed CSV layout. This module writes a plain, clearly named load sheet, and if you paste
//     the header row of the template your TruckLoads account gave you, it fills THAT layout instead (columns it does not know stay blank
//     and are reported, never guessed).
//   * Either board, one load at a time: a copy-ready text block for the board's "post a load" form.
// What a posting needs on these boards that DAT does not: a contact phone, a delivery date and time, and (TruckSmarter) a weight.
// The delivery date is an estimate: pickup + miles / `milesPerDay` (default 500). Estimates are listed in the report so you can check them.

import { datPostings, loadKey, loadsWithOwnRates } from './dat.js';
import { toDelimited } from './csv.js';
import { equipFamilies, equipInfo, equipLabel } from './equipment.js';
import { laneMiles } from './lanes.js';
import { gridLabel } from './model.js';
import { safeNumeric } from './util.js';
import { isoDay, addDays, usDate, oneLine } from './netcommon.js';

export const BOARD_LINKS = {
  trucksmarter: { name: 'TruckSmarter', site: 'https://www.trucksmarter.com/brokers', docs: 'https://docs.trucksmarter.com/reference/send-loads-via-email-csv-excel' },
  truckerpath: { name: 'Trucker Path (TruckLoads)', site: 'https://truckerpath.com/truckloads/broker-signup/', docs: 'https://truckerpath.com/' },
};

export const BOARD_DEFAULTS = {
  contactPhone: '', contactEmail: '', defaultWeight: 0, milesPerDay: 500, pickupTime: '8:00', deliveryTime: '17:00', tsIntakeEmail: '', tpHeaders: '',
};
export const boardSettings = (s) => ({ ...BOARD_DEFAULTS, ...((s && s.boards) || {}) });

/* ------------------------------------------------------------------------------------------------ shared pieces */
const digits = (v) => String(v ?? '').replace(/\D/g, '');
const rateOf = (v) => { const n = Math.round(safeNumeric(v)); return n > 0 ? String(n) : ''; };
const clean = (v, n = 200) => oneLine(String(v ?? '').normalize('NFD').replace(/[̀-ͯ]/g, '').replace(/[^\x20-\x7e]/g, ''), n);

/** The price a posting carries on these boards: its own DAT rate, else the load's target (same rule as the DAT file). */
export function postingPrice(p, ownRates) {
  return rateOf(p.datRate) || (ownRates ? '' : rateOf(p.targetRate));
}

/** Estimated delivery day: pickup + one day per `milesPerDay`, at least one. */
export function deliveryDay(pickupIso, miles, milesPerDay = 500) {
  const days = Math.max(1, Math.ceil((Number.isFinite(miles) ? miles : 0) / Math.max(100, milesPerDay)));
  return addDays(pickupIso, days);
}

/** Time as h:mm (TruckSmarter's format): "08:00" -> "8:00", "5pm" -> "17:00". Falls back to `fallback`. */
export function hmm(v, fallback = '8:00') {
  const t = String(v ?? '').trim().toLowerCase();
  const m = /^(\d{1,2})(?::(\d{2}))?\s*(am|pm)?$/.exec(t); if (!m) return fallback;
  let h = Number(m[1]); const min = m[2] || '00';
  if (m[3] === 'pm' && h < 12) h += 12; if (m[3] === 'am' && h === 12) h = 0;
  return h > 23 ? fallback : `${h}:${min}`;
}

/** Everything both boards need about one posting, plus what is missing / estimated. */
function prepare(p, ctx, own) {
  const cfg = boardSettings(ctx.settings);
  const pickup = isoDay(p.pickupEarliest);
  const miles = laneMiles(p, ctx.zip);
  const missing = [], assumed = [];
  if (!pickup) missing.push('Pickup date');
  let weight = digits(p.weight);
  if (!weight) { if (cfg.defaultWeight > 0) { weight = String(Math.round(cfg.defaultWeight)); assumed.push(`weight ${weight} lb (your default)`); } else missing.push('Weight'); }
  if (!digits(p.originZip)) missing.push('Origin ZIP'); if (!digits(p.destZip)) missing.push('Destination ZIP');
  if (!p.originCity || !p.originState || !p.destCity || !p.destState) missing.push('Origin / destination city and state');
  const phone = clean(cfg.contactPhone, 30);
  if (!phone) missing.push('Contact phone (set it under Team > Board posting)');
  let delivery = '';
  if (pickup) { delivery = deliveryDay(pickup, miles, cfg.milesPerDay); assumed.push(`delivery ${usDate(delivery)}${miles ? ` (${Math.round(miles)} mi)` : ''}`); }
  return { cfg, pickup, miles, weight, phone, delivery, price: postingPrice(p, own), missing, assumed };
}
const labelOf = (p) => `${p.originCity || '?'}, ${p.originState || '?'} to ${p.destCity || '?'}, ${p.destState || '?'}${p.variant ? ' (' + p.variant + ')' : ''}`;
const loadId = (p, all) => {
  const ref = clean(p.referenceId, 30) || clean(p.groupId, 30) || p.id.slice(0, 8);
  const g = gridLabel(p.variant);
  return all.some(x => x !== p && loadKey(x) === loadKey(p)) || g ? `${ref}-${g || 'A-A'}` : ref;
};

/* ------------------------------------------------------------------------------------------------ TruckSmarter */
// DAT equipment code -> TruckSmarter EquipmentCode. 'exact' codes mean the same thing on both; 'assumed' are the closest published code.
// TruckSmarter's list (V R F C VR SD FSD VF PO RGN HS BX CN FCN FHS AC CC CV DT BH HB TN SGN) comes with no descriptions in its docs, so only
// obvious matches are marked exact. Any other equipment falls back to its family (van V, reefer R, flatbed F, step deck SD) and is reported.
const TS_EXACT = new Set(['V', 'R', 'F', 'C', 'VR', 'SD', 'VF', 'PO', 'CN', 'AC', 'CV', 'DT', 'HB']);
const TS_ASSUMED = { FD: 'FSD', RG: 'RGN', FH: 'HS', SB: 'BX', PT: 'PO', PL: 'PO' };
const TS_FAMILY = { van: 'V', reefer: 'R', flatbed: 'F', stepdeck: 'SD', box: 'BX', power: 'PO', sprinter: 'V' };

export function tsEquipment(code) {
  const c = String(code ?? '').trim().toUpperCase();
  if (TS_EXACT.has(c)) return { code: c, note: '' };
  if (TS_ASSUMED[c]) return { code: TS_ASSUMED[c], note: `${equipLabel(c)} sent as ${TS_ASSUMED[c]} (closest TruckSmarter code)` };
  const fam = (equipInfo(c) ? equipFamilies(c)[0] : 'van') || 'van';
  const out = TS_FAMILY[fam] || 'V';
  return { code: out, note: `${equipLabel(c) || c || 'Van'} sent as ${out} (TruckSmarter has no exact match)` };
}

export const TS_COLUMNS = ['LoadId', 'ContactPhone', 'ContactEmail', 'EquipmentCode', 'Length', 'Weight', 'PickUpCity', 'PickUpState', 'PickUpZipCode', 'DeliveryCity', 'DeliveryState', 'DeliveryZipCode',
  'PickUpStartDate', 'PickUpStartTime', 'DeliveryStartDate', 'DeliveryStartTime', 'Commodity', 'OfferPrice', 'Distance', 'GeneralNotes'];

/**
 * TruckSmarter "Row-Per-Load" CSV for a list of postings. ctx: { settings, zip, all (every posting, for rate rules) }.
 * Returns { csv, count, problems:[{label, missing}], notes:[text] }. Postings with a missing required field are LEFT OUT and listed.
 */
export function trucksmarterCsv(postings, ctx = {}) {
  const live = datPostings(postings), own = loadsWithOwnRates(ctx.all || postings);
  const rows = [], problems = [], notes = new Set();
  for (const p of live) {
    const x = prepare(p, ctx, own.has(loadKey(p)));
    if (x.missing.length) { problems.push({ label: labelOf(p), missing: x.missing }); continue; }
    const eq = tsEquipment(p.equip); if (eq.note) notes.add(eq.note);
    rows.push([clean(loadId(p, live), 40), x.phone, clean(x.cfg.contactEmail, 80), eq.code, digits(p.length) || '53', x.weight, clean(p.originCity, 60), clean(p.originState, 2).toUpperCase(), digits(p.originZip).slice(0, 5),
      clean(p.destCity, 60), clean(p.destState, 2).toUpperCase(), digits(p.destZip).slice(0, 5), x.pickup, hmm(x.cfg.pickupTime, '8:00'), x.delivery, hmm(x.cfg.deliveryTime, '17:00'),
      clean(p.commodity, 60), x.price, x.miles ? String(Math.round(x.miles)) : '', clean(p.comment, 200)]);
  }
  if (rows.length) notes.add('Delivery dates are estimates (pickup + miles / ' + boardSettings(ctx.settings).milesPerDay + ' per day). TruckSmarter requires one, so check them.');
  return { csv: toDelimited([TS_COLUMNS, ...rows], ',', '\n'), count: rows.length, problems, notes: [...notes] };
}

export const tsFileName = (date = new Date()) => `freight-signal-trucksmarter-${date.toISOString().slice(0, 10)}.csv`;

/** Draft e-mail text for the TruckSmarter intake address (nothing is sent; the CSV is attached by you). */
export function tsEmailDraft(settings, count) {
  const cfg = boardSettings(settings);
  return { to: cfg.tsIntakeEmail, subject: 'Load postings', body: `Attached: ${count} load${count === 1 ? '' : 's'} (CSV, one attachment).\nSent from ${cfg.contactEmail || 'my broker account'}.` };
}

/* ------------------------------------------------------------------------------------------------ Trucker Path / generic */
/** Standard load sheet columns: key -> default header. */
export const SHEET_FIELDS = [
  ['loadId', 'Load ID'], ['pickupDate', 'Pickup Date'], ['pickupTime', 'Pickup Time'], ['oCity', 'Origin City'], ['oState', 'Origin State'], ['oZip', 'Origin ZIP'],
  ['dCity', 'Destination City'], ['dState', 'Destination State'], ['dZip', 'Destination ZIP'], ['deliveryDate', 'Delivery Date'], ['deliveryTime', 'Delivery Time'],
  ['equipment', 'Equipment'], ['equipCode', 'Equipment Code'], ['length', 'Length (ft)'], ['weight', 'Weight (lb)'], ['rate', 'Rate'], ['commodity', 'Commodity'],
  ['phone', 'Contact Phone'], ['email', 'Contact Email'], ['distance', 'Distance (mi)'], ['notes', 'Notes'],
];

// Words that identify a column of someone else's template. First match wins, so the more specific patterns come first.
const ALIASES = [
  ['deliveryDate', /^(delivery|deliver|drop|dropoff|del|dest(ination)?)(start|earliest)?date$|^deliverydate/],
  ['deliveryTime', /^(delivery|deliver|drop|dropoff|del|dest(ination)?)(start|earliest)?time$/],
  ['pickupDate', /^(pickup|pu|ship|origin|available|avail)(start|earliest)?date$|^pickupdate$|^shipdate$|^readydate$/],
  ['pickupTime', /^(pickup|pu|ship|origin)(start|earliest)?time$/],
  ['oCity', /^(origin|pickup|pu|from|ship(per)?)city$/], ['oState', /^(origin|pickup|pu|from|ship(per)?)state(code)?$|^originst$/], ['oZip', /^(origin|pickup|pu|from)(zip|postal)(code)?$/],
  ['dCity', /^(dest(ination)?|delivery|deliver|drop|to|del|consignee)city$/], ['dState', /^(dest(ination)?|delivery|deliver|drop|to|del|consignee)state(code)?$|^destst$/], ['dZip', /^(dest(ination)?|delivery|deliver|drop|to|del)(zip|postal)(code)?$/],
  ['equipCode', /^equip(ment)?(code|type)?$|^trailertype$|^trucktype$|^truckcode$/],
  ['length', /^(trailer)?length(ft)?$/], ['weight', /^(load)?weight(lbs?)?$/], ['rate', /^(offer)?(price|rate)$|^linehaul$|^allin(rate)?$|^postedrate$|^offerprice$/],
  ['commodity', /^commodity$|^freight$|^description$/], ['phone', /^(contact)?phone(number)?$/], ['email', /^(contact)?email$/], ['distance', /^(distance|miles|mileage)$/],
  ['notes', /^(general)?notes?$|^comments?$|^remarks?$|^instructions?$/], ['loadId', /^(load)?(id|number|no|ref(erence)?(id|number)?)$|^referenceid$|^loadref$/],
];
const canon = (h) => String(h ?? '').toLowerCase().replace(/[^a-z0-9]/g, '');

/** Map a pasted template header row to our fields. Returns { map: [key|null per column], unknown: [header...] }. */
export function mapHeaders(headerText) {
  const cols = String(headerText ?? '').split(/\t|,(?=(?:[^"]*"[^"]*")*[^"]*$)/).map(h => h.replace(/^"|"$/g, '').trim()).filter(h => h !== '');
  const used = new Set(), map = [], unknown = [];
  for (const h of cols) {
    const c = canon(h);
    const hit = ALIASES.find(([key, re]) => !used.has(key) && re.test(c));
    if (hit) { used.add(hit[0]); map.push(hit[0]); } else { map.push(null); unknown.push(h); }
  }
  return { headers: cols, map, unknown };
}

/**
 * Trucker Path / generic load sheet. With `settings.boards.tpHeaders` (the header row of the template your account gave you) the columns follow
 * that template; otherwise the standard sheet. Returns { csv, count, problems, notes, layout: 'template'|'standard' }.
 */
export function truckerPathCsv(postings, ctx = {}) {
  const live = datPostings(postings), own = loadsWithOwnRates(ctx.all || postings);
  const cfg = boardSettings(ctx.settings);
  const tpl = cfg.tpHeaders ? mapHeaders(cfg.tpHeaders) : null;
  const useTpl = tpl && tpl.map.some(Boolean);
  const header = useTpl ? tpl.headers : SHEET_FIELDS.map(f => f[1]);
  const keys = useTpl ? tpl.map : SHEET_FIELDS.map(f => f[0]);
  const rows = [], problems = [], notes = new Set();
  for (const p of live) {
    const x = prepare(p, ctx, own.has(loadKey(p)));
    if (x.missing.length) { problems.push({ label: labelOf(p), missing: x.missing }); continue; }
    const v = {
      loadId: clean(loadId(p, live), 40), pickupDate: x.pickup, pickupTime: hmm(cfg.pickupTime, '8:00'), oCity: clean(p.originCity, 60), oState: clean(p.originState, 2).toUpperCase(), oZip: digits(p.originZip).slice(0, 5),
      dCity: clean(p.destCity, 60), dState: clean(p.destState, 2).toUpperCase(), dZip: digits(p.destZip).slice(0, 5), deliveryDate: x.delivery, deliveryTime: hmm(cfg.deliveryTime, '17:00'),
      equipment: equipLabel(p.equip), equipCode: clean(p.equip, 4).toUpperCase(), length: digits(p.length) || '53', weight: x.weight, rate: x.price,
      commodity: clean(p.commodity, 60), phone: x.phone, email: clean(cfg.contactEmail, 80), distance: x.miles ? String(Math.round(x.miles)) : '', notes: clean(p.comment, 200),
    };
    rows.push(keys.map(k => (k ? v[k] ?? '' : '')));
  }
  if (useTpl && tpl.unknown.length) notes.add(`Columns left blank because they were not recognised: ${tpl.unknown.join(', ')}.`);
  if (useTpl) notes.add('Equipment is written as the DAT code (V, R, F ...). If your template wants words, change it in the file before uploading.');
  else notes.add('Standard load sheet: Trucker Path publishes no fixed CSV layout. Paste the header row of the template from your account under Team > Boards to match it exactly.');
  if (rows.length) notes.add('Delivery dates are estimates (pickup + miles / ' + cfg.milesPerDay + ' per day).');
  return { csv: toDelimited([header, ...rows], ',', '\n'), count: rows.length, problems, notes: [...notes], layout: useTpl ? 'template' : 'standard' };
}
export const tpFileName = (date = new Date()) => `freight-signal-truckerpath-${date.toISOString().slice(0, 10)}.csv`;

/* ------------------------------------------------------------------------------------------------ one load as text */
/** Copy-ready block for typing a load into a board's "post a load" form. Only the postings you pass; the matrix original is usually enough. */
export function postText(p, ctx = {}) {
  const own = loadsWithOwnRates(ctx.all || [p]);
  const x = prepare(p, ctx, own.has(loadKey(p)));
  const lines = [
    `${p.originCity}, ${p.originState} ${digits(p.originZip).slice(0, 5)}  >  ${p.destCity}, ${p.destState} ${digits(p.destZip).slice(0, 5)}`.replace(/ {2,}/g, '  '),
    `Pickup: ${p.pickupEarliest || '?'}${x.delivery ? `   Delivery (est.): ${usDate(x.delivery)}` : ''}`,
    `Equipment: ${equipLabel(p.equip)} (${String(p.equip).toUpperCase()})   Length: ${digits(p.length) || '53'} ft   Weight: ${x.weight || '?'} lb`,
    x.price ? `Rate: $${x.price}` : null, x.miles ? `Distance: ${Math.round(x.miles)} mi` : null, p.commodity ? `Commodity: ${clean(p.commodity, 60)}` : null,
    x.phone ? `Contact: ${x.phone}${x.cfg.contactEmail ? ' / ' + x.cfg.contactEmail : ''}` : (x.cfg.contactEmail ? `Contact: ${x.cfg.contactEmail}` : null),
    p.comment ? `Notes: ${clean(p.comment, 200)}` : null,
  ].filter(Boolean);
  return lines.join('\n');
}

