// DAT bulk-posting export (the "DAT" worksheet). Columns A..T come from the same fields the macros fill on the
// FREIGHT SIGNAL sheet. Header text is configurable because the screenshots truncate it.

import { DAT_COLUMNS } from './defaults.js';
import { parseDelimited, detectDelimiter, toDelimited } from './csv.js';

/** Resolve header row: override text (tab/comma separated) maps by position onto A..T, extra headers become blank columns. */
export function datLayout(settings) {
  const cols = DAT_COLUMNS.map(c => ({ ...c }));
  const ov = String(settings?.datHeaderOverride ?? '').trim();
  if (!ov) return cols;
  const headers = parseDelimited(ov, detectDelimiter(ov))[0] || [];
  const out = [];
  headers.forEach((h, i) => {
    if (i < cols.length) out.push({ ...cols[i], header: h.trim() || cols[i].header });
    else out.push({ letter: '', key: null, header: h.trim() });
  });
  return out.length ? out : cols;
}

/** Posting rows ready for DAT: groups stay together, original first (sheet order). Covered/removed rows are not present. */
export function datRows(postings, settings) {
  const layout = datLayout(settings);
  return postings
    .filter(p => String(p.status ?? 'Active').toLowerCase() !== 'covered')
    .map(p => layout.map(c => (c.key ? (p[c.key] ?? '') : '')));
}

export function datHeader(settings) { return datLayout(settings).map(c => c.header); }

export function datCsv(postings, settings) {
  return toDelimited([datHeader(settings), ...datRows(postings, settings)], ',');
}

/** Tab-separated, for pasting straight into the DAT template workbook. Header optional. */
export function datTsv(postings, settings, withHeader = false) {
  const rows = datRows(postings, settings);
  if (withHeader) rows.unshift(datHeader(settings));
  return rows.map(r => r.join('\t')).join('\r\n');
}
