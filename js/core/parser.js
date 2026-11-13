// TQL load-detail parser. Port of ParseLoadDetailsIntoRow and its helpers (Excel v3).
// Labels the macro looks for: "Pickup:", "Pickup Date/Time:", "Delivery:" (LAST occurrence),
// "Weight:", "Trailer Type:". Behaviour is intentionally identical, including quirks, which are
// reported as warnings rather than silently changed.

import { normalizeZip, normalizeDateString } from './util.js';

const splitLines = (text) => String(text ?? '').replace(/\r\n/g, '\n').replace(/\r/g, '\n').split('\n');

/** GetLineValue: first line whose trimmed text starts with label (case-insensitive). */
export function getLineValue(text, label) {
  for (const line of splitLines(text)) {
    const one = line.trim();
    if (one.slice(0, label.length).toLowerCase() === label.toLowerCase()) return one.slice(label.length).trim();
  }
  return '';
}

/** GetLastLineValue: LAST line starting with label. */
export function getLastLineValue(text, label) {
  let out = '';
  for (const line of splitLines(text)) {
    const one = line.trim();
    if (one.length >= label.length && one.slice(0, label.length).toLowerCase() === label.toLowerCase()) {
      out = one.slice(label.length).trim();
    }
  }
  return out;
}

/** ParseCityStateZip: "City, ST 12345" -> parts. Everything blank if there is no comma. */
export function parseCityStateZip(text) {
  const out = { city: '', state: '', zip: '' };
  const p = text.indexOf(',');
  if (p === -1) return out;
  out.city = text.slice(0, p).trim();
  const rest = text.slice(p + 1).replace(/\t/g, ' ').trim().replace(/ {2,}/g, ' ');
  const parts = rest.split(' ');
  if (parts.length >= 1) out.state = (parts[0] || '').toUpperCase();
  if (parts.length >= 2) out.zip = normalizeZip(parts[1]);
  return out;
}

/** ExtractFirstDate: first m/d/yyyy */
export function extractFirstDate(text) {
  const m = /\b\d{1,2}\/\d{1,2}\/\d{4}\b/.exec(text);
  return m ? m[0] : '';
}

/** ExtractWeight: keeps every digit in the text (quirk: "40,000.00" becomes "4000000"). */
export function extractWeight(text) {
  return String(text ?? '').replace(/[^0-9]/g, '');
}

/** GetEquipmentCode */
export function getEquipmentCode(text) {
  const t = String(text ?? '').toLowerCase();
  const team = /\bteam\b|\bteams\b/.test(t);
  if (t.includes('reefer') && !t.includes('van')) return team ? 'RM' : 'R';   // RM = reefer team
  if (t.includes('flat')) return 'F';
  if (t.includes('step')) return 'SD';
  if (/straight\s*(?:box|truck)|box\s*truck|\bsb\b/.test(t)) return 'SB';   // straight box truck
  return team ? 'VM' : 'V';                                                  // VM = van team
}

/** ExtractLastZipAfterLabel: 5-digit(-4) zip found on the LAST line starting with label. */
export function extractLastZipAfterLabel(text, label) {
  const line = getLastLineValue(text, label);
  const m = /\b\d{5}(?:-\d{4})?\b/.exec(line);
  return m ? normalizeZip(m[0]) : '';
}

/**
 * Parse one TQL load block into posting fields.
 * Returns { fields, warnings, missing } - `missing` lists required DAT fields that could not be found.
 */
export function parseTqlLoad(raw, opts = {}) {
  const rawText = String(raw ?? '');
  const warnings = [];
  const pickupLine = getLineValue(rawText, 'Pickup:');
  const deliveryLine = getLastLineValue(rawText, 'Delivery:');
  const o = parseCityStateZip(pickupLine);
  const d = parseCityStateZip(deliveryLine);
  const dateLine = getLineValue(rawText, 'Pickup Date/Time:');
  const date = normalizeDateString(extractFirstDate(dateLine));
  const weightLine = getLineValue(rawText, 'Weight:');
  const weight = extractWeight(weightLine);
  const trailer = getLineValue(rawText, 'Trailer Type:');

  const missing = [];
  if (!pickupLine) missing.push('Pickup:'); else if (!o.city || !o.state) missing.push('Pickup city/state');
  if (!deliveryLine) missing.push('Delivery:'); else if (!d.city || !d.state) missing.push('Delivery city/state');
  if (!date) missing.push('Pickup Date/Time:');
  if (!weight) missing.push('Weight:');
  if (!trailer) warnings.push('No "Trailer Type:" line found; equipment defaults to V (van), as in the macro.');
  if (/[.]\d/.test(weightLine)) warnings.push(`Weight line "${weightLine}" contains a decimal point. The macro keeps every digit, so the weight parses as ${weight}. Verify it.`);
  if (/\bpick\s*2\b/i.test(rawText) || /^\s*[2-9]\s*pick/im.test(rawText)) {
    warnings.push('Multi-stop load: the macro uses the FIRST "Pickup:" line and the LAST "Delivery:" line.');
  }

  const fields = {
    pickupEarliest: date,
    pickupLatest: date,
    length: 53,
    weight,
    fullPartial: 'Full',
    equip: getEquipmentCode(trailer),
    usePrivate: 'no',
    allowPrivBooking: 'no',
    allowPrivBidding: 'no',
    useDat: 'yes',
    allowDatBooking: 'no',
    useExtended: 'no',
    contact: 'Email',
    originCity: o.city,
    originState: o.state.toUpperCase(),
    originZip: o.zip,
    destCity: d.city,
    destState: d.state.toUpperCase(),
    destZip: d.zip,
    details: rawText,
    notes: '::', // macro writes "::" into AutoReplyNotes when it is empty
  };
  return { fields, warnings, missing, ok: missing.length === 0, opts };
}

/**
 * Split a paste that contains several TQL loads. The macro handles exactly one load per cell, so this
 * is a web-app addition. Splits at lines that match `separatorRegex` (default "N pick - M drop") or at
 * lines made only of 3+ dashes/equals. If no marker is found the whole paste is one load.
 */
export function splitLoads(text, separatorRegex = '^\\s*\\d+\\s*pick\\s*[-–]\\s*\\d+\\s*drop') {
  const lines = splitLines(text);
  let re;
  try { re = new RegExp(separatorRegex, 'i'); } catch { re = /^\s*\d+\s*pick\s*[-–]\s*\d+\s*drop/i; }
  const rule = /^\s*[-=]{3,}\s*$/;
  const starts = [];
  lines.forEach((l, i) => { if (re.test(l)) starts.push(i); });
  let blocks = [];
  if (starts.length >= 2 || (starts.length === 1 && starts[0] > 0 && lines.slice(0, starts[0]).some(l => /Pickup:/i.test(l)))) {
    const cut = starts.length ? starts : [0];
    if (cut[0] !== 0 && lines.slice(0, cut[0]).some(l => l.trim())) cut.unshift(0);
    for (let k = 0; k < cut.length; k++) blocks.push(lines.slice(cut[k], k + 1 < cut.length ? cut[k + 1] : lines.length).join('\n'));
  } else if (lines.some(l => rule.test(l))) {
    let cur = [];
    for (const l of lines) { if (rule.test(l)) { blocks.push(cur.join('\n')); cur = []; } else cur.push(l); }
    blocks.push(cur.join('\n'));
  } else {
    blocks = [lines.join('\n')];
  }
  return blocks.map(b => b.replace(/^\s*\n+|\n+\s*$/g, '')).filter(b => b.trim() !== '');
}
