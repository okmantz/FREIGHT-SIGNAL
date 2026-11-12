// End-to-end tests in real Chromium via Playwright against a local static server.
// Run: npm i && npx playwright install chromium (or point PW_CHROME at a Chrome binary) && npm run test:e2e
import { chromium } from 'playwright';
import { startServer } from './server.mjs';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
const results = [];
const check = (name, ok, detail = '') => { results.push({ name, ok: !!ok, detail }); console.log((ok ? 'PASS ' : 'FAIL ') + name + (ok ? '' : '  -> ' + detail)); };

const { srv, url } = await startServer();
const browser = await chromium.launch(process.env.PW_CHROME ? { executablePath: process.env.PW_CHROME } : {});
const ctx = await browser.newContext({ viewport: { width: 1500, height: 900 }, acceptDownloads: true });
const page = await ctx.newPage();
const errors = []; const external = [];
page.on('console', (m) => { if (m.type() === 'error') errors.push(m.text()); });
page.on('pageerror', (e) => errors.push('pageerror: ' + e.message));
page.on('request', (r) => { if (!r.url().startsWith(url) && !r.url().startsWith('data:') && !r.url().startsWith('blob:')) external.push(r.url()); });
const go = async (tab) => { await page.goto(url + '#/' + tab); await page.waitForSelector('#nav a', { timeout: 20000 }); };
const tql = fs.readFileSync(path.join(root, 'tests/fixtures/tql-synthetic-1.txt'), 'utf8');

