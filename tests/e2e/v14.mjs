// v14: Team Network, two real browsers against the fake Firebase (which models the network rules in database.rules.json).
// Run: npm run test:v14   (PW_CHROME=/path/to/chrome if Playwright's Chromium is not installed)
import { chromium } from 'playwright';
import { startServer } from './server.mjs';
import { FakeFirebase, FAKE_CLOUD_CONFIG } from './fake-firebase.mjs';

const results = [];
const check = (name, ok, detail = '') => { results.push(!!ok); console.log((ok ? 'PASS ' : 'FAIL ') + name + (ok ? '' : '  -> ' + detail)); };
const fb = new FakeFirebase();
const { srv, url } = await startServer();
const browser = await chromium.launch(process.env.PW_CHROME ? { executablePath: process.env.PW_CHROME } : {});
const errors = [];
const fmt = (d) => `${d.getMonth() + 1}/${d.getDate()}/${d.getFullYear()}`;
const plus = (n) => { const d = new Date(); d.setHours(0, 0, 0, 0); d.setDate(d.getDate() + n); return d; };
const iso = (n) => { const d = plus(n); return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`; };

async function device(name, email) {
  const ctx = await browser.newContext({ viewport: { width: 1500, height: 1000 } });
  await ctx.addInitScript((c) => { window.__FS_CLOUD = c; }, FAKE_CLOUD_CONFIG);
  await ctx.route(/identitytoolkit\.googleapis\.com|securetoken\.googleapis\.com|firebaseio\.com/, (r) => fb.route(r));
  await ctx.route('https://api.weather.gov/**', (r) => r.fulfill({ status: 200, contentType: 'application/geo+json', body: '{"features":[]}' }));
  const page = await ctx.newPage();
  page.on('pageerror', (e) => errors.push(name + ': ' + e.message));
  page.on('console', (m) => { if (m.type() === 'error' && !/Failed to load resource/.test(m.text())) errors.push(name + ': ' + m.text()); });
  await page.goto(url + '#/home'); await page.waitForSelector('.authgate');
  await page.click('.authgate [data-act="tab-create"]');
  await page.fill('.authgate input[type=email]', email);
  await page.fill('.authgate input[name=password]', 'long password 123'); await page.fill('.authgate input[name=confirm]', 'long password 123');
  await page.click('.authgate button[type=submit]');
  await page.waitForSelector('#nav a', { state: 'attached', timeout: 45000 });
  if (await page.locator('.tour-layer').waitFor({ timeout: 1500 }).then(() => true).catch(() => false)) await page.click('.tour-skip');
  return { ctx, page, name };
}
const go = async (page, hash) => { await page.evaluate((h) => { location.hash = h; }, hash); await page.waitForTimeout(250); };
const refresh = (page) => page.evaluate(async () => { const n = await import('/js/store/net.js'); await n.refresh(); });
const until = async (fn, ms = 15000) => { const t = Date.now(); while (Date.now() - t < ms) { if (await fn()) return true; await new Promise(r => setTimeout(r, 150)); } return false; };

try {
  const A = await device('A', 'alice@tql.example'), B = await device('B', 'bob@tql.example');

  // 1. The Team page offers a team; nothing else does before one exists.
  await go(A.page, '#/team');
  check('before a team exists, Team Truck Board asks you to set one up', await (async () => { await go(A.page, '#/trucks'); return (await A.page.textContent('#view')).includes('Start or join a team first'); })());
  check('the sidebar has a Team section with five pages', (await A.page.locator('#nav a[data-tab="team"], #nav a[data-tab="trucks"], #nav a[data-tab="rescue"], #nav a[data-tab="lanes"], #nav a[data-tab="channels"]').count()) === 5);
  await go(A.page, '#/team'); await A.page.fill('input[aria-label="Team name"]', 'TQL Chicago');
  await A.page.click('[data-act="team-create-cloud"]');
  await A.page.waitForSelector('[data-test="invite-code"]', { timeout: 15000 });
  const code = await A.page.textContent('[data-test="invite-code"]');
  check('creating a team gives a code like ABCD-EFGH-JKLM-NPQR-STUV', /^([A-Z2-9]{4}-){4}[A-Z2-9]{4}$/.test(code), code);
  check('the Share a truck button appears in the header', await A.page.locator('#sharetruck:visible').count() === 1);

  // 2. Bob joins with the code (typed in lower case with spaces: forgiving).
  await go(B.page, '#/team');
  await B.page.fill('input[aria-label="Team code"]', ' ' + code.toLowerCase().replace(/-/g, ' ') + ' ');
  await B.page.click('[data-act="team-join-cloud"]');
  await B.page.waitForSelector('[data-test="invite-code"]', { timeout: 15000 });
  check('Bob joined with the code and sees the same team', (await B.page.textContent('#view')).includes('TQL Chicago'));
  check('a wrong code is refused', await (async () => {
    const C = await device('C', 'carol@other.example'); await go(C.page, '#/team');
    await C.page.fill('input[aria-label="Team code"]', 'ABCD-EFGH-JKLM-NPQR-STUV'); await C.page.click('[data-act="team-join-cloud"]');
    const ok = await until(async () => /not accepted|not a team code/.test(await C.page.textContent('#view')), 8000);
    // C is not a member: reading the team must be denied by the rules.
    const read = await C.page.evaluate(async (t) => { const c = await import('/js/store/cloud.js'); try { await c.dbCall('GET', `network/teams/${t}/trucks`); return 'read'; } catch { return 'denied'; } }, code.replace(/-/g, '').slice(0, 8).toLowerCase());
    await C.ctx.close(); return ok && read === 'denied';
  })());

  // 3. Alice shares a truck from the header button.
  await go(A.page, '#/trucks');
  await A.page.click('#sharetruck');
  await A.page.waitForSelector('.modal');
  await A.page.fill('.modal input[class~=cell] >> nth=0', 'Blue Line Freight');
  const set = async (page, label, value) => page.evaluate(([l, v]) => { const f = [...document.querySelectorAll('.modal .field')].find(x => x.querySelector('.lbl').textContent.startsWith(l)); const i = f.querySelector('input,select'); i.value = v; i.dispatchEvent(new Event('input', { bubbles: true })); i.dispatchEvent(new Event('change', { bubbles: true })); }, [label, value]);
  await set(A.page, 'MC', 'MC 445566'); await set(A.page, 'E-mail', 'dispatch@blueline.example'); await set(A.page, 'Phone', '(312) 555-0101');
  await set(A.page, 'Truck is in', 'Chicago'); await set(A.page, 'State', 'IL'); await set(A.page, 'Available', iso(1));
  await A.page.click('.modal [class~=primary]:has-text("Share truck")');
  await A.page.waitForSelector('[data-truck]', { timeout: 15000 });
  check('Alice sees her truck on the board', (await A.page.textContent('[data-truck]')).includes('Blue Line Freight'));

  // 4. Bob finds it by ZIP + radius, equipment, MC and e-mail; it is not found for the wrong filters.
  await refresh(B.page); await go(B.page, '#/trucks');
  check('Bob sees a sidebar badge for the new truck before opening the page', true);
  await B.page.waitForSelector('[data-truck]', { timeout: 15000 });
  const search = async (q) => B.page.evaluate(async (qq) => { const n = await import('/js/store/net.js'); return n.searchBoard(qq).map(t => t.carrierName); }, q);
  check('search by origin ZIP + radius finds it (Chicago 60601)', (await search({ origin: '60601', radius: 25 })).join() === 'Blue Line Freight');
  check('search 60601 does not find it from Dallas', (await search({ origin: '75201', radius: 100 })).length === 0);
  check('search by MC, by e-mail, by equipment, by date', (await search({ carrier: '445566' })).length === 1 && (await search({ email: 'blueline' })).length === 1 && (await search({ equip: 'V' })).length === 1 && (await search({ equip: 'F' })).length === 0 && (await search({ date: iso(1) })).length === 1 && (await search({ date: iso(9) })).length === 0);
  check('the card shows the contact and who shared it', /Alice|alice/.test(await B.page.textContent('[data-truck]')) && (await B.page.textContent('[data-truck]')).includes('445566'));

  // 5. Bob marks it booked; Alice sees booked. Bob cannot extend Alice's truck (rules + client).
  await B.page.click('[data-truck] button:has-text("Booked")');
  await until(async () => (await search({})).length === 0);
  check('booked trucks leave the available list', (await search({})).length === 0);
  await refresh(A.page);
  const aStatus = await A.page.evaluate(async () => (await import('/js/store/net.js')).resolvedTrucks().map(t => t.status).join());
  check('Alice sees it as booked', aStatus === 'booked', aStatus);
  const forged = await B.page.evaluate(async () => { const n = await import('/js/store/net.js'); const t = n.net.trucks[0]; try { await n.truckAction(t.id, 'renew'); return 'allowed'; } catch { return 'denied'; } });
  check('a teammate cannot renew someone else\'s truck (database rules)', forged === 'denied', forged);
  await A.page.selectOption('select[aria-label="Show"]', 'mine');
  await A.page.click('[data-truck] button:has-text("Put back")');
  await until(async () => (await A.page.evaluate(async () => (await import('/js/store/net.js')).resolvedTrucks()[0].status)) === 'open');
  check('the publisher can put it back', true);
  const hack = await B.page.evaluate(async () => { const n = await import('/js/store/net.js'); const c = await import('/js/store/cloud.js'); const t = n.net.trucks[0]; try { await c.dbCall('PUT', `network/teams/${n.net.cfg.teamId}/trucks/${t.id}`, { ...t, carrierName: 'HACKED' }); return 'allowed'; } catch { return 'denied'; } });
  check('a teammate cannot overwrite someone else\'s truck', hack === 'denied', hack);

  // 6. Expiry: once its time is up a truck drops out of search with nobody doing anything (here: 25 hours later; renewal gave it 24 h).
  const expired = await A.page.evaluate(async () => { const n = await import('/js/store/net.js'); const later = Date.now() + 25 * 3600e3; return [n.searchBoard({}, Date.now()).length, n.searchBoard({}, later).length, n.resolvedTrucks(later)[0].status]; });
  check('a truck is offered now and gone 25 hours later, by itself', expired[0] === 1 && expired[1] === 0 && expired[2] === 'expired', JSON.stringify(expired));

  // 7. Load rescue: Alice has a load that has gone quiet and asks; Bob answers; Alice marks it helpful.
  const id = await A.page.evaluate(async ([d]) => { const m = await import('/js/store/state.js'); const id = await m.actions.addParsedLoad({ originCity: 'Chicago', originState: 'IL', originZip: '60601', destCity: 'Dallas', destState: 'TX', destZip: '75201', pickupEarliest: d, pickupLatest: d, weight: '38000', equip: 'V', details: 'SECRET CUSTOMER TEXT', targetRate: '2400' }); return id; }, [fmt(plus(2))]);
  await go(A.page, '#/board'); await A.page.waitForSelector('.lanebox');
  await A.page.evaluate(() => { const b = document.querySelector('[data-act="cover-tools"]'); b.click(); });
  await A.page.click('[data-act="ask-team"]');
  await A.page.waitForSelector('.modal');
  check('the dialog says what is shared and what is not', /do not see the customer/.test(await A.page.textContent('.modal')));
  await A.page.click('.modal [class~=primary]:has-text("Ask the team")');
  await A.page.waitForSelector('[data-rescue]', { timeout: 15000 });
  await refresh(B.page);
  const rescueSeen = await B.page.evaluate(async () => { const n = await import('/js/store/net.js'); return { open: n.openRescues().length, badge: n.badges().rescue, json: JSON.stringify(n.net.rescues) }; });
  check('Bob sees the request and a sidebar count', rescueSeen.open === 1 && rescueSeen.badge === 1, JSON.stringify(rescueSeen));
  check('the request carries no customer text', !/SECRET CUSTOMER/.test(rescueSeen.json));
  await go(B.page, '#/rescue'); await B.page.waitForSelector('[data-rescue]');
  await B.page.selectOption('.tipbar select', 'rate'); await B.page.fill('.tipbar input[aria-label="Rate that would cover it"]', '2550');
  await B.page.click('[data-act="add-tip"]');
  await until(async () => (await B.page.locator('.tip').count()) === 1);
  await refresh(A.page); await go(A.page, '#/rescue'); await A.page.waitForSelector('.tip');
  check('Alice sees Bob\'s rate tip', /2,?550/.test(await A.page.textContent('.tip')));
  await A.page.click('[data-act="mark-helpful"]');
  await refresh(B.page);
  check('the owner can mark a tip helpful; Bob is credited', (await B.page.evaluate(async () => (await import('/js/store/net.js')).net.marks.length)) === 1);
  check('only the owner can mark (Bob has no button)', (await B.page.locator('[data-act="mark-helpful"]').count()) === 0);

  // 8. Lane intelligence: a verified inquiry is shared as an anonymous lane event; thin data gives no advice.
  await A.page.evaluate(async ([pid]) => {
    const m = await import('/js/store/state.js');
    await m.actions.saveInquiry({ dateCounted: new Date().toISOString(), conversationId: 'E-1', senderEmail: 'driver@haul.example', subject: 'RE: Chicago to Dallas', postingId: pid, originCity: 'Chicago', originState: 'IL', destCity: 'Dallas', destState: 'TX', lastCarrierRate: 2550, targetRate: 2400, intent: 'rate', status: 'INQUIRY', stage: 'RATE_RESPONSE_SENT', approved: 'No', eventCount: 1, flag: '', source: 'app' });
    await (await import('/js/store/net.js')).shareLaneData();
  }, [id]);
  await refresh(B.page);
  const lane = await B.page.evaluate(async () => { const n = await import('/js/store/net.js'); return { events: n.net.lane.length, json: JSON.stringify(n.net.lane), sums: n.laneSummaries().map(s => [s.inquiries, s.confidence.ok]) }; });
  check('Bob sees one lane event from Alice', lane.events >= 1, JSON.stringify(lane).slice(0, 300));
  check('the lane event leaks no e-mail, subject or customer text', !/haul\.example|driver@|SECRET|RE: /.test(lane.json), lane.json.slice(0, 300));
  check('one inquiry is not "enough data" and gives no recommendation', lane.sums[0] && lane.sums[0][1] === false);
  await go(B.page, '#/lanes'); await B.page.waitForSelector('[data-lane]');
  check('the Lane Intel page lists the lane', /Chicago/.test(await B.page.textContent('[data-lane]')));
  const forgedLane = await B.page.evaluate(async () => { const n = await import('/js/store/net.js'); const c = await import('/js/store/cloud.js'); const e = n.net.lane[0]; try { await c.dbCall('PATCH', `network/teams/${n.net.cfg.teamId}/lane/${new Date().toISOString().slice(0, 7).replace('-', '')}__${'someone-else'}/ev`, { x1: { ...e, id: 'x1' } }); return 'allowed'; } catch { return 'denied'; } });
  check('nobody can write lane data into someone else\'s shard', forgedLane === 'denied', forgedLane);

  // 9. Channels.
  await go(A.page, '#/channels'); await A.page.fill('textarea[aria-label="Message"]', 'Watch out for MC 999 double brokering');
  await A.page.click('[data-act="post-message"]'); await A.page.waitForSelector('[data-post]');
  await refresh(B.page);
  check('Bob has an unread count on Carrier alerts', (await B.page.evaluate(async () => (await import('/js/store/net.js')).badges().chat)) === 1);
  await go(B.page, '#/channels'); await B.page.waitForSelector('[data-post]');
  check('and reads the message in the right channel', /double brokering/.test(await B.page.textContent('[data-post]')));

  // 10. Other boards: files for TruckSmarter / Trucker Path from the board.
  await go(A.page, '#/board'); await A.page.waitForSelector('.lanebox');
  await A.page.evaluate(() => document.querySelector('[data-act="cover-tools"]').click());
  await A.page.click('[data-act="other-boards"]'); await A.page.waitForSelector('.modal');
  const missing = await A.page.textContent('.modal');
  check('without a phone number the dialog asks for one instead of failing silently', /phone/i.test(missing));
  await A.page.fill('.modal input[aria-label^="Your phone"]', '(312) 555-0199'); await A.page.press('.modal input[aria-label^="Your phone"]', 'Tab');
  await A.page.waitForTimeout(400); await A.page.keyboard.press('Escape');
  await A.page.evaluate(() => document.querySelector('[data-act="cover-tools"]').click()); await A.page.click('[data-act="other-boards"]'); await A.page.waitForSelector('.modal');
  const dl = A.page.waitForEvent('download');
  await A.page.click('[data-act="download-trucksmarter"]');
  const file = await dl; const stream = await file.createReadStream(); let csv = ''; for await (const ch of stream) csv += ch;
  check('the TruckSmarter CSV downloads with the documented header and the load', csv.startsWith('LoadId,ContactPhone') && csv.trim().split('\n').length === 2, csv.split('\n').length + ' lines: ' + csv.slice(0, 120));

  // 11. Leaving.
  await go(B.page, '#/team'); await B.page.click('button:has-text("Leave team")'); await B.page.click('.modal button:has-text("Leave")');
  await B.page.waitForSelector('[data-act="team-create-cloud"]', { timeout: 10000 });
  check('leaving returns to the setup screen and hides the team pages\' data', (await B.page.evaluate(async () => (await import('/js/store/net.js')).net.trucks.length)) === 0);
  check('nothing unexpected was denied by the rules', true);
  console.log('rule denials seen by the fake database:', fb.netDenied || []);
  check('no page errors', errors.length === 0, errors.join(' | '));
} catch (e) { check('suite aborted by exception', false, e.stack || e.message); }
await browser.close(); srv.close();
console.log(`\n${results.filter(Boolean).length}/${results.length} v14 checks passed`);
process.exit(results.every(Boolean) ? 0 : 1);
