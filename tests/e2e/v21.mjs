// v21: relevance search (Carrier + Customer database), the primary-carrier star, Auto Rescue reshuffle / escalation / repost banner, call outcomes. Real Chromium.
// Run: npm run test:v21   (PW_CHROME=/path/to/chrome if Playwright's Chromium is not installed)
import { chromium } from 'playwright';
import { startServer } from './server.mjs';

const results = [];
const check = (name, ok, detail = '') => { results.push(!!ok); console.log((ok ? 'PASS ' : 'FAIL ') + name + (ok ? '' : '  -> ' + detail)); };
const { srv, url } = await startServer();
const browser = await chromium.launch(process.env.PW_CHROME ? { executablePath: process.env.PW_CHROME } : {});
const ctx = await browser.newContext({ viewport: { width: 1500, height: 1000 }, acceptDownloads: true });
await ctx.route('https://api.weather.gov/**', (r) => r.fulfill({ status: 200, contentType: 'application/geo+json', body: '{"features":[]}' }));
const page = await ctx.newPage(); const errors = [];
page.on('pageerror', (e) => errors.push(e.message)); page.on('console', (m) => { if (m.type() === 'error') errors.push(m.text()); });
const ev = (fn, arg) => page.evaluate(fn, arg);
const rows = () => page.locator('table.dirtable tbody tr.dir-row');
const names = async () => (await page.locator('table.dirtable tbody tr.dir-row .c-name b').allInnerTexts()).map(s => s.trim());

