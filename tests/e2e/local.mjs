// Local accounts (no cloud configured): several people on one computer, each with their own private data; upgrade of the old
// single-account database; reset; delete. Real Chromium, no network.   Run: npm run test:local
import { chromium } from 'playwright';
import { startServer } from './server.mjs';

const results = [];
const check = (name, ok, detail = '') => { results.push(!!ok); console.log((ok ? 'PASS ' : 'FAIL ') + name + (ok ? '' : '  -> ' + detail)); };
const { srv, url } = await startServer();
const browser = await chromium.launch(process.env.PW_CHROME ? { executablePath: process.env.PW_CHROME } : {});
const ctx = await browser.newContext({ viewport: { width: 1400, height: 900 } });
await ctx.route('https://api.weather.gov/**', (r) => r.fulfill({ status: 200, contentType: 'application/geo+json', body: '{"features":[]}' }));
const page = await ctx.newPage(); const errors = []; const external = [];
page.on('pageerror', (e) => errors.push(e.message)); page.on('console', (m) => { if (m.type() === 'error') errors.push(m.text()); });
page.on('request', (r) => { if (!r.url().startsWith(url) && !/^(data|blob):/.test(r.url()) && !r.url().startsWith('https://api.weather.gov/')) external.push(r.url()); });
const carriers = () => page.evaluate(async () => (await import('/js/store/state.js')).state.carriers.map(c => c.carrierName));
const addCarrier = (n) => page.evaluate(async (n) => { const m = await import('/js/store/state.js'); await m.actions.saveCarrier({ carrierName: n, email: n.toLowerCase().replace(/\W/g, '') + '@example.test', status: 'Active' }); }, n);
const skipTour = async () => { if (await page.locator('.tour-layer').waitFor({ timeout: 1500 }).then(() => true).catch(() => false)) await page.click('.tour-skip'); };
const create = async (email, pw) => { await page.click('.authgate [data-act="tab-create"]'); await page.fill('.authgate input[type=email]', email); await page.fill('.authgate input[name=password]', pw); await page.fill('.authgate input[name=confirm]', pw); await page.click('.authgate button[type=submit]'); await page.waitForSelector('#nav a', { timeout: 45000 }); await skipTour(); };
const signIn = async (email, pw) => { await page.fill('.authgate input[type=email]', email); await page.fill('.authgate input[name=password]', pw); await page.click('.authgate button[type=submit]'); await page.waitForSelector('#nav a, .authgate .autherr:not(:empty)', { timeout: 45000 }); };
const signOut = async () => { await page.click('#signoutbtn'); await page.waitForSelector('.authgate'); };

