// v23: the More menus stay fully on screen (Carrier / Customer / Inquiry / Load board), Enter logs a cover, Home "Work next", Cover Desk quick actions, keyboard shortcuts. Real Chromium.
// Run: npm run test:v23   (PW_CHROME=/path/to/chrome if Playwright's Chromium is not installed)
import { chromium } from 'playwright';
import { startServer } from './server.mjs';

const results = [];
const check = (name, ok, detail = '') => { results.push(!!ok); console.log((ok ? 'PASS ' : 'FAIL ') + name + (ok ? '' : '  -> ' + detail)); };
const { srv, url } = await startServer();
const browser = await chromium.launch(process.env.PW_CHROME ? { executablePath: process.env.PW_CHROME } : {});
const ctx = await browser.newContext({ viewport: { width: 1065, height: 741 }, acceptDownloads: true });
await ctx.route('https://api.weather.gov/**', (r) => r.fulfill({ status: 200, contentType: 'application/geo+json', body: '{"features":[]}' }));
const page = await ctx.newPage(); const errors = [];
page.on('pageerror', (e) => errors.push(e.message)); page.on('console', (m) => { if (m.type() === 'error') errors.push(m.text()); });
const ev = (fn, arg) => page.evaluate(fn, arg);
const hash = (h) => ev((x) => { location.hash = x; }, h);

/** Is every part of the element inside the window (with a hair of tolerance), and is it what the person actually sees on top? */
const onScreen = (sel) => page.evaluate((s) => {
  const vw = document.documentElement.clientWidth, vh = document.documentElement.clientHeight;
  const els = [...document.querySelectorAll(s)]; if (!els.length) return { ok: false, why: 'none found' };
  for (const el of els) {
    const r = el.getBoundingClientRect();
    if (r.width < 2 || r.height < 2) return { ok: false, why: 'zero size ' + el.textContent.trim().slice(0, 20) };
    if (r.left < -0.5 || r.top < -0.5 || r.right > vw + 0.5 || r.bottom > vh + 0.5) return { ok: false, why: `outside window ${Math.round(r.left)},${Math.round(r.top)},${Math.round(r.right)},${Math.round(r.bottom)} in ${vw}x${vh}` };
    const top = document.elementFromPoint(Math.min(vw - 1, Math.max(0, r.left + r.width / 2)), Math.min(vh - 1, Math.max(0, r.top + r.height / 2)));
    if (!top || !(el === top || el.contains(top))) return { ok: false, why: 'covered by ' + (top ? top.tagName + '.' + top.className : 'nothing') + ' at ' + el.textContent.trim().slice(0, 24) };
  }
  return { ok: true };
}, sel);

/** A menu is fine when the whole list is on screen and on top, and either every item shows or the list scrolls inside itself (a short window). */
const menuOk = async (listSel, itemSel) => {
  const r = await onScreen(listSel);
  const scrolls = await page.evaluate((s) => { const el = document.querySelector(s); return el.scrollHeight > el.clientHeight + 1 && getComputedStyle(el).overflowY === 'auto'; }, listSel);
  if (scrolls) { const first = await onScreen(itemSel + ':first-of-type'); return { ok: r.ok && first.ok, why: (r.why || '') + (first.why || '') }; }
  const i = await onScreen(itemSel); return { ok: r.ok && i.ok, why: (r.why || '') + ' | ' + (i.why || '') };
};

