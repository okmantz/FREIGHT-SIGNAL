// Builds dist/freight-signal.html: ONE self-contained file (JS, CSS, logo, favicon, ZIP Map embedded).
// Works by double-clicking in Chrome/Edge (file://), no server. A strict CSP with SHA-256 hashes is embedded.
// Usage: npm i && node scripts/build-single.mjs
import { build } from 'esbuild';
import fs from 'node:fs';
import path from 'node:path';
import zlib from 'node:zlib';
import crypto from 'node:crypto';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const rd = (p) => fs.readFileSync(path.join(root, p));
const sha = (s) => "'sha256-" + crypto.createHash('sha256').update(s, 'utf8').digest('base64') + "'";
const datauri = (p, mime) => `data:${mime};base64,${rd(p).toString('base64')}`;

const out = await build({ entryPoints: [path.join(root, 'js/main.js')], bundle: true, format: 'iife', write: false, minify: false, target: 'chrome110', legalComments: 'none' });
const js = out.outputFiles[0].text.replace(/<\/script/gi, '<\\/script');
// The photo backgrounds are separate .webp files, which this strict-CSP single file cannot load (img-src data: blob:).
// Drop those rules so the file has no CSP violations; scenes fall back to the theme colours (the hosted app has the photos).
const css = rd('css/app.css').toString('utf8').replace(/^[^\n{}]*\{[^{}]*url\("\.\.\/assets\/backgrounds\/[^)]*\)[^{}]*\}\s*$/gm, '');
const zipGz = zlib.gzipSync(rd('data/uszips.csv'), { level: 9 }).toString('base64');
const sample = rd('data/sample/sample-backup.json').toString('utf8');
const macroText = rd('outlook/Outlook_v5_ThisOutlookSession.txt').toString('utf8');
const embed = `globalThis.__FS_EMBEDDED_ZIP=${JSON.stringify(zipGz)};globalThis.__FS_SAMPLE=${JSON.stringify(sample)};globalThis.__FS_MACRO=${JSON.stringify(macroText)};`;

let html = rd('index.html').toString('utf8');
html = html
  .replace(/<link rel="manifest"[^>]*>\n?/, '')
  .replace('<link rel="icon" href="favicon.ico">', `<link rel="icon" href="${datauri('favicon.ico', 'image/x-icon')}">`)
  .replace('<link rel="stylesheet" href="css/app.css">', `<style>${css}</style>`)
  .replace('src="assets/logo-256.png"', `src="${datauri('assets/logo-256.png', 'image/png')}"`)
  // js/boot.js appears twice (head: before paint, body end: once #bg-art exists). Both become inline classic scripts.
  .replaceAll('<script src="js/boot.js"></script>', () => `<script>${rd('js/boot.js').toString('utf8').replace(/<\/script/gi, '<\\/script')}</script>`)
  .replace('<script type="module" src="js/main.js"></script>', `<script>${embed}</script>\n<script>${js}</script>`);
// logo-mark used on HOME is referenced from JS: inline it
const markUri = datauri('assets/logo-mark.png', 'image/png');
html = html.replace(/assets\/logo-mark\.png/g, markUri);
const body = html.replace(/assets\/logo-mark\.png/g, markUri);
const scripts = [...body.matchAll(/<script>([\s\S]*?)<\/script>/g)].map((m) => m[1]);
const style = body.match(/<style>([\s\S]*?)<\/style>/)[1];
const csp = `default-src 'none'; script-src ${scripts.map(sha).join(' ')}; style-src ${sha(style)}; img-src data: blob:; connect-src https://api.weather.gov; object-src 'none'; base-uri 'none'; form-action 'none'`;
html = body.replace(/<meta http-equiv="Content-Security-Policy"[^>]*>/, `<meta http-equiv="Content-Security-Policy" content="${csp}">`);
fs.mkdirSync(path.join(root, 'dist'), { recursive: true });
fs.writeFileSync(path.join(root, 'dist/freight-signal.html'), html);
console.log('dist/freight-signal.html', (html.length / 1048576).toFixed(2), 'MB');
