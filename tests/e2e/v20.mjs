// v20: historical e-mail import, primary carriers, the load plan, and the effectiveness panel. Real Chromium.
// Run: npm run test:v20   (PW_CHROME=/path/to/chrome if Playwright's Chromium is not installed)
import { chromium } from 'playwright';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { startServer } from './server.mjs';
import { encodeField } from '../../js/core/bridge.js';

const results = [];
const check = (name, ok, detail = '') => { results.push(!!ok); console.log((ok ? 'PASS ' : 'FAIL ') + name + (ok ? '' : '  -> ' + detail)); };

// ---- a synthetic Outlook export: one carrier that really booked, one that only got a request, one customer rate confirmation
const ME = 'owen@tql.example', CAR = 'dispatch@swifthaul.example';
const t = (daysAgo, h, m = 0) => { const d = new Date(Date.now() - daysAgo * 86400000); d.setHours(h, m, 0, 0); const p = (n) => String(n).padStart(2, '0'); return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())} ${p(h)}:${p(m)}:00`; };
const SIG = '\n\nThanks,\nJohn Smith\nDispatcher\nSwift Haul LLC\nOffice: (312) 555-0147\nMC 123456';
let k = 0;
const row = (conv, when, dir, fromName, from, to, subject, body, att = '') => ['x' + (++k), conv, when, dir, fromName, from, to, '', '', subject, att, 'Inbox', encodeField(body)].join('\t');
const S = 'Load: Aiken, SC to Fletcher, OK';
const lines = [
  row('C1', t(3, 9), 'Sent', 'Owen', ME, CAR, S, 'Pickup: Aiken, SC\nDelivery: Fletcher, OK\nWhat is your best all-in rate?'),
  row('C1', t(3, 10), 'Received', 'John Smith', CAR, ME, 'RE: ' + S, '$2,300' + SIG),
  row('C1', t(3, 11), 'Sent', 'Owen', ME, CAR, 'RE: ' + S, 'Great, you are booked at $2,300. Please send driver and dispatch info.'),
  row('C1', t(3, 12), 'Received', 'John Smith', CAR, ME, 'RE: ' + S, 'Driver: Mike Jones\nCell: 803-555-0199\nTruck #4412'),
  row('C1', t(3, 13), 'Sent', 'Owen', ME, CAR, 'Rate Confirmation', 'Attached is the rate con, please sign and return.', 'TQL_RateConfirmation_77.pdf|'),
  row('C2', t(2, 9), 'Sent', 'Owen', ME, 'ops@ghost.example', 'Chicago, IL to Atlanta, GA', 'Please send driver and dispatch info.'),
  row('C3', t(2, 10), 'Received', 'Plant', 'shipping@bigcustomer.example', ME, 'Rate Confirmation Chicago, IL to Atlanta, GA', 'Attached is the rate confirmation.', 'RateConfirmation.pdf|'),
];
const file = path.join(fs.mkdtempSync(path.join(os.tmpdir(), 'fs-v20-')), 'freight-signal-history.tsv');
fs.writeFileSync(file, ['#FREIGHT-SIGNAL-HISTORY\tv1\treq1\t30\t' + t(0, 8) + '\t', 'MsgId\tConvId\tTime\tDir\tFromName\tFromEmail\tTo\tCc\tBcc\tSubject\tAttachments\tFolder\tBody', ...lines, '#END\t' + lines.length].join('\r\n'));

const { srv, url } = await startServer();
const browser = await chromium.launch(process.env.PW_CHROME ? { executablePath: process.env.PW_CHROME } : {});
const ctx = await browser.newContext({ viewport: { width: 1500, height: 1000 } });
await ctx.route('https://api.weather.gov/**', (r) => r.fulfill({ status: 200, contentType: 'application/geo+json', body: '{"features":[]}' }));
const page = await ctx.newPage(); const errors = [];
page.on('pageerror', (e) => errors.push(e.message)); page.on('console', (m) => { if (m.type() === 'error') errors.push(m.text()); });
const ev = (fn, arg) => page.evaluate(fn, arg);

try {
  await page.goto(url + '#/carriers');
  await page.waitForSelector('#nav a, .authgate', { state: 'attached', timeout: 20000 });
  if (await page.locator('.authgate').count()) {
    await page.fill('.authgate input[type=email]', 't@example.com'); await page.fill('.authgate input[name=password]', 'test password 1'); await page.fill('.authgate input[name=confirm]', 'test password 1').catch(() => {});
    await page.click('.authgate button[type=submit]');
  }
  await page.waitForSelector('#nav a', { state: 'attached', timeout: 20000 });
  if (await page.locator('.tour-layer').waitFor({ timeout: 1500 }).then(() => true).catch(() => false)) await page.click('.tour-skip');
  // a manually typed carrier that the history must not duplicate or overwrite
  await ev(async () => { const m = await import('/js/store/state.js'); await m.actions.saveCarrier({ carrierName: 'Swift Haul Transport', mc: 'MC 123456', email: 'owner@swifthaul.example', phone: '(999) 111-2222', status: 'Active', originCity: '', originState: '', destCity: '', destState: '', equipment: 'V', preferredPickupDates: '', rate: '', lastCovered: '', coverCount: '', lastContacted: '', responseRate: '', notes: 'typed by hand' }); });
  await page.evaluate(() => { location.hash = '#/carriers'; });
  await page.waitForSelector('[data-act="import-history"]', { timeout: 20000 });
  check('IMPORT HISTORICAL EMAILS sits on the Carrier Database toolbar', /IMPORT HISTORICAL EMAILS/.test(await page.locator('[data-act="import-history"]').innerText()));

  await page.click('[data-act="import-history"]');
  await page.waitForSelector('.hx [data-act="hx-file"]');
  check('30 and 90 day options are offered', (await page.locator('.hx-days button').count()) === 2);
  const [chooser] = await Promise.all([page.waitForEvent('filechooser'), page.click('[data-act="hx-file"]')]);
  await chooser.setFiles(file);
  await page.waitForSelector('.hx .hx-row', { timeout: 20000 });
  const rows = await page.locator('.hx .hx-row').count();
  const txt = await page.locator('.hx').innerText();
  check('only the carrier that really booked is offered (not the request-only one, not the customer)', rows === 1 && /Swift Haul/.test(txt) && !/ghost/i.test(txt.split('left out')[0] || ''), txt.slice(0, 400));
  check('it is already in the database, so it is NOT offered as a new carrier', /Already in database/.test(txt), txt.slice(0, 400));
  await page.locator('.hx [aria-label^="Import"]').check().catch(() => {});
  await page.click('.hx .hx-row >> text=Show proof');
  check('the proof lists the rate confirmation and the driver details', /Rate confirmation sent/.test(await page.locator('.hx-proof').innerText()) && /driver/i.test(await page.locator('.hx-proof').innerText()));
  await page.click('.modal-foot >> text=Import selected');
  await page.waitForSelector('.hx-ok', { timeout: 20000 });
  const st = await ev(async () => { const m = await import('/js/store/state.js'); const c = m.state.carriers.filter(x => /123456/.test(x.mc)); return { n: m.state.carriers.length, rows: c.length, phone: c[0].phone, email: c[0].email, verified: c[0].verified, notes: c[0].notes, dispatch: c[0].dispatchPhone, covers: m.state.coverLog.length, imported: m.state.coverLog.filter(e => e.imported).length, rate: (m.state.coverLog[0] || {}).rate, hist: m.state.history.length }; });
  check('no duplicate carrier was created and the typed phone and e-mail were not overwritten', st.n === 1 && st.rows === 1 && st.phone === '(999) 111-2222' && st.email === 'owner@swifthaul.example' && /typed by hand/.test(st.notes), JSON.stringify(st));
  check('verified details were added (dispatch phone, verified flag) and the booked load is in the Cover Log at its rate', st.verified === 'email' && st.dispatch === '(312) 555-0147' && st.imported === 1 && st.rate === 2300 && st.hist >= 1, JSON.stringify(st));
  const again = await ev(async () => { const m = await import('/js/store/state.js'); const before = { c: m.state.carriers.length, l: m.state.coverLog.length }; return before; });
  // import the same file a second time: nothing new may appear
  await page.keyboard.press('Escape');
  await page.click('[data-act="import-history"]');
  const [ch2] = await Promise.all([page.waitForEvent('filechooser'), page.click('[data-act="hx-file"]')]);
  await ch2.setFiles(file); await page.waitForSelector('.hx .hx-row', { timeout: 20000 });
  await page.locator('.hx [aria-label^="Import"]').check().catch(() => {});
  await page.click('.modal-foot >> text=Import selected'); await page.waitForSelector('.hx-ok', { timeout: 20000 });
  const after = await ev(async () => { const m = await import('/js/store/state.js'); return { c: m.state.carriers.length, l: m.state.coverLog.length }; });
  check('importing the same e-mails twice adds nothing', after.c === again.c && after.l === again.l, JSON.stringify({ again, after }));
  await page.keyboard.press('Escape');

  // ---- primary carriers + the plan on a posted load
  await ev(async () => { const m = await import('/js/store/state.js'); await m.actions.saveCarrier({ carrierName: 'Taylord Logistics', mc: 'MC 555001', email: 'dispatch@taylord.example', phone: '(803) 555-0100', status: 'Active', originCity: '', originState: '', destCity: '', destState: '', equipment: 'V', preferredPickupDates: '', rate: '', lastCovered: '', coverCount: '', lastContacted: '', responseRate: '', notes: '' });
    const c = m.state.carriers.find(x => x.mc === 'MC 555001'); await m.actions.saveAssignment({ carrierId: c.id, carrierName: c.carrierName, mc: c.mc, email: c.email, phone: c.phone, originState: 'SC', destState: 'GA', priority: 'primary', note: 'always takes SC to GA' }); });
  await page.evaluate(() => { location.hash = '#/board'; });
  await page.waitForSelector('textarea.pastebox', { timeout: 20000 });
  await page.locator('textarea.pastebox').fill('aiken sc to savannah ga');
  await page.waitForSelector('.pastetable'); await page.locator('.pastetable input[aria-label="originCity"]').press('Enter');
  await page.waitForFunction(() => document.querySelectorAll('.lanebox tbody tr').length === 9, null, { timeout: 20000 });
  await page.waitForSelector('[data-test="plan-strip"]', { timeout: 20000 });
  const strip = await page.locator('[data-test="plan-strip"]').innerText();
  check('the load shows its difficulty and suggests the primary carrier first', /Taylord Logistics/.test(strip) && /(EASY|MODERATE|HARD)/.test(strip) && (await page.locator('[data-act="reach-primary"]').count()) === 1, strip);
  await page.click('[data-act="reach-primary"]');
  await page.waitForSelector('.modal');
  const draft = (await page.locator('.modal').innerText()) + '\n' + (await page.locator('.modal textarea').nth(0).inputValue()) + '\n' + (await page.locator('.modal textarea').nth(1).inputValue()) + '\n' + (await page.locator('.modal input').first().inputValue());
  check('an e-mail draft and a call script are ready', /Aiken, SC to Savannah, GA/.test(draft) && /driver and dispatch/i.test(draft) && /803/.test(draft), draft.slice(0, 300));
  await page.keyboard.press('Escape');
  await page.click('[data-act="open-plan"]'); await page.waitForSelector('.pl');
  const plan = await page.locator('.pl').innerText();
  check('the plan lists actions, ranked carriers, rate intelligence and the difficulty breakdown', /Action plan/.test(plan) && /Most likely carriers/.test(plan) && /Rate intelligence/.test(plan) && /Difficulty breakdown/.test(plan), plan.slice(0, 300));
  await page.keyboard.press('Escape');

  // ---- cover it: the effectiveness numbers appear in the Cover Log
  const fx = await ev(async () => { const m = await import('/js/store/state.js'); const head = m.state.postings.find(p => p.variant === 'Original'); await m.actions.logOp(head.id, 'call', 'Taylord'); const e = await m.actions.coverGroup(head.id, { carrier: { email: 'dispatch@taylord.example', name: 'Taylord Logistics', mc: 'MC 555001' }, rate: 900 }); return e.fx; });
  check('closing a load records minutes, calls, historical/new carrier and difficulty', fx && fx.v === 1 && fx.calls === 1 && typeof fx.minutes === 'number' && fx.assistedBy === 'primary' && fx.planShown === true && typeof fx.score === 'number', JSON.stringify(fx));
  const asg = await ev(async () => { const m = await import('/js/store/state.js'); return m.state.assignments[0]; });
  check('the primary carrier is credited with the win', asg.wins === 1 && asg.hits === 1, JSON.stringify(asg));
  await page.evaluate(() => { location.hash = '#/covers'; });
  await page.waitForSelector('[data-test="perf-panel"]', { timeout: 20000 });
  const perf = await page.locator('[data-test="perf-panel"]').innerText();
  check('the Cover Log shows all eight effectiveness measures', ['Average time from load entry to cover', 'Average calls per cover', 'Average carriers contacted per cover', 'historical carriers', 'newly discovered carriers', 'Average margin improvement', 'Time saved by shared carrier intelligence', 'difficult lanes', 'easy lanes'].every(x => perf.includes(x)), perf.slice(0, 400));
  check('imported history is labelled and does not count toward this week', /from e-mail/.test(await page.locator('#view').innerText()));
  const pace = await ev(async () => { const m = await import('/js/store/state.js'); const c = await import('/js/core/coverlog.js'); return c.paceStats(m.state.coverLog, m.state.settings, new Date(), null).week; });
  check('this week\'s pace counts only the load covered here (1)', pace === 1, String(pace));
  check('no page errors', errors.length === 0, errors.join(' | '));
} catch (e) { check('run completed', false, e.stack || e.message); }
await browser.close(); srv.close();
console.log(`\n${results.filter(Boolean).length}/${results.length} v20 checks passed`);
process.exit(results.every(Boolean) ? 0 : 1);