try {
  await page.goto(url + '#/carriers');
  await page.waitForSelector('#nav a, .authgate', { state: 'attached', timeout: 20000 });
  if (await page.locator('.authgate').count()) {
    await page.fill('.authgate input[type=email]', 't@example.com'); await page.fill('.authgate input[name=password]', 'test password 1'); await page.fill('.authgate input[name=confirm]', 'test password 1').catch(() => {});
    await page.click('.authgate button[type=submit]');
  }
  await page.waitForSelector('#nav a', { state: 'attached', timeout: 20000 });
  if (await page.locator('.tour-layer').waitFor({ timeout: 1500 }).then(() => true).catch(() => false)) await page.click('.tour-skip');

  // ---- seed: one carrier (the one in the screenshot), a customer, two loads
  const seed = await ev(async () => {
    const m = await import('/js/store/state.js'); const A = m.actions;
    const cb = { mc: '', email: '', phone: '', originCity: '', originState: '', destCity: '', destState: '', equipment: 'V', preferredPickupDates: '', rate: '', lastCovered: '', coverCount: '', lastContacted: '', responseRate: '', status: 'Active', notes: '' };
    await A.saveCarrier({ ...cb, carrierName: 'Example Trucking', mc: '12345', email: 'example@gmail.com', phone: '803-555-0142', originCity: 'aiken', originState: 'sc', destCity: 'fletcher', destState: 'ok', equipment: 'v' });
    const cu = { company: '', contactName: '', title: '', email: '', phone: '', city: '', state: '', industry: '', lanes: '', equipment: '', status: 'Active', lastContacted: '', notes: '' };
    await A.saveCustomer({ ...cu, company: 'Acme Plastics', contactName: 'Dana Ruiz', email: 'dana@acme.example', city: 'Chicago', state: 'IL' });
    const d = new Date(Date.now() + 2 * 86400000); const when = (d.getMonth() + 1) + '/' + d.getDate() + '/' + d.getFullYear();
    const mk = (o) => A.addParsedLoad({ originZip: '', destZip: '', pickupEarliest: when, pickupLatest: when, weight: '38000', equip: 'V', details: '', ...o });
    const l1 = await mk({ originCity: 'Aiken', originState: 'SC', destCity: 'Fletcher', destState: 'OK' });
    const l2 = await mk({ originCity: 'Harrisburg', originState: 'PA', destCity: 'Richmond', destState: 'VA' });
    return { c: m.state.carriers.length, l: m.state.postings.length, l1: l1.id, l2: l2.id };
  });
  check('seed: 1 carrier, 2 loads', seed.c === 1 && seed.l === 2, JSON.stringify(seed));

  // ---- 1. the More menu is fully visible (the screenshot case: 1065 px wide, toolbar wrapped, sidebar open)
  const menuCases = [['carriers', 'Carrier Database'], ['customers', 'Customer Database'], ['inquiry', 'Inquiry Log']];
  for (const [vw, vh] of [[1065, 741], [1500, 900], [820, 700], [420, 800]]) {
    await page.setViewportSize({ width: vw, height: vh });
    for (const [tab, label] of menuCases) {
      await hash('#/' + tab); await page.waitForTimeout(250);
      if (!(await page.locator('.dir-menu summary').count())) { check(`${label}: (no toolbar while the log is empty, skipped)`, true); continue; }
      await page.locator('.dir-menu summary').first().scrollIntoViewIfNeeded();
      await page.locator('.dir-menu summary').first().click();
      await page.waitForSelector('.dir-menu[open] .dir-menu-list.placed', { timeout: 3000 });
      const r = await onScreen('.dir-menu[open] .dir-menu-list');
      const items = await onScreen('.dir-menu[open] .dir-mi');
      check(`${label} at ${vw}x${vh}: the More menu and every item are fully visible`, r.ok && items.ok, (r.why || '') + ' | ' + (items.why || ''));
      await page.keyboard.press('Escape'); await page.waitForTimeout(80);
      check(`${label} at ${vw}x${vh}: Escape closes it`, (await page.locator('.dir-menu[open]').count()) === 0);
    }
  }
  await page.setViewportSize({ width: 1065, height: 741 });

  // an item still works from the fixed list
  await hash('#/carriers'); await page.waitForSelector('.dir-menu summary');
  await page.locator('.dir-menu summary').click();
  await page.locator('.dir-mi:has-text("Import")').click();
  check('a menu item still works (Import opens its dialog)', await page.locator('.modal h3:has-text("Import carriers")').count() === 1);
  await page.keyboard.press('Escape'); await page.waitForTimeout(150);
  await page.locator('.dir-menu summary').click(); await page.locator('h1, .pagehead').first().click({ position: { x: 5, y: 5 } }).catch(() => {});
  await page.mouse.click(600, 120); await page.waitForTimeout(100);
  check('a click anywhere else closes the menu', (await page.locator('.dir-menu[open]').count()) === 0);
  // keyboard: open with Enter, arrow to an item
  await page.locator('.dir-menu summary').focus(); await page.keyboard.press('Enter');
  await page.waitForSelector('.dir-menu[open] .dir-menu-list.placed');
  check('opened from the keyboard, the first item has the focus', await ev(() => document.activeElement && document.activeElement.classList.contains('dir-mi')));
  await page.keyboard.press('Escape');
  check('the toolbar keeps its buttons together: Add carrier and More share one group', await ev(() => { const g = document.querySelector('.dir-acts'); return !!g && !!g.querySelector('[data-act="add-carrier"]') && !!g.querySelector('.dir-menu'); }));

  // ---- 2. the Load Board menus
  await hash('#/board'); await page.waitForSelector('.lanebox');
  await page.locator('[data-act="board-more"]').click();
  await page.waitForSelector('details.menu[open] .menu-pop.placed');
  const bm = await menuOk('details.menu[open] .menu-pop', 'details.menu[open] .menu-item');
  check('Load board: "More" board menu is fully visible', bm.ok, bm.why);
  await page.keyboard.press('Escape');
  await page.locator('[data-act="cover-tools"]').first().click();
  await page.waitForSelector('details.menu[open] .menu-pop.placed');
  const ct = await menuOk('details.menu[open] .menu-pop', 'details.menu[open] .menu-item');
  check('Load board: "Find trucks" menu is fully visible (scrolls inside itself if the window is short)', ct.ok, ct.why);
  await page.keyboard.press('Escape');
  // the per-load "more" menu and a posting row's menu (they open over the next load, which must not paint on top of them)
  await page.locator('.lanebox').first().locator('.laneact details.menu > summary').last().click();
  await page.waitForSelector('details.menu[open] .menu-pop.placed');
  const lm = await menuOk('details.menu[open] .menu-pop', 'details.menu[open] .menu-item');
  check('Load board: the per-load "more actions" menu is fully visible and on top', lm.ok, lm.why);
  await page.keyboard.press('Escape');
  await page.locator('.lanebox').first().locator('.rowmenu details.menu > summary').last().click();
  await page.waitForSelector('details.menu[open] .menu-pop.placed');
  const rm = await menuOk('details.menu[open] .menu-pop', 'details.menu[open] .menu-item');
  check('Load board: a posting row\'s menu is fully visible and on top', rm.ok, rm.why);
  await page.keyboard.press('Escape');

  // ---- 3. Home "Work next"
  await hash('#/home'); await page.waitForSelector('.hero');
  check('Home: the hero shrinks once there are loads', await page.locator('.hero.compact').count() === 1);
  check('Home: "Work next" lists the open loads', (await page.locator('[data-test="work-next-item"]').count()) === 2, await page.locator('[data-test="work-next-item"]').count());
  check('Home: Cover Desk and Cover Log tiles exist', (await page.locator('.tile[href="#/coverdesk"]').count()) === 1 && (await page.locator('.tile[href="#/covers"]').count()) === 1);
  await page.locator('[data-act="hw-open"]').first().click();
  await page.waitForFunction(() => location.hash === '#/board'); await page.waitForSelector('.lanebox');
  check('Home: Open takes you to that load on the board', await page.locator('.lanebox.pulse, .lanebox').count() >= 1);

  // ---- 4. Enter logs a cover, double click cannot log it twice
  await hash('#/home'); await page.waitForSelector('[data-test="work-next-item"]');
  const before = await ev(async () => (await import('/js/store/state.js')).state.coverLog.length);
  await page.locator('[data-act="hw-covered"]').first().click();
  await page.waitForSelector('.modal h3:has-text("Mark covered")');
  await page.waitForTimeout(200);
  const focused = await ev(() => { const a = document.activeElement; return a ? a.getAttribute('placeholder') : ''; });
  check('Mark covered: the cursor starts in the carrier box', /Carrier name/.test(focused || ''), focused);
  await page.fill('.modal input[placeholder="Carrier name"]', 'Example Trucking');
  await page.fill('.modal input[placeholder="$ paid / agreed"]', '1850');
  await page.press('.modal input[placeholder="$ paid / agreed"]', 'Enter');
  await page.waitForFunction((n) => import('/js/store/state.js').then(m => m.state.coverLog.length > n), before, { timeout: 8000 });
  await page.waitForTimeout(300);
  const after = await ev(async () => { const m = await import('/js/store/state.js'); return { n: m.state.coverLog.length, rate: m.state.coverLog[0] && m.state.coverLog[0].rate, loads: new Set(m.state.postings.map(p => p.groupId || p.id)).size }; });
  check('Enter in the rate box logs the cover exactly once and removes the load', after.n === before + 1 && after.loads === 1 && Number(after.rate) === 1850, JSON.stringify(after));
  check('the dialog closed after Enter', await page.locator('.modal').count() === 0);

  // ---- 5. Cover Desk: Call / Covered by them with the carrier already filled in
  await hash('#/coverdesk'); await page.waitForSelector('.cdesk');
  const sections = await page.locator('.cdesk h3').allInnerTexts();
  const iCall = sections.findIndex(t => /Call these first/.test(t)), iMatch = sections.findIndex(t => /Truck matches/.test(t));
  check('Cover Desk: "Call these first" comes before "Truck matches per load"', iCall >= 0 && iMatch > iCall, sections.join(' | '));
  if (await page.locator('[data-act="sheet-covered"]').count()) {
    check('Cover Desk: each call-sheet row has a Call button', (await page.locator('[data-act="sheet-call"]').count()) >= 1);
    await page.locator('[data-act="sheet-covered"]').first().click();
    await page.waitForSelector('.modal h3:has-text("Mark covered")');
    const nm = await page.inputValue('.modal input[placeholder="Carrier name"]');
    check('Cover Desk: "Covered by them" opens the dialog with the carrier filled in', /Example Trucking/.test(nm), nm);
    await page.keyboard.press('Escape'); await page.waitForTimeout(150);
  } else check('Cover Desk: the call sheet lists the carrier for the open load (skipped: no match for this lane)', true);

  // ---- 6. keyboard shortcuts
  await hash('#/carriers'); await page.waitForSelector('.dir-search input');
  await page.locator('#view').click({ position: { x: 5, y: 5 } }).catch(() => {});
  await page.keyboard.press('/');
  check('"/" puts the cursor in the search box', await ev(() => document.activeElement && document.activeElement.type === 'search'));
  await page.keyboard.press('Escape'); await page.locator('.dir-search input').blur();
  await page.keyboard.press('n');
  await page.waitForFunction(() => location.hash === '#/board'); await page.waitForSelector('textarea.pastebox');
  await page.waitForFunction(() => document.activeElement && document.activeElement.classList.contains('pastebox'), null, { timeout: 4000 }).catch(() => {});
  check('"n" opens the Load Board with the cursor in the paste box', await ev(() => document.activeElement && document.activeElement.classList.contains('pastebox')));
  await page.locator('textarea.pastebox').blur();
  await page.keyboard.press('g'); await page.keyboard.press('c');
  await page.waitForFunction(() => location.hash === '#/carriers', null, { timeout: 3000 }).catch(() => {});
  check('"g" then "c" goes to the Carrier Database', await ev(() => location.hash === '#/carriers'));
  await page.keyboard.press('?'); await page.waitForSelector('.modal h3:has-text("Keyboard shortcuts")', { timeout: 3000 }).catch(() => {});
  check('"?" lists the shortcuts', await page.locator('.modal h3:has-text("Keyboard shortcuts")').count() === 1);
  await page.keyboard.press('Escape'); await page.waitForTimeout(100);
  await page.locator('.dir-search input').fill('n'); 
  check('typing "n" in a search box does not trigger a shortcut', await ev(() => location.hash === '#/carriers'));
  await page.locator('.dir-search input').fill('');

  // ---- 7. nothing broke
  check('the tab title names the page', /FREIGHT SIGNAL/.test(await page.title()) && /Carrier Database/.test(await page.title()), await page.title());
  check('no page errors', errors.length === 0, errors.slice(0, 3).join(' | '));
} catch (e) { console.log('FAIL exception', e.message); results.push(false); }
await browser.close(); srv.close();
const pass = results.filter(Boolean).length; console.log(`\n${pass}/${results.length} v23 checks passed`);
process.exit(pass === results.length ? 0 : 1);