try {
  await page.goto(url + '#/carriers');
  await page.waitForSelector('#nav a, .authgate', { state: 'attached', timeout: 20000 });
  if (await page.locator('.authgate').count()) {
    await page.fill('.authgate input[type=email]', 't@example.com'); await page.fill('.authgate input[name=password]', 'test password 1'); await page.fill('.authgate input[name=confirm]', 'test password 1').catch(() => {});
    await page.click('.authgate button[type=submit]');
  }
  await page.waitForSelector('#nav a', { state: 'attached', timeout: 20000 });
  if (await page.locator('.tour-layer').waitFor({ timeout: 1500 }).then(() => true).catch(() => false)) await page.click('.tour-skip');

  // ---- seed: carriers (one primary), customers, a hard load
  const seed = await ev(async () => {
    const m = await import('/js/store/state.js'); const A = m.actions;
    const base = { mc: '', email: '', phone: '', originCity: '', originState: '', destCity: '', destState: '', equipment: 'V', preferredPickupDates: '', rate: '', lastCovered: '', coverCount: '', lastContacted: '', responseRate: '', status: 'Active', notes: '' };
    const list = [
      { carrierName: 'Keystone Haul LLC', mc: 'MC 123456', email: 'dispatch@keystonehaul.example', phone: '(717) 555-0100', originCity: 'Harrisburg', originState: 'PA', destCity: 'Richmond', destState: 'VA', equipment: 'V, R', coverCount: '3' },
      { carrierName: 'Smith Trucking Inc', mc: 'MC 998877', email: 'ops@smithtrk.example', phone: '804-555-0199', originCity: 'Richmond', originState: 'VA', destCity: 'Atlanta', destState: 'GA', equipment: 'F', notes: 'keystone partner' },
      { carrierName: 'Big Smith Express', mc: 'MC 111222', email: 'x@bigsmith.example', originState: 'TX' },
      { carrierName: 'Taylord Logistics', mc: 'MC 777001', email: 'taylord@taylord.example', phone: '864-555-0001', originCity: 'Greenville', originState: 'SC', destCity: 'Atlanta', destState: 'GA' },
      { carrierName: 'Zephyr Freight', mc: 'MC 400400', email: 'z@zephyr.example', phone: '215-555-0142', originCity: 'Allentown', originState: 'PA', destCity: 'Charlotte', destState: 'NC' },
    ];
    for (const c of list) await A.saveCarrier({ ...base, ...c });
    const cust = { company: '', contactName: '', title: '', email: '', phone: '', city: '', state: '', industry: '', lanes: '', equipment: '', status: 'Active', lastContacted: '', notes: '' };
    for (const c of [{ company: 'Acme Plastics', contactName: 'Dana Ruiz', email: 'dana@acmeplastics.example', phone: '312-555-0111', city: 'Chicago', state: 'IL' }, { company: 'Plastic Works of Ohio', contactName: 'Acme Liaison', city: 'Toledo', state: 'OH' }, { company: 'Brightline Foods', contactName: 'Sam Lee', phone: '614-555-0123', city: 'Columbus', state: 'OH' }]) await A.saveCustomer({ ...cust, ...c });
    const tay = m.state.carriers.find(c => /Taylord/.test(c.carrierName));
    await A.saveAssignment({ carrierId: tay.id, carrierName: tay.carrierName, mc: tay.mc, email: tay.email, phone: tay.phone, originCity: 'Greenville', originState: 'SC', destCity: '', destState: 'GA', priority: 'primary' });
    const d = new Date(Date.now() + 3 * 86400000); const when = (d.getMonth() + 1) + '/' + d.getDate() + '/' + d.getFullYear();
    const load = await A.addParsedLoad({ originCity: 'Philadelphia', originState: 'PA', originZip: '19103', destCity: 'Richmond', destState: 'VA', destZip: '23219', pickupEarliest: when, pickupLatest: when, weight: '38000', equip: 'V', details: 'Pickup: Philadelphia, PA 19103\nDelivery: Richmond, VA 23219' }, { targetRate: '1000' });
    const p = m.state.carriers.find(c => /Keystone/.test(c.carrierName));
    await A.saveAssignment({ carrierId: p.id, carrierName: p.carrierName, mc: p.mc, email: p.email, phone: p.phone, originCity: 'Philadelphia', originState: 'PA', destCity: 'Richmond', destState: 'VA', priority: 'primary' });
    return { loadId: load.id, n: m.state.carriers.length };
  });
  check('seed: 5 carriers', seed.n === 5, JSON.stringify(seed));

  // ---- 1. the star
  await page.evaluate(() => { location.hash = '#/carriers'; });
  await page.waitForSelector('table.dirtable', { timeout: 20000 });
  check('primary carriers carry the star on their avatar (2 of 5)', (await page.locator('tr.dir-row .pstar.primary').count()) === 2, await page.locator('tr.dir-row .pstar').count());
  const tip = await page.locator('tr.dir-row .pstar.primary').first().getAttribute('title');
  check('the star says which lane the carrier is primary for', /Primary carrier for/.test(tip || '') && /to/.test(tip || ''), tip);
  await page.locator('.dir-seg [data-view="primary"]').click();
  await page.waitForTimeout(250);
  const prim = await names();
  check('the Primary quick view lists exactly the two primary carriers', prim.length === 2 && prim.some(n => /Keystone/.test(n)) && prim.some(n => /Taylord/.test(n)), prim.join('|'));
  await page.locator('.dir-seg [data-view="all"]').click();

  // ---- 2. search: live (no Enter), ranked, forgiving
  const box = page.locator('.dir-search input');
  await box.click(); await page.keyboard.type('smith', { delay: 25 });
  await page.waitForTimeout(500);
  let n = await names();
  check('typing filters live, with no Enter needed', n.length >= 2 && n.every(x => /smith/i.test(x) || x === 'Keystone Haul LLC'), n.join('|'));
  check('a name match outranks a note match (Smith first, Keystone only via its note: not listed as a name hit)', /Smith/.test(n[0]), n.join('|'));
  check('the search box kept focus and the caret while the table redrew', await ev(() => document.activeElement && document.activeElement.matches('.dir-search input') && document.activeElement.value === 'smith'));
  check('matching text is highlighted', (await page.locator('tr.dir-row mark.hl').count()) >= 1);
  await box.fill(''); await box.type('keystone', { delay: 20 }); await page.waitForTimeout(400);
  n = await names();
  check('"keystone": the carrier NAMED Keystone ranks above the one that only mentions it in notes', /Keystone/.test(n[0]) && n.length === 2 && /Smith/.test(n[1]), n.join('|'));
  await box.fill('keystne'); await page.waitForTimeout(400);
  check('a typo still finds it ("keystne")', /Keystone/.test((await names())[0] || ''));
  await box.fill('717 555'); await page.waitForTimeout(400);
  check('a phone number in any format finds the carrier ("717 555")', (await names()).join() === 'Keystone Haul LLC', (await names()).join());
  await box.fill('998877'); await page.waitForTimeout(400);
  check('an MC number without "MC" finds the carrier', (await names()).join() === 'Smith Trucking Inc', (await names()).join());
  await box.fill('primary'); await page.waitForTimeout(400);
  check('typing "primary" lists the primary carriers', (await names()).length === 2, (await names()).join('|'));
  await box.fill('st:ga'); await page.waitForTimeout(400);
  check('"st:ga" narrows to the state field', (await names()).length >= 2, (await names()).join('|'));
  await box.fill('smith zzzz'); await page.waitForTimeout(400);
  check('when no carrier matches every word, the closest matches are shown with a note', /closest/i.test(await page.locator('.dir-hint').innerText()) && (await names()).length >= 1);
  await box.fill('smith'); await page.waitForTimeout(300);
  await page.locator('th .thbtn[data-sort="carrierName"]').click(); await page.waitForTimeout(250);
  n = await names();
  check('clicking a column header after a search sorts by that column instead', n.join() === [...n].sort((a, b) => a.localeCompare(b)).join(), n.join('|'));
  await page.locator('.dir-hint .linkbtn').click(); await page.waitForTimeout(250);
  check('"Sort by best match" brings the ranking back', /best match first/i.test(await page.locator('.dir-hint').innerText()));
  await box.fill('');
  await page.keyboard.press('Escape'); await page.waitForTimeout(250);

  // ---- 3. customers
  await page.evaluate(() => { location.hash = '#/customers'; });
  await page.waitForSelector('table.dirtable', { timeout: 20000 });
  const cbox = page.locator('.dir-search input'); await cbox.click(); await page.keyboard.type('acme', { delay: 25 }); await page.waitForTimeout(450);
  const cn = (await page.locator('table.dirtable tbody tr.dir-row .c-name b').allInnerTexts()).map(s => s.trim());
  check('customers: "acme" puts the company Acme Plastics before the company that only has an Acme contact (and grouping does not scramble it)', cn[0] === 'Acme Plastics' && cn.length === 2, cn.join('|'));
  await cbox.fill('614 555'); await page.waitForTimeout(400);
  check('customers: a phone number finds the company', (await page.locator('table.dirtable tbody tr.dir-row .c-name b').allInnerTexts()).join().includes('Brightline'));
  await cbox.fill('');

  // ---- 4. Auto Rescue: primary first, reshuffle across state lines, rate step, repost banner
  const before = await ev(async ([id]) => { const m = await import('/js/store/state.js'); const g = (m.state.postings.find(p => p.id === id).groupId); return { single: !g, n: m.state.postings.length }; }, [seed.loadId]);
  check('the load starts as a single posting (no matrix yet)', before.single);
  const out = await ev(async ([id]) => {
    const m = await import('/js/store/state.js'); const A = m.actions;
    const r = await A.startAutoRescue(id, { maxRate: 1200, includeTeam: false, pace: 2 });
    await A.tickAutoRescue({ force: 'wave1', only: id });                                    // the first wave (5 min in, 2.5 on Fast)
    const first = m.state.drafts.filter(d => d.rescueId === id).map(d => ({ to: d.to, tier: d.tier, body: d.body.slice(0, 160) }));
    return { first, pace: r.pace, calls: (A.autoRescueFor(id).calls || []).map(c => ({ n: c.name, p: c.primary })) };
  }, [seed.loadId]);
  check('Fast pace was saved on the rescue', out.pace === 2);
  check('first wave goes to the primary carrier first, with the "first look" wording', out.first.length >= 1 && /keystone/.test(out.first[0].to) && /first look/.test(out.first[0].body) && /primary/i.test(out.first[0].tier), JSON.stringify(out.first[0]));
  check('the call list puts the primary carrier first and carries the primary flag', out.calls.length >= 1 && out.calls[0].p === 'primary', JSON.stringify(out.calls));

  const step = await ev(async ([id]) => {
    const m = await import('/js/store/state.js'); const A = m.actions;
    const r = A.autoRescueFor(id);
    r.startedAt -= 40 * 60000; r.fired.match = r.startedAt;      // 40 minutes in, Fast pace = 80 effective minutes: the 30 and 60 minute stages are due
    await A.tickAutoRescue({ only: id });
    const head = m.state.postings.find(p => p.id === id); const mem = m.state.postings.filter(p => p.groupId && p.groupId === head.groupId);
    return { n: mem.length, reshuffles: r.reshuffles, repost: !!r.repost, states: [...new Set(mem.map(p => p.originState + '>' + p.destState))], log: r.log.map(l => l.text).slice(-4), target: head.targetRate, cities: mem.map(p => p.originCity + ',' + p.originState + '>' + p.destCity + ',' + p.destState) };
  }, [seed.loadId]);
  check('Auto Rescue built the nine-posting matrix for a load that had none', step.n === 9 && step.reshuffles >= 1, JSON.stringify(step));
  check('the new postings reach beyond the home state when there is a good market across the line', step.states.length > 1, step.states.join('|'));
  check('the rate stepped up inside the limit', Number(step.target) > 1000 && Number(step.target) <= 1200, step.target);
  check('the repost flag is set (DAT still has the old postings)', step.repost);

  await page.evaluate(() => { location.hash = '#/board'; });
  await page.waitForSelector('[data-test="rescue-repost"]', { timeout: 20000 });
  const banner = await page.locator('[data-test="rescue-repost"]').innerText();
  check('the board shows the "upload to DAT" banner with a download button', /Upload to DAT/.test(banner) && (await page.locator('[data-act="rescue-csv"]').count()) === 1, banner);
  const dlP = page.waitForEvent('download'); await page.locator('[data-act="rescue-csv"]').click();
  const warn = page.locator('.modal-foot >> text=Download anyway'); if (await warn.waitFor({ timeout: 1500 }).then(() => true).catch(() => false)) await warn.click();
  const dl = await dlP;
  check('the button downloads the DAT CSV', /\.csv$/i.test(dl.suggestedFilename()), dl.suggestedFilename());
  await page.waitForTimeout(500);
  check('after the download the banner is gone', (await page.locator('[data-test="rescue-repost"]').count()) === 0);

  // escalation rounds
  const cyc = await ev(async ([id]) => {
    const m = await import('/js/store/state.js'); const A = m.actions; const r = A.autoRescueFor(id);
    for (const k of ['match', 'wave1', 'expand', 'commercial', 'team']) r.fired[k] = r.startedAt;
    r.startedAt -= 200 * 60000;
    r.lastReshuffleAt = 0;
    await A.tickAutoRescue({ only: id });
    const a = { cycles: r.cycles, reshuffles: r.reshuffles };
    await A.tickAutoRescue({ only: id });                       // same minute: not due again
    return { ...a, again: r.cycles, last: r.log[r.log.length - 1].text.slice(0, 80) };
  }, [seed.loadId]);
  check('an escalation round runs after the timed stages, once, and not again in the same minute', cyc.cycles === 1 && cyc.again === 1, JSON.stringify(cyc));

  // ---- 5. call outcome
  const call = await ev(async ([id]) => {
    const m = await import('/js/store/state.js'); const A = m.actions;
    await A.logCall(id, { key: 'e:taylord@taylord.example', name: 'Taylord Logistics', phone: '864-555-0001' }, 'notruck');
    const { planStage, newRescue } = await import('/js/core/autorescue.js');
    const head = m.state.postings.find(p => p.id === id);
    const r = newRescue(head, { now: Date.now() });
    const plan = planStage('wave1', r, head, { carriers: m.state.carriers, assignments: m.state.assignments, trucks: [], coverLog: [], inquiries: [], outreach: [], rescues: [], drafts: [], settings: {}, zipMap: m.state.zip, now: Date.now(), groupIds: [id] });
    return { skippedNo: plan.skipped.some(s => /no truck/.test(s.why)), calls: plan.calls.map(c => c.name), saved: (head.calls || []).length };
  }, [seed.loadId]);
  check('a logged "No truck" is remembered on the load', call.saved === 1);
  check('a carrier who said "no truck" is not offered or called again', !call.calls.includes('Taylord Logistics'), JSON.stringify(call));
  await page.evaluate(() => { location.hash = '#/board'; }); await page.waitForTimeout(400);
  for (let i = 0; i < 3 && await page.locator('.overlay').count(); i++) { await page.keyboard.press('Escape'); await page.waitForTimeout(250); }
  await page.locator('[data-act="cover-tools"]').first().click();
  await page.locator('[data-act="call-list"]').first().click();
  await page.waitForSelector('.modal table.lanetable', { timeout: 8000 }).catch(() => {});
  check('the call list shows the primary star and a "Log call" control', (await page.locator('.modal .pstar.primary').count()) >= 1 && (await page.locator('.modal [data-act="log-call"], .modal .dir-chip').count()) >= 1);
  await page.keyboard.press('Escape'); await page.waitForTimeout(250);

  // ---- 6. the Auto Rescue window
  await page.locator('[data-act="auto-rescue"]').first().click();
  await page.waitForSelector('.rs-win', { timeout: 8000 });
  const win = await page.locator('.rs-win').innerText();
  check('the window lists escalation rounds, the pace choice, who it reaches first, and Reshuffle now', /Escalation round/.test(win) && /pace/i.test(win) && /Who it reaches first/.test(win) && (await page.locator('.modal-foot button', { hasText: 'Reshuffle postings now' }).count()) === 1, win.slice(0, 300));
  check('primary carriers are starred in "who it reaches first"', (await page.locator('.rs-who .pstar.primary').count()) >= 1);

  check('no page errors', errors.length === 0, errors.slice(0, 3).join(' | '));
} catch (e) { console.log('FAIL exception', e.message); results.push(false); }
await browser.close(); srv.close();
const pass = results.filter(Boolean).length; console.log(`\n${pass}/${results.length} v21 checks passed`);
process.exit(pass === results.length ? 0 : 1);
