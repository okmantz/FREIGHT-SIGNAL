// Cloud accounts, end to end in real Chromium against a fake Firebase (see fake-firebase.mjs). No network, no real project.
// Run: npm run test:cloud   (PW_CHROME=/path/to/chrome if Playwright's Chromium is not installed)
import { chromium } from 'playwright';
import { startServer } from './server.mjs';
import { FakeFirebase, FAKE_CLOUD_CONFIG } from './fake-firebase.mjs';

const results = [];
const check = (name, ok, detail = '') => { results.push(!!ok); console.log((ok ? 'PASS ' : 'FAIL ') + name + (ok ? '' : '  -> ' + detail)); };
const fb = new FakeFirebase();
const { srv, url } = await startServer();
const browser = await chromium.launch(process.env.PW_CHROME ? { executablePath: process.env.PW_CHROME } : {});
const errors = [];

async function device(name) {
  const ctx = await browser.newContext({ viewport: { width: 1400, height: 900 } });
  await ctx.addInitScript((c) => { window.__FS_CLOUD = c; }, FAKE_CLOUD_CONFIG);
  await ctx.route(/identitytoolkit\.googleapis\.com|securetoken\.googleapis\.com|firebaseio\.com/, (r) => fb.route(r));
  await ctx.route('https://api.weather.gov/**', (r) => r.fulfill({ status: 200, contentType: 'application/geo+json', body: '{"features":[]}' }));
  const page = await ctx.newPage();
  page.on('pageerror', (e) => errors.push(name + ': ' + e.message));
  page.on('console', (m) => { if (m.type() === 'error' && !/Failed to load resource/.test(m.text())) errors.push(name + ': ' + m.text()); });
  return { ctx, page, name };
}
const gateMode = (page, mode) => page.click(`.authgate [data-act="tab-${mode}"]`);
async function skipTour(page) { if (await page.locator('.tour-layer').waitFor({ timeout: 1500 }).then(() => true).catch(() => false)) await page.click('.tour-skip'); }
async function createAccount(page, email, pw) {
  await page.goto(url + '#/home'); await page.waitForSelector('.authgate');
  await gateMode(page, 'create');
  await page.fill('.authgate input[type=email]', email);
  await page.fill('.authgate input[name=password]', pw); await page.fill('.authgate input[name=confirm]', pw);
  await page.click('.authgate button[type=submit]');
  await page.waitForSelector('#nav a', { timeout: 45000 });
  await skipTour(page);
}
async function signIn(page, email, pw) {
  await page.goto(url + '#/home'); await page.waitForSelector('.authgate');
  await page.fill('.authgate input[type=email]', email); await page.fill('.authgate input[name=password]', pw);
  await page.click('.authgate button[type=submit]');
  await page.waitForSelector('#nav a, .authgate .autherr:not(:empty)', { timeout: 20000 });
}
const carriers = (page) => page.evaluate(async () => (await import('/js/store/state.js')).state.carriers.map(c => c.carrierName));
const addCarrier = (page, name) => page.evaluate(async (n) => { const m = await import('/js/store/state.js'); await m.actions.saveCarrier({ carrierName: n, email: n.toLowerCase().replace(/\W/g, '') + '@example.test', status: 'Active' }); }, name);
const synced = (page) => page.waitForFunction(() => /Saved to account/.test(document.getElementById('syncstat').textContent), null, { timeout: 15000 });
const until = async (fn, ms = 15000) => { const t = Date.now(); while (Date.now() - t < ms) { if (await fn()) return true; await new Promise(r => setTimeout(r, 150)); } return false; };

