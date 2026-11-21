// Small text helpers shared by Owen's brain files (pure: no DOM, no storage).

/** Lower-case, punctuation to spaces. (The original v17 normaliser: topic keywords are matched against this.) */
export const norm = (s) => String(s || '').toLowerCase().replace(/[^a-z0-9$ ]+/g, ' ').replace(/\s+/g, ' ').trim();
/** Like norm, but apostrophes vanish instead of splitting words ("what's" -> "whats", "I'm" -> "im") and . % / - survive (for numbers and rates). */
export const ns = (s) => String(s || '').toLowerCase().replace(/['’`]/g, '').replace(/[^a-z0-9$%.\/ -]+/g, ' ').replace(/(^|\s)[.\-\/]+(?=\s|$)/g, ' ').replace(/\s+/g, ' ').trim();
export const STOP = new Set('a an the to of in on for is are do does did how can i me my we you it this that what where when why with and or at be get want need find make use'.split(' '));
export const tok = (s) => norm(s).split(' ').filter(w => w && !STOP.has(w));
export const stem = (w) => w.replace(/(ing|ed|es|s)$/, '');

/** True when a and b are the same word give or take ONE typo (a missing, extra, wrong or swapped letter). Words under 5 letters must match exactly. */
export function near(a, b) {
  if (a === b) return true;
  if (a.length < 5 || b.length < 5 || Math.abs(a.length - b.length) > 1) return false;
  if (a.length === b.length) {
    let d = 0, i = 0; for (; i < a.length; i++) if (a[i] !== b[i]) { d++; if (d > 2) return false; }
    if (d === 1) return true;
    if (d === 2) { const j = [...a].findIndex((c, k) => c !== b[k]); return a[j] === b[j + 1] && a[j + 1] === b[j] && a.slice(j + 2) === b.slice(j + 2); }
    return false;
  }
  const [s, l] = a.length < b.length ? [a, b] : [b, a];
  for (let i = 0; i < l.length; i++) if (l.slice(0, i) + l.slice(i + 1) === s) return true;
  return false;
}

export const money = (n) => (Number.isFinite(Number(n)) ? '$' + Math.round(Number(n)).toLocaleString('en-US') : '–');
export const money2 = (n) => '$' + (Math.round(Number(n) * 100) / 100).toFixed(2);
export const plural = (n, one, many) => `${n} ${n === 1 ? one : (many || one + 's')}`;
export const pct = (x, d = 0) => (Math.round(x * 10 ** (d + 2)) / 10 ** d).toFixed(d) + '%';
export const cap = (s) => String(s || '').replace(/\b[a-z]/g, c => c.toUpperCase());

/** "2h 15m", "3 days" ... */
export function span(ms) {
  const m = Math.round(ms / 60000);
  if (m < 1) return 'moments';
  if (m < 60) return m + ' min';
  const h = Math.round(m / 6) / 10;
  if (h < 36) return (Number.isInteger(h) ? h : h.toFixed(1)) + ' hr';
  const d = Math.round(h / 2.4) / 10; return (Number.isInteger(d) ? d : d.toFixed(1)) + ' days';
}
export const ago = (t, now) => { const x = typeof t === 'number' ? t : Date.parse(t); return Number.isFinite(x) ? span(Math.max(0, now - x)) + ' ago' : ''; };

const startOfDay = (d) => { const x = new Date(d); x.setHours(0, 0, 0, 0); return x; };
const weekStartMon = (d) => { const x = startOfDay(d); x.setDate(x.getDate() - ((x.getDay() + 6) % 7)); return x; };

/** A time range named in the question: { from, to, label } (ms), or null. Weeks run Monday to Sunday, like the pace tracker. */
export function rangeOf(sq, now = Date.now()) {
  const n = new Date(now); const sod = startOfDay(n);
  const day = (k) => { const a = new Date(sod); a.setDate(a.getDate() + k); return a; };
  const has = (re) => re.test(sq);
  if (has(/\byesterday\b/)) return { from: day(-1).getTime(), to: sod.getTime(), label: 'yesterday' };
  if (has(/\btoday\b|\bso far today\b/)) return { from: sod.getTime(), to: day(1).getTime(), label: 'today' };
  if (has(/\blast week\b|\bprevious week\b/)) { const a = weekStartMon(n); const b = new Date(a); b.setDate(b.getDate() - 7); return { from: b.getTime(), to: a.getTime(), label: 'last week' }; }
  if (has(/\bthis week\b|\bthe week\b|\bweekly\b/)) { const a = weekStartMon(n); const b = new Date(a); b.setDate(b.getDate() + 7); return { from: a.getTime(), to: b.getTime(), label: 'this week' }; }
  if (has(/\blast month\b|\bprevious month\b/)) return { from: new Date(n.getFullYear(), n.getMonth() - 1, 1).getTime(), to: new Date(n.getFullYear(), n.getMonth(), 1).getTime(), label: 'last month' };
  if (has(/\bthis month\b|\bmonth to date\b|\bmtd\b/)) return { from: new Date(n.getFullYear(), n.getMonth(), 1).getTime(), to: new Date(n.getFullYear(), n.getMonth() + 1, 1).getTime(), label: 'this month' };
  const m = /\b(?:last|past|previous)\s+(\d{1,3})\s+days?\b/.exec(sq);
  if (m) return { from: day(1 - Number(m[1])).getTime(), to: day(1).getTime(), label: `the last ${m[1]} days` };
  if (has(/\bpast week\b|\blast 7 days\b|\bpast 7 days\b/)) return { from: day(-6).getTime(), to: day(1).getTime(), label: 'the last 7 days' };
  if (has(/\bthis year\b|\bytd\b|\byear to date\b/)) return { from: new Date(n.getFullYear(), 0, 1).getTime(), to: new Date(n.getFullYear() + 1, 0, 1).getTime(), label: 'this year' };
  if (has(/\ball time\b|\bever\b|\blifetime\b|\boverall\b|\bin total\b|\btotal\b/)) return { from: 0, to: Infinity, label: 'all time' };
  return null;
}

/** Safe arithmetic (no eval): + - * / ^ % of, parentheses, $ and commas. Returns a number or null. */
export function evalMath(src) {
  let s = String(src || '').toLowerCase().replace(/,(?=\d{3}\b)/g, '').replace(/\$/g, '').replace(/[x×]/g, '*').replace(/÷/g, '/').replace(/\bplus\b/g, '+').replace(/\bminus\b/g, '-').replace(/\btimes\b|\bmultiplied by\b/g, '*').replace(/\bdivided by\b|\bover\b/g, '/');
  s = s.replace(/(\d+(?:\.\d+)?)\s*%\s*of\s*(\d+(?:\.\d+)?)/g, '($1/100*$2)').replace(/(\d+(?:\.\d+)?)\s*%/g, '($1/100)');
  if (!/^[\d\s+\-*/^().]+$/.test(s) || !/\d/.test(s) || !/[+\-*/^]/.test(s.replace(/^\s*-/, ''))) return null;
  const t = s.match(/\d+(?:\.\d+)?|\.\d+|[+\-*/^()]/g); if (!t) return null;
  let i = 0;
  const peek = () => t[i], next = () => t[i++];
  const prim = () => { const x = next(); if (x === undefined) throw 0; if (x === '(') { const v = add(); if (next() !== ')') throw 0; return v; } if (x === '-') return -pow(); if (x === '+') return pow(); const n = Number(x); if (!Number.isFinite(n)) throw 0; return n; };
  const pow = () => { const b = prim(); if (peek() === '^') { next(); return Math.pow(b, pow()); } return b; };
  const mul = () => { let v = pow(); while (peek() === '*' || peek() === '/') { const o = next(); const r = pow(); v = o === '*' ? v * r : v / r; } return v; };
  const add = () => { let v = mul(); while (peek() === '+' || peek() === '-') { const o = next(); const r = mul(); v = o === '+' ? v + r : v - r; } return v; };
  try { const v = add(); if (i !== t.length || !Number.isFinite(v)) return null; return v; } catch { return null; }
}