try {
  // The old single-account version: data + a sign-in stored inside the old database. Build it before the new code runs.
  await page.goto(url); await page.waitForSelector('.authgate');
  const oldPw = await page.evaluate(async () => {
    const auth = await import('/js/store/auth.js'); const db = await import('/js/store/db.js');
    const acct = await auth.makeAccount('owen@example.com', 'old password 1');
    await db.put('kv', { key: 'settings', value: { account: acct, accountPrompt: 'done' } });
    await db.put('carriers', { id: 'old1', carrierName: 'Pre-Accounts Carrier', email: 'old@example.test', status: 'Active' });
    return 'ok';
  });
  await page.reload(); await page.waitForSelector('.authgate');
  check('a computer with an old sign-in opens on Sign in (not Create account)', (await page.locator('.authgate [data-act="tab-signin"][aria-pressed="true"]').count()) === 1);
  await signIn('owen@example.com', 'wrong'); 
  check('wrong password for the old account is refused', /do not match/.test(await page.textContent('.authgate .autherr')));
  await page.fill('.authgate input[name=password]', 'old password 1'); await page.click('.authgate button[type=submit]'); await page.waitForSelector('#nav a', { timeout: 45000 }); await skipTour();
  check('the old account signs in with its old password and keeps its data', (await carriers()).includes('Pre-Accounts Carrier'), JSON.stringify(await carriers()));
  check('header shows the e-mail', /owen/.test(await page.textContent('#profilechip')));
  await addCarrier('Owen Added Later');

  // A second person on the same computer.
  await signOut();
  await create('maria@example.com', 'maria password 2');
  check('a second person gets an empty, private workspace', (await carriers()).length === 0, JSON.stringify(await carriers()));
  await addCarrier('Maria Hauling');
  await signOut();
  await signIn('owen@example.com', 'old password 1');
  const o = await carriers();
  check('the first person still sees only their own data', o.includes('Owen Added Later') && o.includes('Pre-Accounts Carrier') && !o.includes('Maria Hauling'), JSON.stringify(o));
  await signOut(); await signIn('maria@example.com', 'maria password 2');
  const mc = await carriers();
  check('the second person sees only theirs', mc.length === 1 && mc[0] === 'Maria Hauling', JSON.stringify(mc));
  await page.reload(); await page.waitForSelector('#nav a');
  check('reload keeps the person signed in with their data', (await carriers()).includes('Maria Hauling'));

  // Duplicate e-mail, then forgot password (reset on this computer), then change password.
  await signOut(); await page.click('.authgate [data-act="tab-create"]');
  await page.fill('.authgate input[type=email]', 'MARIA@example.com'); await page.fill('.authgate input[name=password]', 'another pass 3'); await page.fill('.authgate input[name=confirm]', 'another pass 3'); await page.click('.authgate button[type=submit]');
  await page.waitForSelector('.authgate .autherr:not(:empty)');
  check('creating a second account with the same e-mail is refused', /already exists/.test(await page.textContent('.authgate .autherr')));
  await page.click('.authgate [data-act="tab-signin"]'); await page.click('text=Forgot password?');
  await page.fill('.modal input[type=email]', 'maria@example.com'); await page.fill('.modal input[type=password]', 'reset password 4'); await page.click('.modal >> text=Reset password');
  await page.waitForSelector('.modal', { state: 'detached' });
  await signIn('maria@example.com', 'reset password 4');
  check('forgot password: the reset password works and the data is kept', (await carriers()).includes('Maria Hauling'));
  await page.goto(url + '#/account'); await page.waitForSelector('#acct-signin'); await page.evaluate(() => { document.getElementById('acct-signin').open = true; });
  check('Account Settings offers Install app and says data is on this computer', (await page.locator('#acct-signin button:has-text("Install app")').count()) === 1 && /this computer/.test(await page.textContent('#acct-signin')));
  await page.click('#acct-signin button:text-is("Change")'); await page.fill('.modal input[autocomplete="current-password"]', 'reset password 4'); await page.fill('.modal input[autocomplete="new-password"]', 'changed password 5'); await page.click('.modal button:text-is("Change")');
  await page.waitForSelector('.toast.ok'); await signOut(); await signIn('maria@example.com', 'changed password 5');
  check('change password works', (await page.locator('#nav a').count()) > 5);

  // Delete the account and its data.
  await page.goto(url + '#/account'); await page.waitForSelector('#acct-signin'); await page.evaluate(() => { document.getElementById('acct-signin').open = true; });
  await page.click('#acct-signin button:text-is("Delete")'); await page.fill('.modal input[type=password]', 'changed password 5'); await page.click('.modal >> text=Continue');
  await page.waitForSelector('.authgate', { timeout: 20000 });
  await signIn('maria@example.com', 'changed password 5');
  check('a deleted account can no longer sign in', /do not match/.test(await page.textContent('.authgate .autherr')));
  await signIn('owen@example.com', 'old password 1');
  check('other accounts are untouched by the deletion', (await carriers()).includes('Owen Added Later'));
  check('no network calls at all in local mode', external.length === 0, external.join(', '));
  check('no unexpected browser errors', errors.filter(e => !/Failed to load resource/.test(e)).length === 0, errors.slice(0, 3).join(' | '));
} catch (e) { check('suite aborted by exception', false, e.stack || String(e)); }
finally { await browser.close(); srv.close(); }
const ok = results.filter(Boolean).length; console.log(`${ok}/${results.length} local-account checks passed`); process.exit(ok === results.length ? 0 : 1);
