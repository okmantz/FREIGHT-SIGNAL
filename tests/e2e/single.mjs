// Smoke test of the single-file build opened from disk (file://), with no server.
import { chromium } from 'playwright';
import path from 'node:path';
import fs from 'node:fs';
import { fileURLToPath } from 'node:url';
const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
const file = path.join(root, 'dist/freight-signal.html');
const res = []; const check = (n, ok, d = '') => { res.push(ok); console.log((ok ? 'PASS ' : 'FAIL ') + n + (ok ? '' : ' -> ' + d)); };
const b = await chromium.launch(process.env.PW_CHROME ? { executablePath: process.env.PW_CHROME } : {});
const pg = await b.newPage({ viewport: { width: 1400, height: 850 } });
const errs = []; const ext = [];
pg.on('console', (m) => { if (m.type() === 'error') errs.push(m.text()); }); pg.on('pageerror', (e) => errs.push(e.message));
pg.on('request', (r) => { if (!r.url().startsWith('file:') && !r.url().startsWith('data:') && !r.url().startsWith('blob:') && !r.url().startsWith('https://api.weather.gov')) ext.push(r.url()); });
try {
  await pg.goto('file://' + file); await pg.waitForSelector('.metrics', { timeout: 30000 });
  check('single file boots from file://', true);
  check('embedded ZIP Map decompressed (33,782 rows)', (await pg.textContent('#zipstat')).includes('33,782'), await pg.textContent('#zipstat'));
  await pg.goto('file://' + file + '#/board');
  await pg.fill('textarea.pastebox', fs.readFileSync(path.join(root, 'tests/fixtures/tql-synthetic-1.txt'), 'utf8'));
  await pg.waitForSelector('.pastetable'); await pg.locator('.pastetable input[aria-label="originCity"]').press('Enter');
  await pg.waitForFunction(() => document.querySelectorAll('.lanebox tbody tr').length === 9, null, { timeout: 20000 });
  check('parse + matrix work in the single-file build', true);
  await pg.reload(); await pg.waitForSelector('.lanebox tbody tr');
  check('IndexedDB persists on file:// across reload', (await pg.locator('.lanebox tbody tr').count()) === 9);
  check('logo embedded', await pg.evaluate(() => document.querySelector('header img').naturalWidth > 0));
  check('no console errors / CSP violations', errs.length === 0, errs.join(' | '));
  check('no network requests', ext.length === 0, ext.join(' | '));
} catch (e) { check('aborted', false, e.message.split('\n')[0]); }
await b.close();
process.exit(res.every(Boolean) ? 0 : 1);
