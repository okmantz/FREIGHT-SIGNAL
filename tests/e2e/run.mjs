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
// First run: a brand-new browser profile must be asked for an e-mail and a password before anything else.
{ const fresh = await (await browser.newContext({ viewport: { width: 1200, height: 800 } })).newPage();
  await fresh.goto(url + '#/home'); await fresh.waitForSelector('.authgate');
  check('first launch asks to create an account (e-mail, password, confirm) before the app', (await fresh.locator('.authgate input[type=email]').count()) === 1 && (await fresh.locator('.authgate .pw input').count()) === 2 && (await fresh.locator('#nav a:visible').count()) === 0);
  await fresh.close(); }

// The only third-party request the app may make is the optional NWS alert lookup (coordinates only). Stub it so the suite is offline-safe.
const weatherCalls = [];
await ctx.route('https://api.weather.gov/**', (route) => { weatherCalls.push(route.request().url()); route.fulfill({ status: 200, contentType: 'application/geo+json', body: JSON.stringify({ features: [{ properties: { event: 'Winter Storm Warning', severity: 'Severe', status: 'Actual', headline: 'E2E test storm' } }] }) }); });
const errors = []; const external = [];
page.on('console', (m) => { if (m.type() === 'error') errors.push(m.text()); });
page.on('pageerror', (e) => errors.push('pageerror: ' + e.message));
page.on('request', (r) => { if (!r.url().startsWith(url) && !r.url().startsWith('data:') && !r.url().startsWith('blob:') && !r.url().startsWith('https://api.weather.gov/')) external.push(r.url()); });
const signUpLocal = async (pg, email, pw) => {
  await pg.fill('.authgate input[type=email]', email); await pg.fill('.authgate input[name=password]', pw); await pg.fill('.authgate input[name=confirm]', pw);
  await pg.click('.authgate button[type=submit]');
};
const go = async (tab) => {
  await page.goto(url + '#/' + tab);
  await page.waitForSelector('#nav a, .authgate', { state: 'attached', timeout: 20000 });
  if (await page.locator('.authgate').count()) { await page.click('.authgate button[type=submit]', { trial: true }).catch(() => {}); await signUpLocal(page, 'tester@example.com', 'test password 1'); }
  await page.waitForSelector('#nav a', { timeout: 20000 });
  // The first-login tour opens ~350 ms after the first render. Dismiss it once so it does not sit over every later step.
  if (!tourHandled) { tourHandled = true; if (await page.locator('.tour-layer').waitFor({ timeout: 1500 }).then(() => true).catch(() => false)) await page.click('.tour-skip'); }
};
let tourHandled = false;
// Click something that triggers a CSV download; if DAT's "incomplete postings" confirm shows up, accept it.
// System page sections are collapsible: open one before using its controls.
const openSys = async (id) => { const d = page.locator(`details[data-sect="${id}"]`); await d.waitFor(); if (!(await d.evaluate(e => e.open))) await d.locator('summary').first().click(); };
const downloadVia = async (click) => {
  const dlP = page.waitForEvent('download', { timeout: 8000 });
  await click();
  const warn = page.locator('.modal:has-text("incomplete") >> text=Download anyway');
  if (await warn.waitFor({ timeout: 700 }).then(() => true).catch(() => false)) await warn.click();
  const dl = await dlP;
  return { name: dl.suggestedFilename(), buf: fs.readFileSync(await dl.path()) };
};
const restoreBackupFile = async (file) => {
  await go('system'); await openSys('backup');
  const [fcx] = await Promise.all([page.waitForEvent('filechooser'), page.click('text=Restore from backup…')]);
  await fcx.setFiles(file);
  await page.click('.modal >> text=Replace all');
  await page.waitForSelector('text=Backup restored');
  await go('board');
};
const tpl = fs.readFileSync(path.join(root, 'tests/fixtures/DAT-bulk-upload-template.csv'), 'utf8');
const TPL_HEADER = tpl.split('\n').find(l => l.startsWith('Pickup Earliest*'));
const tql = fs.readFileSync(path.join(root, 'tests/fixtures/tql-synthetic-1.txt'), 'utf8');

