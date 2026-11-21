// v19: typed lanes ("aiken sc-fletcher ok") on the Load board, the standard load details, and the board layout.
// Real Chromium. Run: npm run test:v19   (PW_CHROME=/path/to/chrome if Playwright's Chromium is not installed)
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
const pad = (n) => String(n).padStart(2, '0');
const mdy = (d) => `${pad(d.getMonth() + 1)}/${pad(d.getDate())}/${d.getFullYear()}`;
const today = new Date();

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

  const ta = page.locator('textarea.pastebox');
  check('the paste box no longer says TQL', (await ta.getAttribute('placeholder')) === 'Paste load data here to add to board' && !/TQL/.test(await page.locator('#view').innerText()), await ta.getAttribute('placeholder'));

  // ---- typed lanes
  for (const t of ['aiken sc-fletcher ok', 'aiken sc to fletcher ok', 'Aiken south carolina to fletcher oklahoma']) {
    await ta.fill(t); await page.waitForSelector('.pastetable');
    const v = async (k) => page.locator(`.pastetable input[aria-label="${k}"]`).inputValue();
    check(`"${t}" is read as Aiken, SC to Fletcher, OK with the defaults`,
      (await v('originCity')) === 'Aiken' && (await v('originState')) === 'SC' && (await v('destCity')) === 'Fletcher' && (await v('destState')) === 'OK'
      && (await v('weight')) === '40000' && (await v('pickupEarliest')) === `${today.getMonth() + 1}/${today.getDate()}/${today.getFullYear()}`
      && (await page.locator('.pastetable select').first().inputValue()) === 'V',
      [await v('originCity'), await v('originState'), await v('destCity'), await v('destState'), await v('weight'), await v('pickupEarliest')].join('|'));
  }
  await page.locator('.pastetable input[aria-label="originCity"]').press('Enter');
  await page.waitForFunction(() => document.querySelectorAll('.lanebox tbody tr').length === 9, null, { timeout: 20000 });
  check('Enter adds the typed lane and the 3 x 3 matrix builds', (await page.locator('.lanebox tbody tr').count()) === 9);

  // ---- the saved load details
  const details = await page.evaluate(async () => { const m = await import('/js/store/state.js'); return m.state.postings.find(p => p.variant === 'Original').details; });
  const lines = details.split('\n').map(l => l.trim());
  check('load details are saved in the standard layout', lines[0] === '1 pick - 1 drop' && lines[2] === 'Pick 1' && /^Pickup: Aiken, SC \d{5}$/.test(lines[3]) && lines[4] === `Pickup Date/Time: ${mdy(today)} FCFS 08:00 to 16:00`
    && lines[6] === 'Drop 1' && lines[7] === 'Delivery: Fletcher, OK 73541' && /^Delivery Date\/Time: \d\d\/\d\d\/\d{4} FCFS 08:00 to 16:00$/.test(lines[8])
    && lines[10] === 'Weight: 40,000 lbs' && lines[11] === 'Commodity:' && lines[12] === 'Temp:' && /^Miles: \d+$/.test(lines[13]) && lines[14] === 'Trailer Type: Van' && lines[15] === 'Trailer Size: 53 ft', JSON.stringify(lines));
  const eq = await page.evaluate(async () => { const m = await import('/js/store/state.js'); const p = m.state.postings.find(x => x.variant === 'Original'); return [p.equip, p.length, p.weight]; });
  check('the load itself is a 53 ft van at 40,000 lbs', eq.join('|') === 'V|53|40000', eq.join('|'));
  await page.locator('.lanebox [data-act="copy-lane-details"]').first().click().catch(() => {});

  // ---- several lanes at once, with options
  await ta.fill('chicago il to atlanta ga\nreno nv - boise id reefer 42000 lbs');
  await page.waitForFunction(() => document.querySelectorAll('.pastetable tbody tr').length === 2);
  check('one load per line, with weight and equipment read from the line', (await page.locator('.pastetable input[aria-label="weight"]').nth(1).inputValue()) === '42000' && (await page.locator('.pastetable select').nth(1).inputValue()) === 'R');
  await ta.fill('');

  // ---- layout: overview cards, worklist and scoreboard sit between the header and the paste box
  const order = await page.evaluate(() => {
    const y = (sel) => { const e = document.querySelector(sel); return e ? e.getBoundingClientRect().top + scrollY : null; };
    return { head: y('#view .pagehead, #view header'), ov: y('.ovstrip'), paste: y('.pastepanel'), bar: y('.boardbar'), lane: y('.lanebox') };
  });
  check('Active loads / Need attention / Ready to book / Inquiries cards are above the paste box', order.ov !== null && order.paste !== null && order.ov < order.paste, JSON.stringify(order));
  check('the paste box is above the load cards', order.paste < order.lane, JSON.stringify(order));
  check('no page errors', errors.length === 0, errors.join(' | '));
} catch (e) { check('suite aborted by exception', false, e.message); }
await browser.close(); srv.close();
console.log(`\n${results.filter(Boolean).length}/${results.length} v19 checks passed`);
process.exit(results.every(Boolean) ? 0 : 1);
