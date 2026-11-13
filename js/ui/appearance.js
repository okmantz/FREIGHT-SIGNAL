// Appearance engine: interface theme (skin), light/dark/auto, accent colour, background scene, glass, density, radius,
// font and size. Everything is applied as data-attributes on <html> (the themes live in css/app.css) plus a few CSS
// custom properties set through the CSSOM, which the app's strict CSP (no inline styles) allows.
//
// Persistence: state.settings.appearance (IndexedDB, included in backups) is the source of truth. A small mirror
// in localStorage ('fs-appearance') is what js/boot.js reads before first paint, so the theme never flashes.

import { setScene } from './scenes.js';

export const MIRROR_KEY = 'fs-appearance';

export const DEFAULTS = Object.freeze({
  mode: 'dark',            // 'dark' | 'light' | 'auto'
  skin: 'signal',
  accent: 'auto',          // 'auto' = the skin's own accent | ACCENTS key | 'custom'
  accentHex: '#1ab0ee',
  bg: 'plain',             // the Clean background is the default: no scene, just the theme colours
  motion: true,            // animated scenes
  dim: 34,                 // 0..85: how much the scene is dimmed behind the content
  blur: 0,                 // 0..14 px blur on the scene art
  glass: 82,               // 40..100: panel opacity
  glassBlur: true,         // frosted-glass blur behind panels
  gradA: '#10274a', gradB: '#3a1c66', gradAngle: 150,
  image: '',               // data: URL of an uploaded background (stored in IndexedDB only)
  density: 'comfortable',  // 'compact' | 'comfortable' | 'spacious'
  radius: 'soft',          // 'sharp' | 'soft' | 'round'
  size: 'md',              // 'sm' | 'md' | 'lg'
  font: 'modern',          // 'modern' | 'humanist' | 'editorial' | 'mono'
  sidebar: 'full',         // 'full' | 'compact'
  zebra: true,             // striped table rows
  tagline: true,           // show the product tagline in the sidebar
});

/* ----------------------------------------------------------------------------------------------- catalogues */
export const SKINS = [
  { id: 'signal', label: 'Signal', blurb: 'The default. Deep navy with a clean signal blue.' },
  { id: 'midnight-azure', label: 'Midnight Azure', blurb: 'Cool midnight blues, calm and focused.' },
  { id: 'obsidian-gold', label: 'Obsidian Gold', blurb: 'Black glass with warm gold.' },
  { id: 'terminal-green', label: 'Terminal Green', blurb: 'Phosphor green on near-black.' },
  { id: 'deep-space', label: 'Deep Space', blurb: 'Indigo and violet nebula tones.' },
  { id: 'crimson-protocol', label: 'Crimson Protocol', blurb: 'A dark red command centre.' },
  { id: 'evergreen', label: 'Evergreen', blurb: 'Deep forest greens.' },
  { id: 'graphite', label: 'Graphite', blurb: 'Neutral monochrome. Quiet and minimal.' },
  { id: 'cyberpunk', label: 'Cyberpunk', blurb: 'Neon magenta and cyan.' },
  { id: 'nordic', label: 'Nordic', blurb: 'Warm parchment and walnut.' },
];

// dark = the colour used on the dark theme (bright), light = the deeper variant used on the light theme.
export const ACCENTS = [
  { id: 'signal', label: 'Signal blue', dark: '#1ab0ee', light: '#0b83c2' },
  { id: 'blue', label: 'Electric blue', dark: '#4d90ff', light: '#1d5fd6' },
  { id: 'teal', label: 'Teal', dark: '#35e0b0', light: '#0a6f54' },
  { id: 'emerald', label: 'Emerald', dark: '#35d878', light: '#107a42' },
  { id: 'violet', label: 'Violet', dark: '#9b8cff', light: '#5a4bd1' },
  { id: 'rose', label: 'Rose', dark: '#ff7ab8', light: '#b8206b' },
  { id: 'crimson', label: 'Crimson', dark: '#ff5d73', light: '#c02438' },
  { id: 'orange', label: 'Orange', dark: '#ff9a4d', light: '#b8500f' },
  { id: 'amber', label: 'Amber', dark: '#f5b83d', light: '#9a6208' },
  { id: 'gold', label: 'Gold', dark: '#e6c36a', light: '#8a6a12' },
];