try {
  // 1. Not signed in: the gate (not the app) opens, with Sign in and Create account.
  const A = await device('A');
  await A.page.goto(url + '#/home'); await A.page.waitForSelector('.authgate');
  check('opening the link asks to sign in or create an account', (await A.page.locator('.authgate [data-act="tab-create"]').count()) === 1 && (await A.page.locator('#nav a').count()) === 0);
  check('no "Skip for now" in cloud mode (every visitor needs their own account)', (await A.page.locator('.authgate >> text=Skip for now').count()) === 0);

  // 2. Wrong credentials and weak passwords are rejected with a readable message.
  await A.page.fill('.authgate input[type=email]', 'alice@example.test'); await A.page.fill('.authgate input[name=password]', 'whatever123'); await A.page.click('.authgate button[type=submit]');
  await A.page.waitForSelector('.authgate .autherr:not(:empty)');
  check('sign-in with an unknown account is refused', /do not match/.test(await A.page.textContent('.authgate .autherr')));
  await gateMode(A.page, 'create'); await A.page.fill('.authgate input[type=email]', 'alice@example.test'); await A.page.fill('.authgate input[name=password]', 'short'); await A.page.fill('.authgate input[name=confirm]', 'short'); await A.page.click('.authgate button[type=submit]');
  check('a short password is refused before anything is sent', /at least 8/.test(await A.page.textContent('.authgate .autherr')));

  // 3. Sign up as Alice: the app opens, shows the sync pill, and saves her data.
  await createAccount(A.page, 'alice@example.test', 'correct horse 1');
  check('creating an account opens the app', (await A.page.locator('#nav a').count()) > 5);
  check('header shows the signed-in e-mail', /alice/.test(await A.page.textContent('#profilechip')));
  await synced(A.page); check('sync pill says the workspace is saved to the account', true);
  await addCarrier(A.page, 'Alice Freight LLC');
  await A.page.evaluate(async () => { const m = await import('/js/store/state.js'); await m.actions.savePrefs({ profile: { name: 'Alice Broker', title: 'Broker', company: '', startPage: 'home' } }); });
  const aliceUid = [...fb.users.values()].find(u => u.email === 'alice@example.test').uid;
  check('Alice\'s carrier reached her cloud branch', await until(() => !!(fb.tree.users && fb.tree.users[aliceUid] && fb.tree.users[aliceUid].stores && fb.tree.users[aliceUid].stores.carriers && /Alice Freight/.test(fb.tree.users[aliceUid].stores.carriers.p0 || ''))));
  check('Alice\'s settings reached the cloud (and no local sign-in record)', await until(() => { const k = fb.tree.users[aliceUid].stores.kv; return k && /Alice Broker/.test(k.p0) && !/"hash"/.test(k.p0); }));
  check('every saved list has a revision token', ['carriers', 'kv'].every(s => fb.tree.users[aliceUid].rev[s]));

  // 4. A second computer: sign in with the same credentials, see the same data right away.
  const B = await device('B');
  await signIn(B.page, 'alice@example.test', 'correct horse 1');
  check('signing in on another computer shows the saved carriers', (await carriers(B.page)).includes('Alice Freight LLC'), JSON.stringify(await carriers(B.page)));
  check('...and the saved profile', /Alice Broker/.test(await B.page.textContent('#profilechip')));
  await synced(B.page);
  // 4b. A change on B arrives on A without a reload.
  await addCarrier(B.page, 'Second Device Trucking');
  await until(() => fb.tree.users[aliceUid].stores.carriers.p0.includes('Second Device'));
  await A.page.evaluate(() => document.dispatchEvent(new Event('visibilitychange')));
  check('a change made on the other computer shows up here without reloading', await until(async () => (await carriers(A.page)).includes('Second Device Trucking')), JSON.stringify(await carriers(A.page)));

  // 5. Wrong password for an existing account.
  const C = await device('C');
  await signIn(C.page, 'alice@example.test', 'not the password');
  check('a wrong password does not open the workspace', (await C.page.locator('#nav a').count()) === 0 && /do not match/.test(await C.page.textContent('.authgate .autherr')));
  await C.ctx.close();

  // 6. Reload keeps you signed in (no gate), data is there from the on-device copy.
  await A.page.reload(); await A.page.waitForSelector('#nav a');
  check('reload keeps the person signed in', (await A.page.locator('.authgate').count()) === 0 && (await carriers(A.page)).length === 2);

  // 7. Sharing: Bob uses the SAME browser after Alice signs out and must see none of her data.
  check('Account Settings shows the invite link', await (async () => { await A.page.goto(url + '#/account'); await A.page.waitForSelector('#acct-signin'); await A.page.evaluate(() => { document.getElementById('acct-signin').open = true; }); return (await A.page.inputValue('input[aria-label="Invite link"]')) === FAKE_CLOUD_CONFIG.shareUrl; })());
  await A.page.click('#signoutbtn'); await A.page.waitForSelector('.authgate', { timeout: 15000 });
  check('signing out returns to the sign-in screen', true);
  await createAccount(A.page, 'bob@example.test', 'bobs password 22');
  check('a new person on the same computer starts with an empty workspace', (await carriers(A.page)).length === 0, JSON.stringify(await carriers(A.page)));
  await addCarrier(A.page, 'Bob Hauling'); await synced(A.page);
  const bobUid = [...fb.users.values()].find(u => u.email === 'bob@example.test').uid;
  check('Bob\'s data is saved under his own branch, not Alice\'s', await until(() => fb.tree.users[bobUid] && /Bob Hauling/.test(fb.tree.users[bobUid].stores.carriers.p0)) && !/Bob Hauling/.test(fb.tree.users[aliceUid].stores.carriers.p0));
  // The database rule: Bob's token cannot read Alice's branch.
  const bobCanRead = await A.page.evaluate(async (uid) => { const s = JSON.parse(localStorage.getItem('fs-cloud-session')); const t = await (await import('/js/store/cloud.js')).getToken(); const r = await fetch('https://fs-test-default-rtdb.firebaseio.com/users/' + uid + '/stores.json?auth=' + t); return r.status; }, aliceUid);
  check('the database rule refuses one person reading another person\'s data (401)', bobCanRead === 401, String(bobCanRead));

  // 8. Alice signs back in on the shared computer: her own data returns.
  await A.page.click('#signoutbtn'); await A.page.waitForSelector('.authgate');
  await signIn(A.page, 'alice@example.test', 'correct horse 1');
  check('Alice signing back in gets her own carriers (not Bob\'s)', await until(async () => { const c = await carriers(A.page); return c.includes('Alice Freight LLC') && !c.includes('Bob Hauling'); }));

  // 9. Password change and reset e-mail.
  await A.page.goto(url + '#/account'); await A.page.waitForSelector('#acct-signin'); await A.page.evaluate(() => { document.getElementById('acct-signin').open = true; });
  await A.page.click('text=E-mail me a link'); await until(() => fb.log.some(l => l[0] === 'reset' && l[1] === 'alice@example.test'));
  check('"E-mail me a link" asks Firebase to send the reset e-mail', fb.log.some(l => l[0] === 'reset' && l[1] === 'alice@example.test'));
  await A.page.click('#acct-signin button:text-is("Change")'); await A.page.fill('.modal input[autocomplete="current-password"]', 'correct horse 1'); await A.page.fill('.modal input[autocomplete="new-password"]', 'brand new pass 9'); await A.page.click('.modal button:text-is("Change")');
  check('changing the password works and the new one is accepted', await until(() => fb.byEmail.get('alice@example.test').password === 'brand new pass 9'));

  // 10. Data from before accounts existed is offered to the first person who signs in on that browser.
  const D = await device('D');
  await D.page.goto(url + '#/home'); await D.page.waitForSelector('.authgate');
  await D.page.evaluate(async () => { const m = await import('/js/store/db.js'); await m.put('carriers', { id: 'legacy1', carrierName: 'Legacy Carrier Co', email: 'legacy@example.test', status: 'Active' }); await m.put('postings', { id: 'lp1', order: 0 }); });
  await D.page.reload(); await D.page.waitForSelector('.authgate');
  await D.page.fill('.authgate input[type=email]', ''); await gateMode(D.page, 'create');
  await D.page.fill('.authgate input[type=email]', 'dana@example.test'); await D.page.fill('.authgate input[name=password]', 'danas password 3'); await D.page.fill('.authgate input[name=confirm]', 'danas password 3'); await D.page.click('.authgate button[type=submit]');
  await D.page.waitForSelector('.modal:has-text("existing data")', { timeout: 20000 });
  check('old local data is offered to the new account (with counts)', /1 carrier/.test(await D.page.textContent('.modal')));
  await D.page.click('.modal >> text=Add it to my account'); await D.page.waitForSelector('#nav a'); await skipTour(D.page);
  check('...and, when accepted, it appears in the account', (await carriers(D.page)).includes('Legacy Carrier Co'));
  const danaUid = [...fb.users.values()].find(u => u.email === 'dana@example.test').uid;
  check('...and is uploaded to the cloud', await until(() => fb.tree.users[danaUid] && fb.tree.users[danaUid].stores && /Legacy Carrier Co/.test(fb.tree.users[danaUid].stores.carriers.p0)));

  // 11. Offline edits are kept and upload when the connection is back.
  fb.offline = true;
  await addCarrier(D.page, 'Offline Edit Inc');
  await D.page.waitForFunction(() => /Offline/.test(document.getElementById('syncstat').textContent), null, { timeout: 15000 });
  check('offline: the change is kept on the device and the pill says so', (await carriers(D.page)).includes('Offline Edit Inc'));
  fb.offline = false;
  await D.page.evaluate(() => window.dispatchEvent(new Event('online')));
  check('back online: the offline change is uploaded', await until(() => /Offline Edit Inc/.test(fb.tree.users[danaUid].stores.carriers.p0), 25000));

  // 12. Delete account removes the sign-in and the data.
  await D.page.goto(url + '#/account'); await D.page.waitForSelector('#acct-signin'); await D.page.evaluate(() => { document.getElementById('acct-signin').open = true; });
  await D.page.click('#acct-signin >> button:has-text("Delete")'); await D.page.fill('.modal input[type=password]', 'danas password 3'); await D.page.click('.modal >> text=Continue');
  check('deleting the account removes the sign-in and all cloud data', await until(() => !fb.byEmail.has('dana@example.test') && !(fb.tree.users && fb.tree.users[danaUid])));
  check('no unexpected browser errors', errors.length === 0, errors.slice(0, 4).join(' | '));
} catch (e) { check('suite aborted by exception', false, e.stack || String(e)); }
finally { await browser.close(); srv.close(); }
const ok = results.filter(Boolean).length; console.log(`${ok}/${results.length} cloud checks passed`); process.exit(ok === results.length ? 0 : 1);
