// v11: edit load details after the matrix exists + the per-load reply note in the first reply to a carrier.
// Real Chromium. Run: npm run test:notes   (PW_CHROME=/path/to/chrome if Playwright's Chromium is not installed)
import { chromium } from 'playwright';
import { startServer } from './server.mjs';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
const tql = fs.readFileSync(path.join(root, 'tests/fixtures/tql-synthetic-1.txt'), 'utf8').replace(/11\/16\/2026/g, '11/16/' + (new Date().getFullYear() + 2));   // keep the pickup in the future so the load is not retired as expired

const results = [];
const check = (name, ok, detail = '') => { results.push(!!ok); console.log((ok ? 'PASS ' : 'FAIL ') + name + (ok ? '' : '  -> ' + detail)); };
const { srv, url } = await startServer();
const browser = await chromium.launch(process.env.PW_CHROME ? { executablePath: process.env.PW_CHROME } : {});
const ctx = await browser.newContext({ viewport: { width: 1500, height: 1000 } });
await ctx.route('https://api.weather.gov/**', (r) => r.fulfill({ status: 200, contentType: 'application/geo+json', body: '{"features":[]}' }));
const page = await ctx.newPage(); const errors = [];
page.on('pageerror', (e) => errors.push(e.message)); page.on('console', (m) => { if (m.type() === 'error') errors.push(m.text()); });
const st = (fn, arg) => page.evaluate(async ([src, a]) => { const m = await import('/js/store/state.js'); return new Function('m', 'a', 'return (' + src + ')(m, a)')(m, a); }, [fn.toString(), arg]);

