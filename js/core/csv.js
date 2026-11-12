// Minimal RFC 4180 CSV/TSV reader and writer. No dependencies.

/** Parse delimited text into an array of rows (arrays of strings). */
export function parseDelimited(text, delimiter = ',') {
  const rows = [];
  let row = [], field = '', i = 0, inQuotes = false;
  const n = text.length;
  if (n && text.charCodeAt(0) === 0xFEFF) i = 1; // BOM
  while (i < n) {
    const ch = text[i];
    if (inQuotes) {
      if (ch === '"') {
        if (text[i + 1] === '"') { field += '"'; i += 2; continue; }
        inQuotes = false; i++; continue;
      }
      field += ch; i++; continue;
    }
    if (ch === '"' && field === '') { inQuotes = true; i++; continue; }
    if (ch === delimiter) { row.push(field); field = ''; i++; continue; }
    if (ch === '\r') { i++; continue; }
    if (ch === '\n') { row.push(field); rows.push(row); row = []; field = ''; i++; continue; }
    field += ch; i++;
  }
  if (field !== '' || row.length) { row.push(field); rows.push(row); }
  return rows;
}

/** Guess delimiter from first line: tab (pasted from Excel) or comma. */
export function detectDelimiter(text) {
  const first = text.split(/\r?\n/, 1)[0] || '';
  const tabs = (first.match(/\t/g) || []).length;
  const commas = (first.match(/,/g) || []).length;
  return tabs >= commas && tabs > 0 ? '\t' : ',';
}

function escapeField(v, delimiter) {
  const s = v === null || v === undefined ? '' : String(v);
  if (s.includes('"') || s.includes('\n') || s.includes('\r') || s.includes(delimiter)) {
    return '"' + s.replace(/"/g, '""') + '"';
  }
  return s;
}

/** Serialize rows (arrays) to CSV. Default CRLF (Excel-friendly); pass eol = '\n' for LF files (the DAT template uses LF). */
export function toDelimited(rows, delimiter = ',', eol = '\r\n') {
  return rows.map(r => r.map(v => escapeField(v, delimiter)).join(delimiter)).join(eol) + eol;
}

/** Turn parsed rows into objects keyed by header text. */
export function rowsToObjects(rows) {
  if (!rows.length) return [];
  const header = rows[0].map(h => String(h).trim());
  return rows.slice(1)
    .filter(r => r.some(c => String(c).trim() !== ''))
    .map(r => {
      const o = {};
      header.forEach((h, idx) => { o[h] = r[idx] ?? ''; });
      return o;
    });
}