try {
  await go('home');
  await page.waitForSelector('.metrics');
  check('app boots; bundled ZIP Map loaded (33,782 rows)', (await page.textContent('#zipstat')).includes('33,782'));
  check('branding present', (await page.textContent('header.top')).includes('By O.K. Mantz'));
  check('tagline in header and on HOME', (await page.textContent('header.top')).includes('Intelligent Carrier Sourcing Optimization System') && (await page.textContent('.hero')).includes('Intelligent Carrier Sourcing Optimization System'));
  check('DAT tab is gone (nav + home tile)', (await page.locator('#nav a[data-tab="dat"]').count()) === 0 && (await page.locator('.tile', { hasText: /^DAT/ }).count()) === 0);
  const vx = page.locator('.hero a', { hasText: 'Ventusky' });
  check('HOME has a Ventusky weather button that opens in a new tab', (await vx.count()) === 1 && (await vx.getAttribute('href')) === 'https://www.ventusky.com/' && (await vx.getAttribute('target')) === '_blank' && /noopener/.test(await vx.getAttribute('rel')));

  // --- paste: parsed live (no Parse button), editable inline, Enter / button adds, 3x3 builds itself
  await go('board');
  await page.fill('textarea.pastebox', tql);
  await page.waitForSelector('.pastetable');
  check('pasted load is parsed live and shown as an editable row', (await page.locator('.pastetable tbody tr').count()) === 1 && (await page.locator('.pastetable input[aria-label="originCity"]').inputValue()) === 'Chicago');
  check('there is no Parse button any more', (await page.locator('text=Parse pasted loads').count()) === 0);
  await page.locator('.pastetable input[aria-label="originCity"]').press('Enter');
  await page.waitForFunction(() => document.querySelectorAll('.lanebox tbody tr').length === 9, null, { timeout: 20000 });
  check('Enter adds the load and the 3 x 3 matrix builds automatically (9 postings)', (await page.locator('.lanebox tbody tr').count()) === 9);
  check('second matrix on same group is refused', !(await page.locator('button:has-text("Build 3")').count()));

  // --- lane box + DAT CSV + rates + equipment + city->ZIP
  check('one lane box with the lane header', (await page.locator('.lanebox').count()) === 1 && /^.+, [A-Z]{2} \u2192 .+, [A-Z]{2}$/.test((await page.textContent('.lanebox h3.lane')).trim()), await page.textContent('.lanebox h3.lane'));
  check('the box holds all 9 postings labelled A-A .. C-C', (await page.locator('.lanebox tbody tr').count()) === 9 && (await page.textContent('.lanebox tbody')).includes('A-A') && (await page.textContent('.lanebox tbody')).includes('C-C'));
  // equipment is one control per load (applies to all 9)
  const eqSel = page.locator('.lanebox .loaddetails select');
  check('equipment select offers V R F SD VM RM SB', JSON.stringify((await eqSel.locator('option').allTextContents()).map(x => x.split(' ')[0])) === JSON.stringify(['V', 'R', 'F', 'SD', 'VM', 'RM', 'SB']));
  const eqLabels = (await eqSel.locator('option').allTextContents()).join('|');
  check('equipment options are named (SD, F, VM, RM)', /SD . Step Deck/.test(eqLabels) && /F . Flatbed/.test(eqLabels) && /VM . Van Team/.test(eqLabels) && /RM . Reefer Team/.test(eqLabels), eqLabels);
  await eqSel.selectOption('SD');
  await page.waitForTimeout(250);
  const eqAll = await page.evaluate(async () => (await import('/js/store/state.js')).state.postings.map(p => p.equip));
  check('equipment SD applies to every posting of the load', eqAll.length === 9 && eqAll.every(e => e === 'SD'), JSON.stringify(eqAll));
  await page.locator('.lanebox .loaddetails select').selectOption('V');

  // ONE target rate per matrix: sets every posting, posted on DAT, never a per-row field
  check('there is one target-rate field per load and a DAT rate box on each of the 9 postings', (await page.locator('.lanebox .dfield.rate input').count()) === 1 && (await page.locator('.lanebox tbody input.datrate').count()) === 9);
  const rateIn = page.locator('.lanebox .dfield.rate input');
  await rateIn.fill('$1,800'); await rateIn.press('Enter');
  await page.waitForFunction(async () => (await import('/js/store/state.js')).state.postings.every(p => String(p.targetRate) === '1800'));
  check('Target rate sets every posting in the box', true);
  // type the rate actually posted on DAT into ONE posting's DAT-rate box
  const rateBox = page.locator('.lanebox tbody tr').nth(3).locator('input.datrate');
  await rateBox.fill('2100'); await rateBox.press('Enter');
  await page.waitForFunction(async () => (await import('/js/store/state.js')).state.postings[3].datRate === '2100');
  check('a rate typed in the DAT rate box sticks to that posting only', await page.evaluate(async () => (await import('/js/store/state.js')).state.postings.filter(p => p.datRate).length) === 1);

  const grp = await downloadVia(() => page.click('[data-act="csv-group"]'));
  const gtxt = grp.buf.toString('utf8');
  const glines = gtxt.split('\n').filter(Boolean);
  check('lane CSV header matches DAT template exactly', glines[0] === TPL_HEADER, glines[0]);
  check('lane CSV has header + 9 postings, LF endings, no BOM', glines.length === 10 && !gtxt.includes('\r') && grp.buf[0] !== 0xEF && !gtxt.startsWith('\ufeff'));
  check('lane CSV file name carries the lane', /^freight-signal-dat-.+-to-.+-\d{4}-\d{2}-\d{2}\.csv$/.test(grp.name), grp.name);
  const col = (line, i) => line.split(',')[i];
  check('rated posting carries its own DAT rate and the other 8 go out blank (2 of 9 style posting)', glines.slice(1).filter(l => col(l, 11) === '2100').length === 1 && glines.slice(1).filter(l => col(l, 11) === '').length === 8 && glines.slice(1).filter(l => col(l, 11) === '1800').length === 0);
  await page.locator('.boardbar .tgl input').uncheck(); await page.waitForTimeout(200);
  const noRate = (await downloadVia(() => page.click('[data-act="csv-group"]'))).buf.toString('utf8').split('\n').filter(Boolean).slice(1);
  check('with "Post target rate on DAT" off, the typed DAT rate still posts', noRate.filter(l => col(l, 11) === '1800').length === 0 && noRate.filter(l => col(l, 11) === '2100').length === 1);
  await page.locator('.boardbar .tgl input').check(); await page.waitForTimeout(200);
  check('destination ZIP column is filled', glines.slice(1).every(l => /^\d{5}$/.test(col(l, 20))), glines[1]);

  const all = await downloadVia(() => page.click('[data-act="csv-all"]'));
  check('Download all gives the same 9 postings', all.buf.toString('utf8').split('\n').filter(Boolean).length === 10 && /^freight-signal-dat-all-/.test(all.name));

  await page.locator('.lanebox tbody tr').nth(2).locator('input[type=checkbox]').check();
  await page.waitForSelector('.selbar');
  const sel = await downloadVia(() => page.click('[data-act="csv-sel"]'));
  check('Download selected exports just the ticked posting', sel.buf.toString('utf8').split('\n').filter(Boolean).length === 2);
  await page.click('.selbar >> text=Clear');
  const one = await downloadVia(async () => { await page.locator('.lanebox tbody tr').nth(4).locator('.menu summary').click(); await page.locator('.lanebox tbody tr').nth(4).locator('[data-act="csv-one"]').click(); });
  check('single-posting CSV has header + 1 row', one.buf.toString('utf8').split('\n').filter(Boolean).length === 2);

  // city -> ZIP, driven like a real user (type, Tab)
  const r0 = () => page.locator('.lanebox tbody tr').first();
  const zipOf = async (n) => r0().locator('input.zip').nth(n).inputValue();
  const oz0 = await zipOf(0), dz0 = await zipOf(1);
  const oc = r0().locator('input[data-fk$=":originCity"]'); const oc0 = await oc.inputValue();
  await oc.fill('Joliet'); await oc.press('Tab');
  await page.waitForFunction((z) => document.querySelector('.lanebox tbody tr input.zip').value !== z, oz0);
  const oz1 = await zipOf(0);
  check('origin city change updates the ZIP automatically (Joliet)', oz1 === '60432' || (/^\d{5}$/.test(oz1) && oz1 !== oz0), oz1);
  const dc = r0().locator('input[data-fk$=":destCity"]'); const dc0 = await dc.inputValue();
  await dc.fill('Macon'); await dc.press('Tab');
  await page.waitForFunction((z) => document.querySelectorAll('.lanebox tbody tr')[0].querySelectorAll('input.zip')[1].value !== z, dz0);
  const dz1 = await zipOf(1);
  check('destination city change updates the ZIP automatically (Macon)', /^\d{5}$/.test(dz1) && dz1 !== dz0, dz1);
  await r0().locator('input[data-fk$=":originCity"]').fill(oc0); await r0().locator('input[data-fk$=":originCity"]').press('Tab');
  await page.waitForFunction((z) => document.querySelector('.lanebox tbody tr input.zip').value !== z, oz1);
  await r0().locator('input[data-fk$=":destCity"]').fill(dc0); await r0().locator('input[data-fk$=":destCity"]').press('Tab');
  await page.waitForFunction((z) => document.querySelectorAll('.lanebox tbody tr')[0].querySelectorAll('input.zip')[1].value !== z, dz1);
  check('ZIPs follow the city when it is put back', /^\d{5}$/.test(await zipOf(0)) && /^\d{5}$/.test(await zipOf(1)));

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
  await page.locator('[data-act="outreach"]').first().click();
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

  // --- priority -> target outreach, with the select focused like a real user (regression: stale display)
  const priSel = page.locator('.lanebox .laneopts select').first();
  const tgtOf = () => page.evaluate(async () => { const m = await import('/js/store/state.js'); return m.state.postings[0].outreachTarget; });
  await priSel.focus(); await priSel.selectOption('Medium');
  await page.waitForFunction(() => /Medium . 10/.test(document.querySelector('.lanebox .laneopts select').selectedOptions[0].textContent));
  check('Medium priority shows target outreach 10', (await tgtOf()) === 10);
  await page.locator('.lanebox .laneopts select').first().selectOption('High');
  await page.waitForTimeout(250);
  check('High priority shows target outreach 15', (await tgtOf()) === 15);
  await page.locator('.lanebox .laneopts select').first().selectOption('Low');
  await page.waitForTimeout(250);
  check('Low priority shows target outreach 5', (await tgtOf()) === 5);
  await page.locator('.lanebox .laneopts select').first().selectOption('High');
  await page.waitForTimeout(300);
  const stored = await page.evaluate(async () => { const m = await import('/js/store/state.js'); return m.state.postings.map(p => [p.priority, p.outreachTarget]); });
  check('priority + target stored on all 9 postings', stored.length === 9 && stored.every(([pr, t]) => pr === 'High' && t === 15), JSON.stringify(stored));

  // --- Outlook bridge (OPFS stands in for the user's Documents\FreightSignal folder)
  await go('system');
  await page.evaluate(async () => { const b = await import('/js/store/bridge.js'); await b.useHandle(await navigator.storage.getDirectory()); });
  await page.waitForSelector('[data-bridge="connected"]');
  const readFeed = (name) => page.evaluate(async (n) => { const d = await navigator.storage.getDirectory(); try { return await (await (await d.getFileHandle(n)).getFile()).text(); } catch { return null; } }, name);
  const writeFeed = (name, text) => page.evaluate(async ([n, t]) => { const d = await navigator.storage.getDirectory(); const w = await (await d.getFileHandle(n, { create: true })).createWritable(); await w.write(t); await w.close(); }, [name, text]);
  const feed = await readFeed('freight-signal-postings.tsv');
  const feedLines = feed.split('\r\n').filter(Boolean);
  check('bridge writes the postings feed (header + column row + 9 postings, ASCII)', feedLines[0].startsWith('#FREIGHT-SIGNAL-BRIDGE\tv1\t') && feedLines.length === 11 && /^[\x00-\x7f]*$/.test(feed), feedLines[0]);
  check('bridge writes config + an empty Outlook event log with header', /rateProximity\t200/.test(await readFeed('freight-signal-config.tsv')) && (await readFeed('freight-signal-inquiries.tsv')).startsWith('ConversationId\t'));
  const first = feedLines[2].split('\t'); const postingId = first[0], postingRow = first[1];
  const ev = (stage, rate, action, flag, count, ts) => ['CONV-E2E-1', ts, 'bridge-carrier@example.test', 'Modesto to Reno', postingId, postingRow, stage, rate, '1500', action, flag, count].join('\t') + '\r\n';
  const header = (await readFeed('freight-signal-inquiries.tsv'));
  await writeFeed('freight-signal-outlook-status.txt', 'macroVersion=v4\r\nlastSeen=2026-11-11 10:00:00\r\npostingsRead=9\r\nlastEvent=Inquiry reply draft created\r\n');
  await writeFeed('freight-signal-inquiries.tsv', header + ev('INQUIRY_REPLY_SENT', '', 'Inquiry reply draft created', '', 1, '2026-11-11 10:00:00'));
  const n1 = await page.evaluate(async () => (await import('/js/store/bridge.js')).pollNow());
  check('Outlook inquiry event is imported into the Inquiry Log', n1 === 1, String(n1));
  await page.evaluate(async () => (await import('/js/store/bridge.js')).pollNow());
  await writeFeed('freight-signal-inquiries.tsv', header + ev('INQUIRY_REPLY_SENT', '', 'Inquiry reply draft created', '', 1, '2026-11-11 10:00:00') + ev('RATE_RESPONSE_SENT', '1700', 'Rate $200 from target - negotiation draft created', '', 2, '2026-11-11 10:05:00'));
  await page.evaluate(async () => (await import('/js/store/bridge.js')).pollNow());
  const iq = await page.evaluate(async () => { const m = await import('/js/store/state.js'); return { q: m.state.inquiries.filter(q => q.conversationId === 'CONV-E2E-1'), cnt: m.state.postings.find(p => p.inquiryCount !== '' && p.inquiryCount !== undefined && m.state.inquiries.some(q => q.postingId === p.id && q.conversationId === 'CONV-E2E-1'))?.inquiryCount }; });
  check('re-polling is idempotent: one inquiry, updated to RATE_RESPONSE_SENT at $1700, posting count bumped once', iq.q.length === 1 && iq.q[0].stage === 'RATE_RESPONSE_SENT' && iq.q[0].lastCarrierRate === 1700 && iq.q[0].eventCount === 2 && Number(iq.cnt) >= 1, JSON.stringify(iq));
  await go('system'); await page.waitForSelector('[data-outlook="connected"]');
  check('System page shows Outlook connected', /Outlook connected/.test(await page.textContent('[data-outlook]')));
  await go('inquiry');
  check('bridge inquiry visible in the Inquiry Log', (await page.textContent('table.inq')).includes('bridge-carrier@example.test'));
  await go('board');

  // --- backup / restore
  await go('system'); await openSys('backup');
  const [bdl] = await Promise.all([page.waitForEvent('download'), page.click('text=Download backup (.json)')]);
  const backup = JSON.parse(fs.readFileSync(await bdl.path(), 'utf8'));
  check('backup contains carriers, postings, inquiries', backup.app === 'freight-signal' && backup.data.carriers.length >= 3 && backup.data.postings.length === 9 && backup.data.inquiries.length >= 1);
  fs.writeFileSync('/tmp/e2e-backup.json', JSON.stringify(backup));

  await go('board');
  await page.click('[data-act="mark-covered"]');
  await page.waitForSelector('.modal');
  check('Mark covered asks which of the 9 postings covered it', (await page.locator('.modal select option').count()) === 9);
  await page.locator('.modal select').selectOption({ index: 3 });
  await page.fill('.modal input[placeholder="Carrier name"]', 'E2E Freight');
  await page.fill('.modal input[placeholder="Carrier e-mail"]', 'e2e-driver@example.test');
  await page.fill('.modal input[placeholder="$ paid / agreed"]', '1650');
  await page.waitForFunction(() => { const q = (p) => document.querySelector(`.modal input[placeholder="${p}"]`); return q('Carrier name').value === 'E2E Freight' && q('$ paid / agreed').value === '1650'; }, null, { timeout: 5000 }).catch(() => {});
  await page.click('.modal >> text=Log cover and remove');
  await page.waitForFunction(() => !document.querySelector('tbody tr .rowmenu'));
  check('Covered removes the entire group', (await page.locator('tbody tr .rowmenu').count()) === 0);
  await go('covers');
  await page.waitForFunction(() => /E2E Freight/.test((document.querySelector('.tablewrap') || {}).textContent || ''), null, { timeout: 8000 }).catch(() => {});
  const logTxt = await page.textContent('.tablewrap') + ' || ' + JSON.stringify(await page.evaluate(async () => (await import('/js/store/state.js')).state.coverLog.map(e => e.carrier)));
  check('the cover was logged first: carrier, rate and posting position', logTxt.includes('E2E Freight') && logTxt.includes('$1,650') && /[ABC]-[ABC]/.test(logTxt), logTxt.slice(0, 200));
  check('header pace tracker shows 1 cover today', (await page.textContent('#pace')).replace(/\s+/g, ' ').includes('1today') || /1\s*today/.test(await page.textContent('#pace')));
  await go('home');
  check('Covers counter incremented', (await page.locator('.metric').nth(1).textContent()).includes('1'));

  await go('system'); await openSys('backup');
  page.once('filechooser', () => {});
  const [fc] = await Promise.all([page.waitForEvent('filechooser'), page.click('text=Restore from backup…')]);
  await fc.setFiles('/tmp/e2e-backup.json');
  await page.click('.modal >> text=Replace all');
  await page.waitForSelector('text=Backup restored');
  await go('board');
  check('restore brings the 9 postings back', (await page.locator('tbody tr').count()) === 9);

  // --- malformed restore does not damage data
  fs.writeFileSync('/tmp/e2e-bad.json', JSON.stringify({ app: 'other' }));
  await go('system'); await openSys('backup');
  const [fc2] = await Promise.all([page.waitForEvent('filechooser'), page.click('text=Restore from backup…')]);
  await fc2.setFiles('/tmp/e2e-bad.json');
  await page.click('.modal >> text=Replace all');
  await page.waitForSelector('text=Restore failed');
  await go('board');
  check('bad backup rejected, data intact', (await page.locator('tbody tr').count()) === 9);

  // --- delete: one posting, a ticked selection, a whole group; the Outlook feed follows
  await go('board');
  const feedCount = async () => (await readFeed('freight-signal-postings.tsv')).split('\r\n').filter(Boolean).length - 2;
  await page.locator('.lanebox tbody tr').nth(1).locator('.menu summary').click(); await page.locator('.lanebox tbody tr').nth(1).locator('[data-act="del-one"]').click();
  await page.click('.modal-foot >> text=Delete');
  await page.waitForFunction(() => document.querySelectorAll('.lanebox tbody tr').length === 8);
  check('delete one posting removes only that posting', true);
  let feedN = -1; for (let i = 0; i < 25 && feedN !== 8; i++) { feedN = await feedCount(); if (feedN !== 8) await page.waitForTimeout(200); }
  check('Outlook postings feed drops the deleted posting', feedN === 8, String(feedN));
  await page.locator('.lanebox tbody tr').nth(0).locator('input[type=checkbox]').check();
  await page.locator('.lanebox tbody tr').nth(1).locator('input[type=checkbox]').check();
  await page.click('[data-act="del-sel"]'); await page.click('.modal-foot >> text=Delete');
  await page.waitForFunction(() => document.querySelectorAll('.lanebox tbody tr').length === 6);
  check('delete selected removes the ticked postings', true);
  await page.click('.laneact .menu summary'); await page.click('[data-act="del-group"]'); await page.click('.modal-foot >> text=Delete');
  await page.waitForFunction(() => document.querySelectorAll('.lanebox').length === 0);
  check('delete group removes the whole box', true);
  await restoreBackupFile('/tmp/e2e-backup.json');
  await page.waitForFunction(() => document.querySelectorAll('.lanebox tbody tr').length === 9, null, { timeout: 8000 }).catch(() => {});
  check('restore after delete tests brings the 9 postings back', (await page.locator('tbody tr').count()) === 9, String(await page.locator('tbody tr').count()));

  await go('board');
  await page.waitForSelector('.lanebox .issue:has-text("Winter Storm")', { timeout: 15000 }).catch(async () => { await page.reload(); await page.waitForSelector('.lanebox .issue:has-text("Winter Storm")', { timeout: 20000 }).catch(() => {}); });
  check('weather flag appears on a load whose pickup lane has a severe alert', (await page.locator('.lanebox .issue:has-text("Winter Storm")').count()) >= 1);


  // --- v2 features: collapsible lane boxes, brokers, customers, truck check, auto-expiry, collapsible System sections
  await go('board');
  await page.click('.boardbar .menu summary'); await page.click('[data-act="collapse-all"]');
  await page.waitForFunction(() => document.querySelectorAll('.lanebox.collapsed').length >= 1 && !document.querySelector('.lanebox tbody tr'));
  check('collapse all hides the rows of every load group', (await page.locator('.lanebox tbody tr').count()) === 0);
  await page.click('.boardbar .menu summary'); await page.click('[data-act="expand-all"]');
  await page.waitForFunction(() => document.querySelectorAll('.lanebox tbody tr').length === 9);
  check('expand all brings the rows back', true);
  check('overview strip and the ranked worklist are on the Freight Signal page', (await page.locator('.ovstrip .ovtile').count()) === 4 && (await page.locator('.worklist .wl li').count()) >= 1);
  check('each load shows a next-step guidance panel', (await page.locator('.lanebox .guide').count()) >= 1);
  await page.evaluate(async () => { const m = await import('/js/store/state.js'); await m.actions.addBroker('Sam Rivers'); });
  await page.waitForSelector('.tabs .tab:has-text("Sam Rivers")');
  await page.click('.tabs .tab[data-fk="tab:Sam Rivers"]');
  await page.waitForFunction(() => document.querySelectorAll('.lanebox').length === 0);
  check('a broker tab shows only that broker\'s loads (none yet)', (await page.locator('.lanebox').count()) === 0);
  await page.click('.tabs .tab[data-fk="tab:__all"]');
  await page.waitForSelector('.lanebox', { timeout: 8000 });

  // --- v6: RateView button, collapsed copy, broker drag-and-drop, celebration, tour
  check('DAT RateView is a real button on the lane bar (not inside the menu)', (await page.locator('.lanebox [data-act="rateview"]').count()) >= 1 && (await page.locator('.lanebox .menu [data-act="rateview"]').count()) === 0);
  check('the per-posting checkboxes are the bigger size', await page.locator('.lanebox tbody input.bigchk').first().evaluate(e => e.getBoundingClientRect().width >= 20));
  await page.click('.boardbar .menu summary'); await page.click('[data-act="collapse-all"]');
  await page.waitForFunction(() => document.querySelectorAll('.lanebox.collapsed').length >= 1);
  await ctx.grantPermissions(['clipboard-read', 'clipboard-write']).catch(() => {});
  await page.locator('.lanebox.collapsed [data-act="copy-lane-details"]').first().click();
  await page.waitForTimeout(250);
  const collapsedClip = await page.evaluate(() => navigator.clipboard.readText()).catch(() => '');
  check('load details can be copied while the load is collapsed', collapsedClip.length > 30, collapsedClip.slice(0, 60));
  await page.click('.boardbar .menu summary'); await page.click('[data-act="expand-all"]');
  await page.waitForFunction(() => document.querySelectorAll('.lanebox tbody tr').length === 9);

  const tabNames = () => page.locator('.tabs .tab[data-broker]').evaluateAll(els => els.map(e => e.dataset.broker));
  await page.evaluate(async () => { const m = await import('/js/store/state.js'); await m.actions.addBroker('Pat Doe'); });
  await page.waitForSelector('.tabs .tab[data-broker="Pat Doe"]');
  const before = await tabNames();
  await page.locator('.tabs .tab[data-broker="Pat Doe"]').dragTo(page.locator('.tabs .tab[data-broker]').first());
  await page.waitForFunction(async () => (await import('/js/store/state.js')).state.settings.brokers[0] === 'Pat Doe').catch(() => {});
  const after = await tabNames();
  check('brokers can be dragged into a new order and the order is saved', after[0] === 'Pat Doe' && after.length === before.length, after.join(','));
  await page.reload(); await page.waitForSelector('#nav a');
  check('the broker order survives a reload', (await tabNames())[0] === 'Pat Doe');

  await page.evaluate(async () => { const m = await import('/js/ui/celebrate.js'); m.celebrate({ week: 50, floor: 50 }); });
  await page.waitForSelector('.goal-banner.in', { timeout: 4000 });
  check('hitting the weekly goal shows the banner and a confetti canvas', (await page.locator('#confetti').count()) === 1 && /50/.test(await page.locator('.goal-banner').innerText()));
  await page.waitForSelector('#confetti', { state: 'detached', timeout: 9000 }).catch(() => {});
  check('the confetti cleans itself up and never blocks clicks', (await page.locator('#confetti').count()) === 0);

  await page.evaluate(async () => { const m = await import('/js/ui/tour.js'); m.startTour({ from: 0 }); });
  await page.waitForSelector('.tour-card', { timeout: 5000 });
  const stepsTotal = await page.evaluate(async () => (await import('/js/core/tourSteps.js')).TOUR_STEPS.length);
  check('the guided tour opens with a card and a skip link', (await page.locator('.tour-skip').count()) === 1 && stepsTotal >= 7 && stepsTotal <= 10);
  await page.keyboard.press('ArrowRight'); await page.waitForTimeout(500);
  check('the tour moves to the next step with the arrow key', /2/.test(await page.locator('.tour-count').innerText()));
  await page.keyboard.press('Escape');
  await page.waitForSelector('.tour-layer', { state: 'detached', timeout: 4000 });
  check('Escape closes the tour', (await page.locator('.tour-layer').count()) === 0);

  // --- v7: SB equipment, native checkboxes, DAT-average strip, Find more carriers, priority frame, Home tour card
  await go('board'); await page.click('.tabs .tab[data-fk="tab:__all"]'); await page.waitForSelector('.lanebox tbody tr');
  check('Straight Box Truck (SB) is in the equipment list', (await page.locator('.lanebox .loaddetails select option[value="SB"]').count()) >= 1);
  const cbOk = await page.waitForFunction(() => { const e = document.querySelector('.lanebox tbody input.bigchk'); if (!e || !e.isConnected) return false; const c = getComputedStyle(e); return c.appearance === 'none' && parseFloat(c.borderTopLeftRadius) >= 5; }, null, { timeout: 4000 }).then(() => true).catch(() => false);
  check('checkboxes use the app\'s own look (custom, rounded) instead of the browser default', cbOk);
  await page.locator('.lanebox tbody input.bigchk').first().check();
  check('a ticked checkbox fills with the accent', await page.waitForFunction(() => { const e = document.querySelector('.lanebox tbody input.bigchk:checked'); return !!e && getComputedStyle(e).backgroundImage.includes('gradient'); }, null, { timeout: 4000 }).then(() => true).catch(() => false));
  await page.locator('.lanebox tbody input.bigchk').first().uncheck();
  check('the switches (lane scan, toggles) are not turned into checkboxes', await page.waitForFunction(() => { const e = document.querySelector('.lanebox input[role="switch"]'); return !!e && e.isConnected && parseFloat(getComputedStyle(e).width) > 28; }, null, { timeout: 4000 }).then(() => true).catch(() => false));

  const avgIn = page.locator('.lanebox .suggest input.sgin').first();
  check('each matrix has a DAT avg strip at the top', (await page.locator('.lanebox .suggest').count()) === (await page.locator('.lanebox').count()) && (await page.locator('.lanebox .suggest [data-act="rateview-strip"]').count()) >= 1);
  await avgIn.fill('2150'); await avgIn.press('Enter');
  await page.waitForFunction(async () => { const st = (await import('/js/store/state.js')).state; return st.postings.length && st.postings.filter(p => p.datAvg === '2150').length === st.postings.length; });
  check('the DAT avg is kept on every posting of the load and shows $/mile', /\$\d+\.\d\d\/mi/.test(await page.locator('.lanebox .suggest .sg-note').first().innerText()));
  if (await page.locator('.lanebox [data-act="use-dat-avg"]').count()) { await page.locator('.lanebox [data-act="use-dat-avg"]').first().click(); await page.waitForFunction(async () => (await import('/js/store/state.js')).state.postings.every(p => String(p.targetRate) === '2150')); }
  check('Use as target copies the DAT avg into the target rate', await page.evaluate(async () => (await import('/js/store/state.js')).state.postings.every(p => String(p.targetRate) === '2150')));

  await page.evaluate(() => { window.__opened = []; window.open = (u) => { window.__opened.push(u); return {}; }; });
  await page.locator('.lanebox [data-act="find-carriers"]').first().click();
  await page.waitForFunction(() => window.__opened.length === 1);
  const opened = await page.evaluate(() => window.__opened[0]);
  check('Find more carriers opens DAT Find Trucks', /^https:\/\/one\.dat\.com\//.test(opened), opened);
  const clipLane = await page.evaluate(() => navigator.clipboard.readText()).catch(() => '');
  check('the load\'s origin is on the clipboard for the search form', /,\s*[A-Z]{2}$/.test(clipLane.trim()), clipLane);

  const stripe = await page.locator('.lanebox').first().evaluate(e => getComputedStyle(e).borderTopColor);
  check('the matrix frame is a single hairline (not a thick coloured border)', parseFloat(await page.locator('.lanebox').first().evaluate(e => getComputedStyle(e).borderLeftWidth)) <= 1.01, stripe);
  await page.click('.boardbar .menu summary'); await page.click('[data-act="collapse-all"]');
  await page.waitForFunction(() => document.querySelectorAll('.lanebox.collapsed').length >= 1);
  const wash = await page.locator('.lanebox.collapsed').first().evaluate(e => getComputedStyle(e).backgroundImage);
  check('a collapsed load keeps its priority colour as a gradient', wash.includes('gradient'), wash.slice(0, 60));
  await page.click('.boardbar .menu summary'); await page.click('[data-act="expand-all"]');
  await page.waitForFunction(() => document.querySelectorAll('.lanebox tbody tr').length === 9);

  await go('home');
  check('the 60-second tour is a clear card on the Home page and starts the tour', (await page.locator('.tourcard [data-act="take-tour-card"]').count()) === 1);
  await page.click('.tourcard [data-act="take-tour-card"]'); await page.waitForSelector('.tour-card', { timeout: 5000 });
  await page.keyboard.press('Escape'); await page.waitForSelector('.tour-layer', { state: 'detached' });
  await go('board'); await page.click('.tabs .tab[data-fk="tab:__all"]'); await page.waitForSelector('.lanebox', { timeout: 8000 });
  await go('board'); await page.click('.tabs .tab[data-fk="tab:__all"]'); await page.waitForSelector('.lanebox', { timeout: 8000 });
  check('the All tab shows everything and offers the whole-board CSV', (await page.locator('.lanebox').count()) >= 1 && (await page.locator('[data-act="csv-all"]').count()) === 1);

  await go('customers');
  await page.click('text=Import…');
  await page.fill('.modal textarea', 'Company\tContact Name\tTitle\tEmail\tPhone\nAcme Foods\tPat Lee\tLogistics\tpat@acme.example\t555-0100\nBolt Steel\tDana Fox\tBuyer\tdana@bolt.example\t555-0101');
  await page.click('.modal-foot >> text=Import');
  await page.waitForSelector('td:has-text("Acme Foods")');
  check('customer database imports pasted rows like the carrier database', (await page.locator('table.carrier tbody tr').count()) === 2 && (await page.locator('.ovstrip .ovtile').first().textContent()).includes('2'));

  await go('carriers');
  await page.locator('[data-act="truck"]').first().click();
  await page.waitForSelector('.modal .draft');
  const truckDraft = await page.textContent('.modal .draft');
  check('one-click Truck? drafts "Do you have any trucks available"', /trucks available/i.test(truckDraft), truckDraft.slice(0, 160));
  await page.click('.modal >> text=Close');

  await page.evaluate(async () => {
    const m = await import('/js/store/state.js');
    window.__p = (await m.actions.addParsedLoad({ originCity: 'Reno', originState: 'NV', destCity: 'Boise', destState: 'ID', pickupEarliest: '1/2/2020', pickupLatest: '1/2/2020', equip: 'V' })).id;
    window.__n = await m.actions.expireDue();
  });
  check('auto-expiry retires a load past its pickup day into the Cover Log (Expired)', (await page.evaluate(() => window.__n)) === 1 && (await page.evaluate(async () => (await import('/js/store/state.js')).state.coverLog.some(e => e.outcome === 'Expired'))));
  await go('covers');
  check('expired loads are listed in the Cover Log and can be restored', (await page.locator('tr.o-expired button:has-text("Restore")').count()) >= 1);
  await page.locator('tr.o-expired button:has-text("Restore")').first().click();
  await page.waitForFunction(async () => (await import('/js/store/state.js')).state.postings.some(p => p.originCity === 'Reno'));
  await page.evaluate(async () => { const m = await import('/js/store/state.js'); await m.actions.deletePostings(m.state.postings.filter(p => p.originCity === 'Reno').map(p => p.id)); });

  await go('system');
  check('System sections are collapsible', (await page.locator('details.sect').count()) >= 10);
  await page.locator('details[data-sect="ladder"] > summary').click();
  await page.waitForFunction(() => document.querySelector('details[data-sect="ladder"]').open);
  check('ladder section shows percent settings and editable e-mail wording', (await page.locator('details[data-sect="ladder"] textarea').count()) === 3 && /Book it within/.test(await page.textContent('details[data-sect="ladder"]')));
  await page.waitForTimeout(600);
  await page.reload(); await page.waitForSelector('details.sect');
  check('open/closed state of a System section is remembered', await page.locator('details[data-sect="ladder"]').evaluate(e => e.open));
  check('Outlook guide is step by step', (await page.locator('details[data-sect="outlook"] .gstep2').count()) >= 8);
  await go('board');
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
  const themeNow = await page.getAttribute('html', 'data-theme'); check('light theme applies', themeNow === 'light', 'data-theme=' + themeNow);
  await page.reload(); await page.waitForSelector('#nav a');
  check('theme persists after reload', (await page.getAttribute('html', 'data-theme')) === 'light');

  // --- Account Settings + copy original load details
  await ctx.grantPermissions(['clipboard-read', 'clipboard-write']).catch(() => {});
  await go('board');
  await page.click('[data-act="copy-lane-details"]'); await page.waitForTimeout(300);
  const clip = await page.evaluate(() => navigator.clipboard.readText()).catch(() => '');
  check('Copy load details puts the original TQL text on the clipboard', /Pickup:/i.test(clip) && clip.length > 40, clip.slice(0, 60));
  await go('account');
  check('Account Settings page renders with every section collapsed', (await page.locator('details.set-card').count()) >= 6 && (await page.locator('details.set-card[open]').count()) === 0);
  for (const id of ['theme', 'background']) await page.click(`#acct-${id} > summary`);
  await page.click('.skin-tile:has-text("Obsidian Gold")'); await page.click('.bg-tile:has-text("Sakura Reverie")'); await page.click('.swatch[title="Violet"]');
  await page.waitForTimeout(500);
  const sk = await page.getAttribute('html', 'data-skin'), bgv = await page.getAttribute('html', 'data-bg'); check('skin + background apply live', sk === 'obsidian-gold' && bgv === 'sakura-reverie', sk + ' / ' + bgv);
  await page.waitForTimeout(500); await page.reload(); await page.waitForSelector('#nav a');
  check('skin + background persist after reload', (await page.getAttribute('html', 'data-skin')) === 'obsidian-gold' && (await page.getAttribute('html', 'data-bg')) === 'sakura-reverie');

  // --- local accounts: keep signed in, sign out, wrong password, sign back in, a second person on the same computer
  await go('account');
  await page.click('#acct-signin > summary');
  check('Account Settings shows the signed-in e-mail', (await page.textContent('#acct-signin')).includes('tester@example.com'));
  await page.reload(); await page.waitForSelector('#nav a');
  check('kept signed in: no gate after a reload', (await page.locator('.authgate').count()) === 0);
  await page.click('#signoutbtn'); await page.waitForSelector('.authgate');
  check('signing out shows the sign-in form', (await page.locator('.authgate [data-act="tab-signin"][aria-pressed="true"]').count()) === 1);
  await page.fill('.authgate input[type=email]', 'tester@example.com'); await page.fill('.authgate .pw input', 'wrong password!');
  await page.click('.authgate button[type=submit]');
  await page.waitForFunction(() => /do not match/i.test(document.querySelector('.authgate .autherr').textContent));
  check('a wrong password is refused and the app stays locked', (await page.locator('#nav a:visible').count()) === 0);
  await page.fill('.authgate .pw input', 'test password 1'); await page.click('.authgate button[type=submit]');
  await page.waitForSelector('#nav a');
  check('the right password opens the app again', (await page.locator('.authgate').count()) === 0);

  // --- offline: core functions without network
  await page.waitForTimeout(800);
  await ctx.setOffline(true);
  await go('board');
  check('works with network off (board renders, data present)', (await page.locator('tbody tr').count()) === 9);
  await ctx.setOffline(false);

  check('no console/page errors during the run', errors.length === 0, errors.join(' | '));
  check('the only outside request is the optional weather lookup, and it carries coordinates only', weatherCalls.length > 0 && weatherCalls.every(u => /^https:\/\/api\.weather\.gov\/alerts\/active\?[^#]*point=-?\d+\.\d+%2C-?\d+\.\d+$/.test(u)), weatherCalls.slice(0, 2).join(' | '));
  check('no requests left the origin (no telemetry/CDN)', external.length === 0, external.join(' | '));
} catch (e) {
  check('suite aborted by exception', false, e.message.split('\n')[0]); console.log(String(e.stack).split('\n').filter(l => l.includes('run.mjs')).slice(0, 3).join('\n'));
  await page.screenshot({ path: '/tmp/e2e-fail.png' }).catch(() => {});
}
await browser.close(); srv.close();
const failed = results.filter(r => !r.ok);
console.log(`\n${results.length - failed.length}/${results.length} E2E checks passed`);
fs.mkdirSync(path.join(root, 'test-output'), { recursive: true });
fs.writeFileSync(path.join(root, 'test-output/e2e-results.json'), JSON.stringify({ at: new Date().toISOString(), results }, null, 1));
process.exit(failed.length ? 1 : 0);
