// v12: pickup date on a collapsed load, sort by pickup date, and the "do not trust this rate" markers.
// Real Chromium. Run: npm run test:v12   (PW_CHROME=/path/to/chrome if Playwright's Chromium is not installed)
import { chromium } from 'playwright';
import { startServer } from './server.mjs';

const results = [];
const check = (name, ok, detail = '') => { results.push(!!ok); console.log((ok ? 'PASS ' : 'FAIL ') + name + (ok ? '' : '  -> ' + detail)); };
const { srv, url } = await startServer();
const browser = await chromium.launch(process.env.PW_CHROME ? { executablePath: process.env.PW_CHROME } : {});
const ctx = await browser.newContext({ viewport: { width: 1500, height: 1000 } });
await ctx.route('https://api.weather.gov/**', (r) => r.fulfill({ status: 200, contentType: 'application/geo+json', body: '{"features":[]}' }));
const page = await ctx.newPage(); const errors = [];
page.on('pageerror', (e) => errors.push(e.message)); page.on('console', (m) => { if (m.type() === 'error') errors.push(m.text()); });
const fmt = (d) => `${d.getMonth() + 1}/${d.getDate()}/${d.getFullYear()}`;
const plus = (n) => { const d = new Date(); d.setHours(0, 0, 0, 0); d.setDate(d.getDate() + n); return d; };

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

  // three loads added in this order: middle date, no date, earliest date
  const add = (o, d, o2, d2, date, rate) => page.evaluate(async ([oc, os, dc, ds, dt, tr]) => {
    const m = await import('/js/store/state.js');
    return (await m.actions.addParsedLoad({ originCity: oc, originState: os, originZip: '', destCity: dc, destState: ds, destZip: '', pickupEarliest: dt, pickupLatest: dt, weight: '38000', equip: 'V', details: `Pickup: ${oc}, ${os}\nDelivery: ${dc}, ${ds}\nTotal miles 715` }, { targetRate: tr })).id;
  }, [o, d, o2, d2, date, rate]);
  const idMid = await add('Chicago', 'IL', 'Atlanta', 'GA', fmt(plus(3)), '4200');
  const idNone = await add('Dallas', 'TX', 'Denver', 'CO', '', '3100');
  const idSoon = await add('Reno', 'NV', 'Boise', 'ID', fmt(plus(1)), '1500');
  await page.waitForFunction(() => document.querySelectorAll('.lanebox').length === 3, null, { timeout: 15000 });
  const order = () => page.$$eval('.lanebox h3.lane', (els) => els.map(e => e.textContent.split(',')[0]));
  check('default is board order (the order loads were added)', (await order()).join('|') === 'Chicago|Dallas|Reno', (await order()).join('|'));

  // ---- pickup date visible when collapsed
  await page.click('.boardbar .menu summary'); await page.click('[data-act="collapse-all"]');
  await page.waitForFunction(() => document.querySelectorAll('.lanebox.collapsed').length === 3);
  const peeks = await page.$$eval('.lanebox.collapsed', (els) => els.map(e => ({ lane: e.querySelector('h3.lane').textContent.split(',')[0], peek: (e.querySelector('.pkpeek') || {}).textContent || null, none: !!e.querySelector('.pkpeek.none'), vis: e.querySelector('.pkpeek') ? getComputedStyle(e.querySelector('.pkpeek')).display !== 'none' && e.querySelector('.pkpeek').getBoundingClientRect().width > 0 : false })));
  const want = (n) => plus(n).toLocaleDateString('en-US', { weekday: 'short', month: 'short', day: 'numeric' });
  const by = Object.fromEntries(peeks.map(p => [p.lane, p]));
  check('every collapsed load shows a pickup pill', peeks.length === 3 && peeks.every(p => p.peek && p.vis), JSON.stringify(peeks));
  check('the pill shows the weekday and date (Chicago, +3 days)', (by.Chicago.peek || '').includes(want(3)), by.Chicago.peek);
  check('the pill shows the date for the load that picks up tomorrow', (by.Reno.peek || '').includes(want(1)), by.Reno.peek);
  check('a load with no pickup date shows a faint dash, not a wrong date', by.Dallas.none && /—/.test(by.Dallas.peek), by.Dallas.peek);
  check('the target pill is still there next to it', (await page.locator('.lanebox.collapsed .tgtpeek').count()) === 3);
  await page.locator('.lanebox.collapsed').first().scrollIntoViewIfNeeded(); await page.screenshot({ path: process.env.V12_SHOT || '/tmp/v12-collapsed.png', clip: await page.locator('.lanebox.collapsed').first().boundingBox().then(b => ({ x: 250, y: Math.max(0, b.y - 10), width: 1250, height: Math.min(300, b.height * 3 + 40) })) }).catch(() => {});

  // ---- sort
  const sortSel = page.locator('select[data-act="sort-loads"]');
  check('the board toolbar has a sort control', (await sortSel.count()) === 1);
  await sortSel.selectOption('pickup');
  await page.waitForFunction(() => document.querySelector('.lanebox h3.lane').textContent.startsWith('Reno'));
  check('sort: pickup date, soonest first; the load with no date goes last', (await order()).join('|') === 'Reno|Chicago|Dallas', (await order()).join('|'));
  await sortSel.selectOption('pickupDesc');
  await page.waitForFunction(() => document.querySelector('.lanebox h3.lane').textContent.startsWith('Chicago'));
  check('sort: pickup date, latest first; the load with no date still goes last', (await order()).join('|') === 'Chicago|Reno|Dallas', (await order()).join('|'));
  await page.reload(); await page.waitForSelector('.lanebox');
  check('the chosen sort is remembered after a reload', (await order()).join('|') === 'Chicago|Reno|Dallas' && (await sortSel.inputValue()) === 'pickupDesc', (await order()).join('|'));
  await sortSel.selectOption('');
  await page.waitForFunction(() => document.querySelector('.lanebox h3.lane').textContent.startsWith('Chicago'));
  check('"Board order" puts them back as added', (await order()).join('|') === 'Chicago|Dallas|Reno', (await order()).join('|'));

  // ---- the $700 case in the real UI: a logged rate nobody typed must not make a $4,200 load "Ready to book"
  await page.evaluate(async ([id1, id2]) => {
    const m = await import('/js/store/state.js');
    const base = { dateCounted: new Date().toISOString(), status: 'INQUIRY', stage: 'RATE_RESPONSE_SENT', approved: 'No', eventCount: 2, flag: '' };
    await m.actions.saveInquiry({ ...base, conversationId: 'E-700', senderEmail: 'old@macro.example', subject: 'RE: Chicago to Atlanta', postingId: id1, lastCarrierRate: 700, targetRate: 4200, source: 'outlook', intent: '' });
    await m.actions.saveInquiry({ ...base, conversationId: 'E-4100', senderEmail: 'real@carrier.example', subject: 'RE: Reno to Boise', postingId: id2, lastCarrierRate: 1450, targetRate: 1500, source: 'outlook', intent: 'rate' });
  }, [idMid, idSoon]);
  await page.waitForTimeout(400); await page.evaluate(() => { location.hash = '#/inquiry'; }); await page.waitForSelector('table.inq');
  await page.evaluate(() => { location.hash = '#/board'; }); await page.waitForSelector('.lanebox');
  const status = await page.$$eval('.lanebox', (els) => Object.fromEntries(els.map(e => [e.querySelector('h3.lane').textContent.split(',')[0], e.querySelector('.lanestatus .badge').textContent.trim()])));
  check('the load with the bogus $700 is NOT "Ready to book"', status.Chicago !== 'Ready to book', JSON.stringify(status));
  check('the load with a believable v6 quote IS "Ready to book"', status.Reno === 'Ready to book', JSON.stringify(status));
  await page.locator('.lanebox', { hasText: 'Chicago' }).locator('button[data-act="toggle-box"]').click();
  await page.waitForSelector('.lanebox:not(.collapsed) .issues');
  const issues = await page.textContent('.lanebox:not(.collapsed) .issues');
  check('an expanded load explains the ignored rate instead of hiding it', /\$700/.test(issues) && /not fit|older Outlook macro/.test(issues), issues);
  await page.evaluate(() => { location.hash = '#/inquiry'; }); await page.waitForSelector('table.inq');
  const marked = await page.$$eval('td.ratecheck', (els) => els.map(e => e.textContent.trim()));
  check('the Inquiry Log marks the untrusted rate with a warning', marked.length === 1 && /700/.test(marked[0]), JSON.stringify(marked));
  check('no page errors', errors.length === 0, errors.join(' | '));
} catch (e) { check('suite aborted by exception', false, e.message); }
await browser.close(); srv.close();
console.log(`\n${results.filter(Boolean).length}/${results.length} v12 checks passed`);
process.exit(results.every(Boolean) ? 0 : 1);