// Every scene is a photo with a dark and a light version (assets/backgrounds/<id>-dark.webp / -light.webp, plus
// <id>-thumb-*.webp for the picker). fx = which canvas effect (scenes.js) moves over the photo: falling leaves on Autumn,
// snow on Winter, petals on Spring and Sakura, rain on Rainfall District and so on. group = heading in the picker.
export const BACKGROUNDS = [
  { id: 'spring', label: 'Spring', group: 'Seasons', fx: 'blossom', blurb: 'Cherry blossom over a river valley. Petals drift down.' },
  { id: 'summer', label: 'Summer', group: 'Seasons', fx: 'summernight', blurb: 'A warm lakeside night. Twinkling stars and fireflies.' },
  { id: 'autumn', label: 'Autumn', group: 'Seasons', fx: 'leaves', blurb: 'Sunset over a red-gold forest. Leaves fall.' },
  { id: 'winter', label: 'Winter', group: 'Seasons', fx: 'snow', blurb: 'A frozen alpine lake. Soft snowfall.' },
  { id: 'nordic-kingdom', label: 'Nordic Kingdom', group: 'Landscapes', fx: 'flurry', blurb: 'A fjord village at dusk. Wind-blown flurries.' },
  { id: 'sakura-reverie', label: 'Sakura Reverie', group: 'Landscapes', fx: 'sakura', blurb: 'A pagoda at sunset. Heavy blossom petals.' },
  { id: 'coastal-italy', label: 'Coastal Italy', group: 'Landscapes', fx: 'seaglint', blurb: 'A sunlit Amalfi bay. Sparkling water.' },
  { id: 'endless-sands', label: 'Endless Sands', group: 'Landscapes', fx: 'sand', blurb: 'Dunes under a low sun. Blowing sand.' },
  { id: 'misty-forest', label: 'Misty Forest', group: 'Landscapes', fx: 'mist', blurb: 'A quiet fjord forest. Slow drifting mist.' },
  { id: 'silent-sanctuary', label: 'Silent Sanctuary', group: 'Landscapes', fx: 'lanternfly', blurb: 'A lantern-lit shrine path. Fireflies and mist.' },
  { id: 'midnight-ocean', label: 'Midnight Ocean', group: 'Night & water', fx: 'moonwater', blurb: 'Moonlit water. Glittering swells and stars.' },
  { id: 'abyssal-blue', label: 'Abyssal Blue', group: 'Night & water', fx: 'bubbles', blurb: 'Light shafts and a whale. Rising bubbles.' },
  { id: 'bioluminescence', label: 'Bioluminescence', group: 'Night & water', fx: 'biolumsky', blurb: 'A glowing tide under the Milky Way.' },
  { id: 'cosmic-drift', label: 'Cosmic Drift', group: 'Night & water', fx: 'cosmos', blurb: 'A violet nebula. Twinkling stars, shooting stars.' },
  { id: 'rainfall-district', label: 'Rainfall District', group: 'Night & water', fx: 'rain', blurb: 'Neon city streets in the rain.' },
  { id: 'obsidian', label: 'Obsidian', group: 'Abstract', fx: 'sheen', blurb: 'Black glass curves. A slow light sweep.' },
  { id: 'obsidian-gold', label: 'Obsidian Gold', group: 'Abstract', fx: 'gold', blurb: 'Black marble veined with gold. Rising gold dust.' },
  { id: 'plain', label: 'Clean', group: 'Minimal & yours', fx: null, photo: false, blurb: 'No scene. Just the theme colours.' },
  { id: 'gradient', label: 'Custom gradient', group: 'Minimal & yours', fx: null, photo: false, blurb: 'Pick two colours and an angle.' },
  { id: 'image', label: 'Your image', group: 'Minimal & yours', fx: null, photo: false, blurb: 'Upload your own picture.' },
];

