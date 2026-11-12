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
// Click something that triggers a CSV download; if DAT's "incomplete postings" confirm shows up, accept it.
const downloadVia = async (click) => {
  const dlP = page.waitForEvent('download', { timeout: 8000 });
  await click();
  const warn = page.locator('.modal:has-text("incomplete") >> text=Download anyway');
  if (await warn.waitFor({ timeout: 700 }).then(() => true).catch(() => false)) await warn.click();
  const dl = await dlP;
  return { name: dl.suggestedFilename(), buf: fs.readFileSync(await dl.path()) };
};
const restoreBackupFile = async (file) => {
  await go('system');
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

  // --- lane box + DAT CSV + rates + equipment + city->ZIP
  check('one lane box with the lane header', (await page.locator('.lanebox').count()) === 1 && /^.+, [A-Z]{2} \u2192 .+, [A-Z]{2}$/.test((await page.textContent('.lanebox h3.lane')).trim()), await page.textContent('.lanebox h3.lane'));
  check('the box holds all 9 postings labelled A-A .. C-C', (await page.locator('.lanebox tbody tr').count()) === 9 && (await page.textContent('.lanebox tbody')).includes('A-A') && (await page.textContent('.lanebox tbody')).includes('C-C'));
  const eqLegend = await page.textContent('.legend');
  check('equipment legend lists SD, F, VM, RM', /SD = Step Deck/.test(eqLegend) && /F = Flatbed/.test(eqLegend) && /VM = Van Team/.test(eqLegend) && /RM = Reefer Team/.test(eqLegend));
  const eqSel = page.locator('.lanebox tbody tr').first().locator('select.eq');
  check('equipment select offers V R F SD VM RM', JSON.stringify(await eqSel.locator('option').allTextContents()) === JSON.stringify(['V', 'R', 'F', 'SD', 'VM', 'RM']));
  await eqSel.selectOption('SD');
  await page.waitForTimeout(250);
  check('equipment SD sticks', (await page.locator('.lanebox tbody tr').first().locator('select.eq').inputValue()) === 'SD');
  await page.locator('.lanebox tbody tr').first().locator('select.eq').selectOption('V');

  // bulk DAT rate for the whole box, then one posting with its own rate; target rate stays separate
  await page.fill('.laneact input.datrate', '$1,800');
  await page.click('[data-act="rate-all"]');
  await page.waitForFunction(() => [...document.querySelectorAll('.lanebox tbody input.datrate')].every(i => i.value === '1800'));
  check('DAT rate for all sets every posting in the box', true);
  const row3 = page.locator('.lanebox tbody tr').nth(3);
  await row3.locator('input.datrate').fill('2100'); await row3.locator('input.datrate').press('Tab');
  await page.waitForFunction(() => document.querySelectorAll('.lanebox tbody tr')[3].querySelector('input.datrate').value === '2100');
  const tgtInput = page.locator('.lanebox tbody tr').first().locator('input[placeholder="$"]').nth(1);
  await tgtInput.fill('1500'); await tgtInput.press('Tab');
  await page.waitForTimeout(250);

  const grp = await downloadVia(() => page.click('[data-act="csv-group"]'));
  const gtxt = grp.buf.toString('utf8');
  const glines = gtxt.split('\n').filter(Boolean);
  check('lane CSV header matches DAT template exactly', glines[0] === TPL_HEADER, glines[0]);
  check('lane CSV has header + 9 postings, LF endings, no BOM', glines.length === 10 && !gtxt.includes('\r') && grp.buf[0] !== 0xEF && !gtxt.startsWith('\ufeff'));
  check('lane CSV file name carries the lane', /^freight-signal-dat-.+-to-.+-\d{4}-\d{2}-\d{2}\.csv$/.test(grp.name), grp.name);
  const col = (line, i) => line.split(',')[i];
  check('DAT rates land in "DAT Loadboard Rate" (1800 x8, 2100 x1)', glines.slice(1).filter(l => col(l, 11) === '1800').length === 8 && glines.slice(1).filter(l => col(l, 11) === '2100').length === 1);
  check('target rate is NOT in the CSV', !gtxt.includes('1500'));
  check('destination ZIP column is filled', glines.slice(1).every(l => /^\d{5}$/.test(col(l, 20))), glines[1]);

  const all = await downloadVia(() => page.click('[data-act="csv-all"]'));
  check('Download all gives the same 9 postings', all.buf.toString('utf8').split('\n').filter(Boolean).length === 10 && /^freight-signal-dat-all-/.test(all.name));

  await page.locator('.lanebox tbody tr').nth(2).locator('input[type=checkbox]').check();
  await page.waitForSelector('.selbar');
  const sel = await downloadVia(() => page.click('[data-act="csv-sel"]'));
  check('Download selected exports just the ticked posting', sel.buf.toString('utf8').split('\n').filter(Boolean).length === 2);
  await page.click('.selbar >> text=Clear');
  const one = await downloadVia(() => page.locator('.lanebox tbody tr').nth(4).locator('[data-act="csv-one"]').click());
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

  // --- priority -> target outreach, with the select focused like a real user (regression: stale display)
  const priSel = page.locator('.lanehead select').first();
  const tgtPill = page.locator('.lanehead .pill.tgt');
  await priSel.focus(); await priSel.selectOption('Medium');
  await page.waitForFunction(() => /Target outreach: 10/.test(document.querySelector('.lanehead .pill.tgt').textContent));
  check('Medium priority shows target outreach 10', true);
  await page.locator('.lanehead select').first().selectOption('High');
  await page.waitForFunction(() => /Target outreach: 15/.test(document.querySelector('.lanehead .pill.tgt').textContent));
  check('High priority shows target outreach 15', true);
  await page.locator('.lanehead select').first().selectOption('Low');
  await page.waitForFunction(() => /Target outreach: 5\b/.test(document.querySelector('.lanehead .pill.tgt').textContent));
  check('Low priority shows target outreach 5', true);
  await page.locator('.lanehead select').first().selectOption('High');
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
  await go('system');
  const [bdl] = await Promise.all([page.waitForEvent('download'), page.click('text=Download backup (.json)')]);
  const backup = JSON.parse(fs.readFileSync(await bdl.path(), 'utf8'));
  check('backup contains carriers, postings, inquiries', backup.app === 'freight-signal' && backup.data.carriers.length >= 3 && backup.data.postings.length === 9 && backup.data.inquiries.length >= 1);
  fs.writeFileSync('/tmp/e2e-backup.json', JSON.stringify(backup));

  await go('board');
  await page.locator('.lanehead select[data-fk$=":status"]').first().selectOption('Covered');
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

  // --- delete: one posting, a ticked selection, a whole group; the Outlook feed follows
  await go('board');
  const feedCount = async () => (await readFeed('freight-signal-postings.tsv')).split('\r\n').filter(Boolean).length - 2;
  await page.locator('.lanebox tbody tr').nth(1).locator('[data-act="del-one"]').click();
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
  await page.click('[data-act="del-group"]'); await page.click('.modal-foot >> text=Delete');
  await page.waitForFunction(() => document.querySelectorAll('.lanebox').length === 0);
  check('delete group removes the whole box', true);
  await restoreBackupFile('/tmp/e2e-backup.json');
  await page.waitForFunction(() => document.querySelectorAll('.lanebox tbody tr').length === 9, null, { timeout: 8000 }).catch(() => {});
  check('restore after delete tests brings the 9 postings back', (await page.locator('tbody tr').count()) === 9, String(await page.locator('tbody tr').count()));

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

  // --- Account Settings + copy original load details
  await ctx.grantPermissions(['clipboard-read', 'clipboard-write']).catch(() => {});
  await go('board');
  await page.click('[data-act="copy-lane-details"]'); await page.waitForTimeout(300);
  const clip = await page.evaluate(() => navigator.clipboard.readText()).catch(() => '');
  check('Copy load details puts the original TQL text on the clipboard', /Pickup:/i.test(clip) && clip.length > 40, clip.slice(0, 60));
  await go('account');
  check('Account Settings page renders', (await page.locator('.set-card').count()) >= 5);
  await page.click('.skin-tile:has-text("Obsidian Gold")'); await page.click('.bg-tile:has-text("Sakura")'); await page.click('.swatch[title="Violet"]');
  await page.waitForTimeout(500);
  check('skin + background apply live', (await page.getAttribute('html', 'data-skin')) === 'obsidian-gold' && (await page.getAttribute('html', 'data-bg')) === 'sakura');
  await page.waitForTimeout(500); await page.reload(); await page.waitForSelector('#nav a');
  check('skin + background persist after reload', (await page.getAttribute('html', 'data-skin')) === 'obsidian-gold' && (await page.getAttribute('html', 'data-bg')) === 'sakura');

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