try {
  await page.goto(url + '#/board');
  await page.waitForSelector('#nav a, .authgate', { state: 'attached', timeout: 20000 });
  if (await page.locator('.authgate').count()) {
    await page.fill('.authgate input[type=email]', 't@example.com'); await page.fill('.authgate input[name=password]', 'test password 1'); await page.fill('.authgate input[name=confirm]', 'test password 1');
    await page.click('.authgate button[type=submit]');
  }
  await page.waitForSelector('#nav a', { state: 'attached', timeout: 20000 });
  if (await page.locator('.tour-layer').waitFor({ timeout: 1500 }).then(() => true).catch(() => false)) await page.click('.tour-skip');

  await page.evaluate(() => { location.hash = '#/board'; });
  await page.waitForSelector('textarea.pastebox', { timeout: 20000 });
  await page.fill('textarea.pastebox', tql);
  await page.waitForSelector('.pastetable');
  await page.locator('.pastetable input[aria-label="originCity"]').press('Enter');
  await page.waitForFunction(() => document.querySelectorAll('.lanebox tbody tr').length === 9, null, { timeout: 20000 });
  check('matrix of 9 postings exists', true);

  // ---- notes: inline field on the card
  const ensureOpts = async () => { const d = page.locator('.lanebox details.moreopts').first(); if (!(await d.evaluate(e => e.open))) await d.locator('summary').click(); };   // the reply note lives under More options
  await ensureOpts();
  const noteIn = page.locator('.lanebox .dfield.note input');
  check('the load card has a Reply note field', (await noteIn.count()) === 1);
  check('a brand-new load has an EMPTY note (the macro "::" placeholder is not shown)', (await noteIn.inputValue()) === '', await noteIn.inputValue());
  await noteIn.fill('Need FMCSA sticker'); await noteIn.press('Enter');
  await page.waitForFunction(async () => (await import('/js/store/state.js')).state.postings.every(p => p.notes === 'Need FMCSA sticker'));
  check('typing a note saves it on all 9 postings', true);

  // ---- reply e-mail: pick a NEARBY posting's lane, to prove any posting of the load carries the note
  const reply = await page.evaluate(async () => {
    const m = await import('/js/store/state.js'); const { processIncomingEmail } = await import('/js/core/inbound.js');
    const o = m.state.postings.find(p => p.variant === 'Original');
    const r = processIncomingEmail({ mail: { from: 'carrier@x.example', subject: `${o.originCity}, ${o.originState} to ${o.destCity}, ${o.destState}`, body: 'Is this still available?' }, postings: m.state.postings, inquiries: [], settings: m.state.settings });
    return r.draft ? r.draft.body : r.action;
  });
  const iD = reply.indexOf('Weight'), iN = reply.indexOf('Need FMCSA sticker'), iA = reply.indexOf('What is your best all-in rate? ETA to pickup?');
  check('first reply: load details, then the note, then the ETA / rate question', iD > -1 && iN > iD && iA > iN, reply);

  // ---- edit details after the matrix is built
  await page.locator('.laneact .menu summary[aria-label="More actions for this load"]').click();
  await page.locator('.lanebox [data-act="edit-lane-details"]').click();
  const ta = page.locator('.modal textarea[aria-label="Load details"]');
  check('Edit details opens an editable details box (not read-only)', (await ta.count()) === 1 && !(await ta.evaluate(e => e.readOnly)));
  check('the box is filled with the stored details', /Pickup: Chicago/.test(await ta.inputValue()));
  const prevText = async () => page.locator('.modal pre.replyprev').textContent();
  check('preview shows details, note and the ask', /Need FMCSA sticker[\s\S]*What is your best all-in rate\?/.test(await prevText()));
  await ta.fill((await ta.inputValue()) + '\nDock hours: 8a-4p, appointment required');
  await page.locator('.modal textarea[aria-label="Reply note"]').fill('Need FMCSA sticker\nNo-touch freight');
  check('preview updates live while typing', /Dock hours[\s\S]*No-touch freight[\s\S]*What is your best/.test(await prevText()));
  await page.locator('.modal button:has-text("Save")').click();
  await page.waitForFunction(async () => (await import('/js/store/state.js')).state.postings.every(p => /Dock hours/.test(p.details) && /No-touch freight/.test(p.notes)));
  check('Save writes the edited details AND note to all 9 postings', true);
  check('the note field on the card shows the saved note', (await noteIn.inputValue()).includes('FMCSA'), await noteIn.inputValue());

  // ---- the edit survives a reshuffle and reaches the reply
  const res = await page.evaluate(async () => { const m = await import('/js/store/state.js'); const o = m.state.postings.find(p => p.variant === 'Original'); return await m.actions.reshuffleMatrix(o.id); });
  await page.waitForFunction(() => document.querySelectorAll('.lanebox tbody tr').length === 9, null, { timeout: 20000 });
  const after = await page.evaluate(async () => { const m = await import('/js/store/state.js'); return m.state.postings.map(p => [/Dock hours/.test(p.details), p.notes]); });
  check('after a reshuffle all 9 postings still carry the edited details and note', after.length === 9 && after.every(([d, n]) => d && /No-touch/.test(n)), JSON.stringify(after));

  // ---- clearing the note removes it from the reply
  await ensureOpts(); await noteIn.fill(''); await noteIn.press('Enter');
  await page.waitForFunction(async () => (await import('/js/store/state.js')).state.postings.every(p => p.notes === ''));
  const cleared = await page.evaluate(async () => {
    const m = await import('/js/store/state.js'); const { processIncomingEmail } = await import('/js/core/inbound.js');
    const o = m.state.postings.find(p => p.variant === 'Original');
    return processIncomingEmail({ mail: { from: 'c2@x.example', subject: `${o.originCity}, ${o.originState} to ${o.destCity}, ${o.destState}`, body: 'still available?' }, postings: m.state.postings, inquiries: [], settings: m.state.settings }).draft.body;
  });
  check('clearing the note removes it from the reply', !/FMCSA|No-touch/.test(cleared) && /Dock hours[\s\S]*What is your best all-in rate/.test(cleared), cleared);

  // ---- menu item and per-posting dialog still work
  await page.locator('.lanebox details.menu >> nth=-1').locator('summary').click().catch(() => {});
  check('no console/page errors', errors.length === 0, errors.join(' | '));
} catch (e) {
  check('aborted by exception', false, e.message.split('\n')[0]);
  await page.screenshot({ path: '/tmp/notes-fail.png' }).catch(() => {});
}
await browser.close(); srv.close();
console.log(`\n${results.filter(Boolean).length}/${results.length} checks passed`);
process.exit(results.every(Boolean) ? 0 : 1);