try {
  await go('home');
  await page.waitForSelector('.metrics');
  check('app boots; bundled ZIP Map loaded (33,782 rows)', (await page.textContent('#zipstat')).includes('33,782'));
  check('branding present', (await page.textContent('header.top')).includes('By O.K. Mantz'));

  // --- parse + review + add
  await go('board');
  await page.fill('textarea', tql);
  await page.click('text=Parse pasted loads');
  await page.waitForSelector('.modal');
  check('parse review dialog shows parsed origin', (await page.locator('.modal .field', { hasText: /^Origin city/ }).locator('input').inputValue()) === 'Chicago');
  await page.click('.modal >> text=Add to board');
  await page.waitForSelector('tbody .rowact');
  check('load added to board', (await page.locator('tbody tr').count()) === 1);

  // --- matrix
  await page.click('button:has-text("Matrix")');
  await page.waitForSelector('.modal');
  const preview = await page.textContent('.modal-body pre');
  check('matrix preview lists 3 origins + 3 destinations', /Origin C:/.test(preview) && /Destination C:/.test(preview));
  await page.click('.modal >> text=Create 9 postings');
  await page.waitForFunction(() => document.querySelectorAll('tbody tr').length === 9);
  check('matrix creates exactly 9 postings', (await page.locator('tbody tr').count()) === 9);
  check('second matrix on same group is refused', !(await page.locator('button:has-text("Matrix")').count()));

  // --- DAT
  await go('dat');
  check('DAT tab lists 9 rows', (await page.locator('table.dat tbody tr').count()) === 9);

  // --- carriers CRUD + import
  await go('carriers');
  await page.click('button:has-text("Add carrier")');
  const inputs = page.locator('.modal input');
  const labels = await page.locator('.modal .field .lbl').allTextContents();
  const fill = async (label, v) => { await page.locator('.modal .field', { hasText: new RegExp('^' + label + '$') }).locator('input').fill(v); };
  await fill('Origin City', 'Chicago'); await fill('Origin State', 'IL'); await fill('Destination City', 'Atlanta'); await fill('Destination State', 'GA');
  await fill('Carrier Name', 'E2E Carrier'); await fill('Email', 'e2e@carrier.example');
  await page.click('.modal >> text=Save');
  await page.waitForSelector('text=E2E Carrier');
  check('carrier added', true);
  await page.click('button:has-text("Import…")');
  await page.fill('.modal textarea', 'Origin City\tOrigin State\tDestination City\tDestination State\tCarrier Name\tMC/DOT\tEmail\nJoliet\tIL\tAtlanta\tGA\tImported One\t123\timp@carrier.example');
  await page.click('.modal-foot >> text=Import');
  await page.waitForSelector('text=Imported One');
  check('carrier import (header recognised)', true);

  // --- outreach drafts (never sent)
  await go('board');
  await page.locator('button:has-text("Outreach")').first().click();
  await page.waitForSelector('.modal .draft');
  const draftTxt = await page.textContent('.modal-body');
  check('outreach creates drafts for matching carriers', draftTxt.includes('e2e@carrier.example'));
  check('outreach dialog states nothing was sent', /Nothing has been sent/.test(draftTxt));
  const [dl] = await Promise.all([page.waitForEvent('download'), page.click('.modal .draft >> text=Download .eml')]);
  const emlPath = await dl.path(); const eml = fs.readFileSync(emlPath, 'utf8');
  check('.eml download is an unsent draft', eml.startsWith('X-Unsent: 1') && /^To: /m.test(eml));
  await page.click('.modal >> text=Close');
  await go('drafts');
  check('drafts persisted on Drafts tab', (await page.locator('.draft').count()) >= 1);
  const [zdl] = await Promise.all([page.waitForEvent('download'), page.click('text=Download all (.zip of .eml)')]);
  const zp = await zdl.path(); const zbuf = fs.readFileSync(zp);
  check('bulk ZIP has valid signature', zbuf.readUInt32LE(0) === 0x04034b50 && zbuf.readUInt32LE(zbuf.length - 22) === 0x06054b50);
  fs.writeFileSync('/tmp/e2e-drafts.zip', zbuf);

  // --- inquiry: process e-mail, log, approve -> carrier upsert
  await go('inquiry');
  await page.click('button:has-text("Process carrier e-mail")');
  await page.fill('.field:has-text("From") input', 'newcarrier@trucks.example');
  await page.fill('.field:has-text("Subject") input', 'Chicago, IL to Atlanta, GA');
  await page.fill('.field:has-text("Body") textarea', 'Is this still available?');
  await page.click('button:has-text("Process e-mail")');
  await page.waitForSelector('text=Result: inquiry-reply');
  check('inbound e-mail creates a reply DRAFT', (await page.textContent('.panel .draft')).includes('What is your best all-in rate'));
  await page.click('button:has-text("Log")');
  await page.waitForSelector('table.inq tbody tr');
  check('inquiry logged', (await page.textContent('table.inq')).includes('newcarrier@trucks.example'));
  await page.locator('table.inq tbody tr select').last().selectOption('Yes');
  await go('carriers');
  check('Approved = Yes adds the sender to the Carrier Database', (await page.textContent('table.carrier')).includes('newcarrier@trucks.example'));

  // --- persistence across reload
  await page.reload(); await page.waitForSelector('#nav a');
  await go('carriers');
  check('carriers survive reload (IndexedDB)', (await page.textContent('table.carrier')).includes('E2E Carrier'));
  await go('board');
  check('board survives reload', (await page.locator('tbody tr').count()) === 9);

  // --- priority propagates to group, covered removes group
  await page.locator('tbody tr').first().locator('select').nth(2).selectOption('High');
  await page.waitForTimeout(300);
  const prios = await page.locator('tbody tr').evaluateAll(trs => trs.map(t => t.querySelectorAll('select')[2].value));
  check('priority change applies to all 9 rows', prios.every(v => v === 'High'));
  const tgt = await page.locator('tbody tr').evaluateAll(trs => trs.map(t => t.lastElementChild.textContent));
  check('High priority sets target 15', tgt.every(v => v === '15'), tgt.join());

  // --- backup / restore
  await go('system');
  const [bdl] = await Promise.all([page.waitForEvent('download'), page.click('text=Download backup (.json)')]);
  const backup = JSON.parse(fs.readFileSync(await bdl.path(), 'utf8'));
  check('backup contains carriers, postings, inquiries', backup.app === 'freight-signal' && backup.data.carriers.length >= 3 && backup.data.postings.length === 9 && backup.data.inquiries.length >= 1);
  fs.writeFileSync('/tmp/e2e-backup.json', JSON.stringify(backup));

  await go('board');
  await page.locator('tbody tr').first().locator('select').nth(1).selectOption('Covered');
  await page.waitForFunction(() => !document.querySelector('tbody tr .rowact'));
  check('Covered removes the entire group', (await page.locator('tbody tr .rowact').count()) === 0);
  await go('home');
  check('Covers counter incremented', (await page.locator('.metric').nth(1).textContent()).includes('1'));

  await go('system');
  page.once('filechooser', () => {});
  const [fc] = await Promise.all([page.waitForEvent('filechooser'), page.click('text=Restore from backup…')]);
  await fc.setFiles('/tmp/e2e-backup.json');
  await page.click('.modal >> text=Replace all');
  await page.waitForSelector('text=Backup restored');
  await go('board');
  check('restore brings the 9 postings back', (await page.locator('tbody tr').count()) === 9);

  // --- malformed restore does not damage data
  fs.writeFileSync('/tmp/e2e-bad.json', JSON.stringify({ app: 'other' }));
  await go('system');
  const [fc2] = await Promise.all([page.waitForEvent('filechooser'), page.click('text=Restore from backup…')]);
  await fc2.setFiles('/tmp/e2e-bad.json');
  await page.click('.modal >> text=Replace all');
  await page.waitForSelector('text=Restore failed');
  await go('board');
  check('bad backup rejected, data intact', (await page.locator('tbody tr').count()) === 9);

  // --- markup injection is inert
  await go('carriers');
  await page.click('button:has-text("Add carrier")');
  await page.locator('.modal .field', { hasText: /^Email$/ }).locator('input').fill('x@y.example');
  await page.locator('.modal .field', { hasText: /^Carrier Name$/ }).locator('input').fill('<img src=x onerror="window.__pwned=1"><b>bold</b>');
  await page.click('.modal >> text=Save');
  await page.waitForTimeout(300);
  check('HTML in data is rendered as text, not executed', !(await page.evaluate(() => window.__pwned)) && (await page.locator('table.carrier img').count()) === 0);

  // --- ZIP map search + radius
  await go('zipmap');
  await page.fill('input[type=search]', '60601'); await page.click('button:has-text("Go")');
  await page.waitForSelector('table.zip >> text=Chicago', { timeout: 5000 }).catch(() => {});
  check('ZIP Map search by ZIP', (await page.textContent('table.zip')).includes('Chicago'));
  await page.click('button:has-text("Nearby markets")');
  await page.fill('.field:has-text("Centre ZIP") input', '60601'); await page.click('button:has-text("Go")');
  await page.waitForSelector('table.zip tbody tr td:nth-child(7)', { timeout: 5000 }).catch(() => {});
  const miles = await page.locator('table.zip tbody tr td:nth-child(7)').allTextContents();
  check('ZIP Map nearby markets within 20-60 miles', miles.length > 5 && miles.every(m => Number(m) >= 20 && Number(m) <= 60), miles.slice(0, 3).join());

  // --- theme toggle persists
  await page.click('#themebtn'); await page.waitForTimeout(400);
  check('light theme applies', (await page.getAttribute('html', 'data-theme')) === 'light');
  await page.reload(); await page.waitForSelector('#nav a');
  check('theme persists after reload', (await page.getAttribute('html', 'data-theme')) === 'light');

  // --- offline: core functions without network
  await page.waitForTimeout(800);
  await ctx.setOffline(true);
  await go('board');
  check('works with network off (board renders, data present)', (await page.locator('tbody tr').count()) === 9);
  await ctx.setOffline(false);

  check('no console/page errors during the run', errors.length === 0, errors.join(' | '));
  check('no requests left the origin (no telemetry/CDN)', external.length === 0, external.join(' | '));
} catch (e) {
  check('suite aborted by exception', false, e.message.split('\n')[0]);
  await page.screenshot({ path: '/tmp/e2e-fail.png' }).catch(() => {});
}
await browser.close(); srv.close();
const failed = results.filter(r => !r.ok);
console.log(`\n${results.length - failed.length}/${results.length} E2E checks passed`);
fs.mkdirSync(path.join(root, 'test-output'), { recursive: true });
fs.writeFileSync(path.join(root, 'test-output/e2e-results.json'), JSON.stringify({ at: new Date().toISOString(), results }, null, 1));
process.exit(failed.length ? 1 : 0);
