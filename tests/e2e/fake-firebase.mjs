// A tiny in-memory stand-in for Firebase Authentication + Realtime Database (REST), enforcing the same per-user rule as
// database.rules.json. Lets the cloud tests run with no network and no real project.
export class FakeFirebase {
  constructor() { this.users = new Map(); this.byEmail = new Map(); this.tree = {}; this.log = []; this.n = 0; this.denied = 0; }
  tok(uid) { return 'id.' + uid + '.' + (Date.now() + 3600000); }
  uidFromToken(t) { const m = /^id\.([^.]+)\.(\d+)$/.exec(t || ''); return m && Number(m[2]) > Date.now() && this.users.has(m[1]) ? m[1] : null; }
  session(u) { return { localId: u.uid, email: u.email, idToken: this.tok(u.uid), refreshToken: 'rt.' + u.uid + '.' + u.rt, expiresIn: '3600' }; }
  err(status, message) { return { status, body: { error: { code: status, message } } }; }
  auth(method, body) {
    const email = String(body.email || '').toLowerCase();
    if (method === 'signUp') {
      if (this.byEmail.has(email)) return this.err(400, 'EMAIL_EXISTS');
      if (String(body.password || '').length < 6) return this.err(400, 'WEAK_PASSWORD : Password should be at least 6 characters');
      const uid = 'u' + (++this.n) + 'x' + Math.random().toString(36).slice(2, 8);
      const u = { uid, email, password: body.password, rt: 1 }; this.users.set(uid, u); this.byEmail.set(email, u);
      return { status: 200, body: this.session(u) };
    }
    if (method === 'signInWithPassword') {
      const u = this.byEmail.get(email);
      if (!u || u.password !== body.password) return this.err(400, 'INVALID_LOGIN_CREDENTIALS');
      return { status: 200, body: this.session(u) };
    }
    if (method === 'sendOobCode') { this.log.push(['reset', email]); return { status: 200, body: { email } }; }
    if (method === 'update') { const uid = this.uidFromToken(body.idToken); if (!uid) return this.err(400, 'INVALID_ID_TOKEN'); const u = this.users.get(uid); u.password = body.password; u.rt++; return { status: 200, body: this.session(u) }; }
    if (method === 'delete') { const uid = this.uidFromToken(body.idToken); if (!uid) return this.err(400, 'INVALID_ID_TOKEN'); const u = this.users.get(uid); this.users.delete(uid); this.byEmail.delete(u.email); return { status: 200, body: {} }; }
    return this.err(400, 'OPERATION_NOT_ALLOWED');
  }
  refresh(params) {
    const m = /^rt\.([^.]+)\.(\d+)$/.exec(params.get('refresh_token') || ''); const u = m && this.users.get(m[1]);
    if (!u || String(u.rt) !== m[2]) return this.err(400, 'INVALID_REFRESH_TOKEN');
    return { status: 200, body: { id_token: this.tok(u.uid), refresh_token: 'rt.' + u.uid + '.' + u.rt, user_id: u.uid, expires_in: '3600' } };
  }
  db(method, pathname, token, bodyText) {
    const parts = pathname.replace(/^\/+|\.json$/g, '').split('/').filter(Boolean);
    const uid = this.uidFromToken(token);
    // database.rules.json: users/$uid is readable and writable by that user only; everything else is closed.
    if (!uid || parts[0] !== 'users' || parts[1] !== uid) { this.denied++; return { status: 401, body: { error: 'Permission denied' } }; }
    const body = bodyText ? JSON.parse(bodyText) : undefined;
    const walk = (create) => { let node = this.tree; for (const p of parts.slice(0, -1)) { if (typeof node[p] !== 'object' || node[p] === null) { if (!create) return null; node[p] = {}; } node = node[p]; } return node; };
    const set = (path, value) => { const ps = path.split('/').filter(Boolean); let node = this.tree; for (const p of ps.slice(0, -1)) { if (typeof node[p] !== 'object' || node[p] === null) node[p] = {}; node = node[p]; } if (value === null) delete node[ps[ps.length - 1]]; else node[ps[ps.length - 1]] = value; };
    if (method === 'GET') { let node = this.tree; for (const p of parts) { node = node && typeof node === 'object' ? node[p] : undefined; } return { status: 200, body: node === undefined ? null : node }; }
    if (method === 'PUT') { set(parts.join('/'), body); return { status: 200, body }; }
    if (method === 'DELETE') { set(parts.join('/'), null); return { status: 200, body: null }; }
    if (method === 'PATCH') { for (const [k, v] of Object.entries(body)) set(parts.join('/') + '/' + k, v); return { status: 200, body }; }
    return { status: 405, body: {} };
  }
  /** Playwright route handler. */
  async route(route) {
    const req = route.request(); const url = new URL(req.url());
    const cors = { 'access-control-allow-origin': '*', 'access-control-allow-headers': '*', 'access-control-allow-methods': 'GET,POST,PUT,PATCH,DELETE,OPTIONS' };
    if (this.offline) return route.abort('internetdisconnected');
    if (req.method() === 'OPTIONS') return route.fulfill({ status: 204, headers: cors });
    let r;
    if (url.hostname === 'identitytoolkit.googleapis.com') r = this.auth(url.pathname.split(':').pop(), JSON.parse(req.postData() || '{}'));
    else if (url.hostname === 'securetoken.googleapis.com') r = this.refresh(new URLSearchParams(req.postData() || ''));
    else r = this.db(req.method(), url.pathname, url.searchParams.get('auth'), req.postData());
    return route.fulfill({ status: r.status, headers: { ...cors, 'content-type': 'application/json' }, body: JSON.stringify(r.body) });
  }
}
export const FAKE_CLOUD_CONFIG = { apiKey: 'fake-key', databaseURL: 'https://fs-test-default-rtdb.firebaseio.com', shareUrl: 'https://example.test/FREIGHT-SIGNAL/' };