// Scenes that were removed when the photo set arrived: anything saved with one of these ids moves to its nearest photo.
export const LEGACY_BG = Object.freeze({ mountains: 'midnight-ocean', aurora: 'cosmic-drift', sakura: 'sakura-reverie', neural: 'cosmic-drift', grid: 'plain' });

export const DENSITIES = [['compact', 'Compact'], ['comfortable', 'Comfortable'], ['spacious', 'Spacious']];
export const RADII = [['sharp', 'Sharp'], ['soft', 'Soft'], ['round', 'Round']];
export const SIZES = [['sm', 'Small'], ['md', 'Default'], ['lg', 'Large']];
export const FONTS = [['modern', 'Modern', 'Clean system sans'], ['humanist', 'Humanist', 'Warm and friendly'], ['editorial', 'Editorial', 'Serif headings'], ['mono', 'Technical', 'Monospace everywhere']];

const oneOf = (v, list, d) => (list.includes(v) ? v : d);
const hex6 = (v, d) => { const m = /^#?([0-9a-f]{6})$/i.exec(String(v || '').trim()) || /^#?([0-9a-f]{3})$/i.exec(String(v || '').trim()); if (!m) return d; let s = m[1]; if (s.length === 3) s = s.replace(/(.)/g, '$1$1'); return '#' + s.toLowerCase(); };
const num = (v, lo, hi, d) => { const n = Number(v); return Number.isFinite(n) ? Math.max(lo, Math.min(hi, Math.round(n))) : d; };
const bool = (v, d) => (typeof v === 'boolean' ? v : d);

/** Validate anything (stored JSON, an imported file) into a complete, safe appearance object. */
export function normalize(raw) {
  const o = raw && typeof raw === 'object' ? raw : {};
  const D = DEFAULTS;
  return {
    mode: oneOf(o.mode, ['dark', 'light', 'auto'], D.mode),
    skin: oneOf(o.skin, SKINS.map(s => s.id), D.skin),
    accent: oneOf(o.accent, ['auto', 'custom', ...ACCENTS.map(a => a.id)], D.accent),
    accentHex: hex6(o.accentHex, D.accentHex),
    bg: oneOf(LEGACY_BG[o.bg] || o.bg, BACKGROUNDS.map(b => b.id), D.bg),
    motion: bool(o.motion, D.motion),
    dim: num(o.dim, 0, 85, D.dim),
    blur: num(o.blur, 0, 14, D.blur),
    glass: num(o.glass, 40, 100, D.glass),
    glassBlur: bool(o.glassBlur, D.glassBlur),
    gradA: hex6(o.gradA, D.gradA), gradB: hex6(o.gradB, D.gradB), gradAngle: num(o.gradAngle, 0, 360, D.gradAngle),
    image: typeof o.image === 'string' && o.image.startsWith('data:image/') ? o.image : '',
    density: oneOf(o.density, DENSITIES.map(x => x[0]), D.density),
    radius: oneOf(o.radius, RADII.map(x => x[0]), D.radius),
    size: oneOf(o.size, SIZES.map(x => x[0]), D.size),
    font: oneOf(o.font, FONTS.map(x => x[0]), D.font),
    sidebar: oneOf(o.sidebar, ['full', 'compact'], D.sidebar),
    zebra: bool(o.zebra, D.zebra),
    tagline: bool(o.tagline, D.tagline),
  };
}

/* ------------------------------------------------------------------------------------------------ colour maths */
const hexToRgb = (h) => { const n = parseInt(h.slice(1), 16); return [(n >> 16) & 255, (n >> 8) & 255, n & 255]; };
const rgbToHex = (c) => '#' + c.map(v => { v = Math.max(0, Math.min(255, Math.round(v))); return (v < 16 ? '0' : '') + v.toString(16); }).join('');
function rgbToHsl([r, g, b]) {
  r /= 255; g /= 255; b /= 255;
  const mx = Math.max(r, g, b), mn = Math.min(r, g, b); let h = 0, s = 0; const l = (mx + mn) / 2;
  if (mx !== mn) { const d = mx - mn; s = l > 0.5 ? d / (2 - mx - mn) : d / (mx + mn); h = mx === r ? (g - b) / d + (g < b ? 6 : 0) : mx === g ? (b - r) / d + 2 : (r - g) / d + 4; h /= 6; }
  return [h, s, l];
}
function hslToRgb([h, s, l]) {
  const f = (p, q, t) => { if (t < 0) t += 1; if (t > 1) t -= 1; if (t < 1 / 6) return p + (q - p) * 6 * t; if (t < 1 / 2) return q; if (t < 2 / 3) return p + (q - p) * (2 / 3 - t) * 6; return p; };
  if (s === 0) return [l * 255, l * 255, l * 255];
  const q = l < 0.5 ? l * (1 + s) : l + s - l * s, p = 2 * l - q;
  return [f(p, q, h + 1 / 3) * 255, f(p, q, h) * 255, f(p, q, h - 1 / 3) * 255];
}
const lum = (c) => { const x = c.map(v => { v /= 255; return v <= 0.03928 ? v / 12.92 : Math.pow((v + 0.055) / 1.055, 2.4); }); return 0.2126 * x[0] + 0.7152 * x[1] + 0.0722 * x[2]; };
const clamp = (v, a, b) => Math.max(a, Math.min(b, v));

const ratio = (a, b) => { const la = lum(a), lb = lum(b); return (Math.max(la, lb) + 0.05) / (Math.min(la, lb) + 0.05); };

/**
 * Accent custom properties for a base colour on the given resolved mode.
 *   --accent      text, borders, rings and glows on panels (bright on dark, deep on light)
 *   --btn-a/b     the filled-button gradient, with --on-btn the text colour that passes contrast on it
 */
export function accentVars(hex, mode) {
  const [h, s, l] = rgbToHsl(hexToRgb(hex));
  const main = mode === 'light' ? hslToRgb([h, Math.max(s, 0.4), clamp(l, 0.28, 0.42)]) : hslToRgb([h, Math.max(s, 0.4), clamp(l, 0.55, 0.72)]);
  const [mh, ms, ml] = rgbToHsl(main);
  const deg = mh * 360;
  let btnA = null, btnB, on = '#ffffff';
  // Warm / green hues read best as a bright button with dark text on the dark theme; everything else gets white text.
  const ink = mode !== 'light' && deg >= 35 && deg <= 190;
  if (!ink) for (let L = Math.min(ml, 0.5); L >= 0.26; L -= 0.02) { const c = hslToRgb([mh, ms, L]); if (ratio(c, [255, 255, 255]) >= 4.5) { btnA = c; break; } }
  if (btnA) btnB = hslToRgb([mh, ms, Math.max(0.12, rgbToHsl(btnA)[2] - 0.07)]);
  else { const L = Math.max(ml, 0.6); btnA = hslToRgb([mh, ms, L]); btnB = hslToRgb([mh, ms, L - 0.08]); on = '#07131c'; }
  return { '--accent': rgbToHex(main), '--accent-rgb': main.map(Math.round).join(', '), '--btn-a': rgbToHex(btnA), '--btn-b': rgbToHex(btnB), '--on-btn': on };
}

function accentFor(a, mode) {
  if (a.accent === 'auto') return null;
  if (a.accent === 'custom') return accentVars(a.accentHex, mode);
  const k = ACCENTS.find(x => x.id === a.accent);
  return k ? accentVars(mode === 'light' ? k.light : k.dark, mode) : null;
}

/* ------------------------------------------------------------------------------------------------ state */
let current = normalize(null);
let persistFn = null;
let saveTimer = 0;
const listeners = new Set();
const mq = typeof matchMedia === 'function' ? matchMedia('(prefers-color-scheme: light)') : null;

/** The last appearance written to localStorage (without the uploaded image), or null. Used when the stored settings have none. */
export function readMirror() {
  try { const m = JSON.parse(localStorage.getItem(MIRROR_KEY) || 'null'); return m && m.v === 1 && m.full ? m.full : null; } catch { return null; }
}

export const getAppearance = () => current;
export const onAppearance = (fn) => { listeners.add(fn); return () => listeners.delete(fn); };
export const resolvedMode = (a = current) => (a.mode === 'auto' ? (mq && mq.matches ? 'light' : 'dark') : a.mode);

const root = () => document.documentElement;

/** The "plain data" form js/boot.js replays before first paint. */
function buildMirror(a) {
  return {
    v: 1, auto: a.mode === 'auto', theme: resolvedMode(a),
    full: { ...a, image: '' },
    attrs: attrsFor(a),
    varsDark: { ...(accentFor(a, 'dark') || {}), ...baseVars(a) },
    varsLight: { ...(accentFor(a, 'light') || {}), ...baseVars(a, 'light') },
  };
}

function attrsFor(a) {
  return {
    'data-skin': a.skin, 'data-bg': a.bg, 'data-density': a.density, 'data-radius': a.radius, 'data-size': a.size, 'data-font': a.font,
    'data-sidebar': a.sidebar, 'data-zebra': a.zebra ? 'on' : 'off', 'data-glass': a.glassBlur ? 'blur' : 'flat', 'data-tagline': a.tagline ? 'on' : 'off',
    'data-motion': a.motion ? 'on' : 'off',
  };
}

function baseVars(a, mode = 'dark') {
  // The light photos are already pale, so the light theme needs a lighter scrim than the dark one to keep text readable.
  const dim = mode === 'light' ? Math.min(80, a.dim * 0.5 + 22) : a.dim;
  return {
    '--dim': String(dim / 100), '--bg-blur': a.blur + 'px', '--glass-a': String(a.glass / 100),
    '--grad-a': a.gradA, '--grad-b': a.gradB, '--grad-angle': a.gradAngle + 'deg',
  };
}

const APPLIED_VARS = ['--accent', '--accent-rgb', '--btn-a', '--btn-b', '--on-btn'];

export function applyAppearance(a = current) {
  const el = root(); const mode = resolvedMode(a);
  el.setAttribute('data-theme', mode);
  for (const [k, v] of Object.entries(attrsFor(a))) el.setAttribute(k, v);
  const acc = accentFor(a, mode);
  for (const k of APPLIED_VARS) { if (acc && acc[k]) el.style.setProperty(k, acc[k]); else el.style.removeProperty(k); }
  for (const [k, v] of Object.entries(baseVars(a, mode))) el.style.setProperty(k, v);
  const art = document.getElementById('bg-art'); if (art) art.className = 'bg-art art-' + a.bg;
  if (a.image) el.style.setProperty('--bg-img', 'url("' + a.image + '")'); else el.style.removeProperty('--bg-img');
  try { const m = document.querySelector('meta[name="theme-color"]'); if (m) m.setAttribute('content', getComputedStyle(el).getPropertyValue('--bg').trim() || '#070b12'); } catch { /* cosmetic */ }
  startScene(a, mode);
  try { localStorage.setItem(MIRROR_KEY, JSON.stringify(buildMirror(a))); } catch { /* storage blocked: next load simply starts from the defaults */ }
  listeners.forEach(fn => { try { fn(a); } catch (e) { console.error(e); } });
}

function startScene(a, mode) {
  const meta = BACKGROUNDS.find(b => b.id === a.bg);
  let rgb = '26, 176, 238';
  try { rgb = getComputedStyle(root()).getPropertyValue('--accent-rgb').trim() || rgb; } catch { /* keep default */ }
  setScene({ kind: meta && meta.fx, motion: a.motion, light: mode === 'light', accentRgb: rgb.split(',').map(x => Number(x) || 0) });
}

function schedulePersist() {
  clearTimeout(saveTimer);
  saveTimer = setTimeout(() => { if (persistFn) Promise.resolve(persistFn(current)).catch((e) => console.error('Could not save appearance', e)); }, 250);
}

/** Wire persistence. `read()` returns the stored object (or null), `write(obj)` saves it. */
export function initAppearance({ read, write }) {
  persistFn = write;
  let stored = null;
  try { stored = read(); } catch { /* none */ }
  if (stored) current = normalize(stored);
  applyAppearance(current);
  if (mq) {
    const onChange = () => { if (current.mode === 'auto') applyAppearance(current); };
    if (mq.addEventListener) mq.addEventListener('change', onChange); else if (mq.addListener) mq.addListener(onChange);
  }
}

/** Called when the stored settings were replaced from outside (backup restore): apply them if they differ. */
export function syncFromStore(stored) {
  // Nothing saved in the database = this browser never customised the look. Use the current defaults (this also moves people who were
  // only ever shown the old default scene, via the localStorage mirror, onto the Clean default).
  const next = normalize(stored || null);
  if (JSON.stringify(next) !== JSON.stringify(current)) { current = next; applyAppearance(current); }
}

export function setAppearance(patch) {
  current = normalize({ ...current, ...patch });
  applyAppearance(current);
  schedulePersist();
  return current;
}

export function resetAppearance() {
  current = normalize(null);
  applyAppearance(current);
  schedulePersist();
  return current;
}

export function toggleMode() {
  return setAppearance({ mode: resolvedMode() === 'light' ? 'dark' : 'light' });
}

/** Settings-file form (no uploaded image, which can be large). */
export function exportAppearance() {
  const { image, ...rest } = current; // eslint-disable-line no-unused-vars
  return { app: 'freight-signal', kind: 'appearance', version: 1, appearance: rest };
}

export function importAppearance(obj) {
  if (!obj || obj.app !== 'freight-signal' || obj.kind !== 'appearance' || typeof obj.appearance !== 'object') throw new Error('That file is not a Freight Signal appearance file.');
  return setAppearance({ ...normalize(obj.appearance), image: current.image });
}

/** Read an image file, scale it down (longest side 1920 px) and return a JPEG data URL small enough to keep in the browser. */
export function imageFileToDataUrl(file) {
  return new Promise((resolve, reject) => {
    if (!file || !/^image\//.test(file.type)) return reject(new Error('Choose an image file (JPG, PNG or WebP).'));
    if (file.size > 25 * 1048576) return reject(new Error('That image is over 25 MB. Choose a smaller one.'));
    const fr = new FileReader();
    fr.onerror = () => reject(new Error('The image could not be read.'));
    fr.onload = () => {
      const img = new Image();
      img.onerror = () => reject(new Error('That file could not be opened as an image.'));
      img.onload = () => {
        const max = 1920; const k = Math.min(1, max / Math.max(img.width, img.height));
        const c = document.createElement('canvas'); c.width = Math.max(1, Math.round(img.width * k)); c.height = Math.max(1, Math.round(img.height * k));
        c.getContext('2d').drawImage(img, 0, 0, c.width, c.height);
        let q = 0.82; let out = c.toDataURL('image/jpeg', q);
        while (out.length > 900000 && q > 0.4) { q -= 0.1; out = c.toDataURL('image/jpeg', q); }
        resolve(out);
      };
      img.src = String(fr.result);
    };
    fr.readAsDataURL(file);
  });
}
