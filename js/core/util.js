// Shared helpers. Ported from the helper functions in Excel v3 / Outlook v3 VBA.
// No DOM or browser APIs here so every function can be unit-tested in Node.

export const PI_VBA = 3.14159265358979; // constant used in CalculateDistanceMiles

/** NormalizeText: LCase(Trim(CStr(value))) */
export function normalizeText(value) {
  return String(value ?? '').trim().toLowerCase();
}

/**
 * NormalizeZip: keep digits only, truncate to 5, left-pad to 5.
 * NOTE (documented deviation): the VBA loops over Len(Trim$(value)) but indexes the
 * untrimmed string, so a leading space silently drops the last digit. We trim first.
 */
export function normalizeZip(value) {
  const digits = String(value ?? '').trim().replace(/[^0-9]/g, '');
  if (digits.length === 0) return '';
  return digits.slice(0, 5).padStart(5, '0');
}

/** NormalizeForMatching (Outlook): lowercase, punctuation -> space, collapse spaces. */
export function normalizeForMatching(s) {
  let t = String(s ?? '').toLowerCase();
  const chars = ['\r', '\n', '\t', ' ', ',', '.', '-', '/', '\\', ':', ';', '(', ')', '[', ']', '{', '}', '_', '?', '!', '|', '–', '—'];
  for (const c of chars) t = t.split(c).join(' ');
  return t.replace(/ {2,}/g, ' ').trim();
}

/** CanonHeader (Outlook): lowercase, strip space _ - / * */
export function canonHeader(s) {
  return String(s ?? '').trim().toLowerCase().replace(/[ _\-/*]/g, '');
}

/** IsSameCity: city text compare (case-insensitive, trimmed) AND state compare (upper, trimmed). */
export function isSameCity(c1, s1, c2, s2) {
  return normalizeText(c1) === normalizeText(c2) &&
    String(s1 ?? '').trim().toUpperCase() === String(s2 ?? '').trim().toUpperCase();
}

/** VBA Round() uses banker's rounding (round-half-to-even). */
export function vbaRound(x, digits = 0) {
  const m = Math.pow(10, digits);
  const y = x * m;
  const f = Math.floor(y);
  const diff = y - f;
  let r;
  if (Math.abs(diff - 0.5) < 1e-9) r = (f % 2 === 0) ? f : f + 1;
  else r = Math.round(y);
  return r / m;
}

/** Format$(x, "0.0") */
export function fmt1(x) {
  return (Math.round((x + Number.EPSILON) * 10) / 10).toFixed(1);
}

/** FormatCurrency(x, 0) for en-US */
export function formatCurrency0(x) {
  const r = vbaRound(Math.abs(x), 0);
  const s = '$' + r.toLocaleString('en-US');
  return x < 0 ? '(' + s + ')' : s;
}

/** CalculateDistanceMiles: haversine using the exact constants/formula from the VBA. */
export function calculateDistanceMiles(lat1, lon1, lat2, lon2) {
  const R = 3958.7613;
  const PI = PI_VBA;
  const p1 = lat1 * PI / 180, p2 = lat2 * PI / 180;
  const dp = (lat2 - lat1) * PI / 180, dl = (lon2 - lon1) * PI / 180;
  let a = Math.sin(dp / 2) ** 2 + Math.cos(p1) * Math.cos(p2) * Math.sin(dl / 2) ** 2;
  if (a < 0) a = 0; else if (a > 1) a = 1;
  if (a === 1) return R * PI;
  return R * 2 * Math.atan(Math.sqrt(a) / Math.sqrt(1 - a));
}

/** SafeNumeric */
export function safeNumeric(v) {
  if (v === null || v === undefined || v === '') return 0;
  const n = Number(typeof v === 'string' ? v.replace(/[$,\s]/g, '') : v);
  return Number.isFinite(n) ? n : 0;
}

/** SafeString */
export function safeString(v) {
  if (v === null || v === undefined) return '';
  return String(v).trim();
}

/** m/d/yyyy without zero padding (how Excel displays the parsed date in the workbook screenshots). */
export function normalizeDateString(s) {
  const m = /^(\d{1,2})\/(\d{1,2})\/(\d{4})$/.exec(String(s ?? '').trim());
  if (!m) return String(s ?? '').trim();
  return `${Number(m[1])}/${Number(m[2])}/${m[3]}`;
}

export function uid() {
  if (typeof crypto !== 'undefined' && crypto.randomUUID) return crypto.randomUUID();
  return 'id-' + Date.now().toString(36) + '-' + Math.random().toString(36).slice(2, 10);
}

const pad = (n, w = 2) => String(n).padStart(w, '0');

/** Format(Now, "yyyymmdd-hhnnss") */
export function stampForGroupId(d) {
  return `${d.getFullYear()}${pad(d.getMonth() + 1)}${pad(d.getDate())}-${pad(d.getHours())}${pad(d.getMinutes())}${pad(d.getSeconds())}`;
}

/** VBA Timer * 100 = hundredths of a second since midnight */
export function timerHundredths(d) {
  return Math.round((d.getHours() * 3600 + d.getMinutes() * 60 + d.getSeconds() + d.getMilliseconds() / 1000) * 100);
}

/** CreateLoadGroupID: "FS-" & yyyymmdd-hhnnss & "-" & Format(CLng(Timer*100),"000000") & "-R" & rowNum */
export function createLoadGroupId(now, rowNum) {
  return `FS-${stampForGroupId(now)}-${pad(timerHundredths(now), 6)}-R${rowNum}`;
}

/** m/d/yyyy h:mm AM/PM (Excel style, used for Date Added / Date Counted display). */
export function formatDateTime(d) {
  const dt = d instanceof Date ? d : new Date(d);
  if (isNaN(dt)) return '';
  let h = dt.getHours();
  const ampm = h >= 12 ? 'PM' : 'AM';
  h = h % 12; if (h === 0) h = 12;
  return `${dt.getMonth() + 1}/${dt.getDate()}/${dt.getFullYear()} ${h}:${pad(dt.getMinutes())} ${ampm}`;
}

export function todayKey(d = new Date()) {
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
}

export const CRLF = '\r\n';
