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
  db(method, pathname, token, bodyText, params = new URLSearchParams()) {
    const parts = pathname.replace(/^\/+|\.json$/g, '').split('/').filter(Boolean);
    const uid = this.uidFromToken(token);
    // database.rules.json: users/$uid is readable and writable by that user only; everything else is closed.
    const body = bodyText ? JSON.parse(bodyText) : undefined;
    if (uid && parts[0] === 'network' && parts[1] === 'teams' && parts[2]) return this.net(method, parts, uid, body, params);
    if (!uid || parts[0] !== 'users' || parts[1] !== uid) { this.denied++; return { status: 401, body: { error: 'Permission denied' } }; }
    const walk = (create) => { let node = this.tree; for (const p of parts.slice(0, -1)) { if (typeof node[p] !== 'object' || node[p] === null) { if (!create) return null; node[p] = {}; } node = node[p]; } return node; };
    const set = (path, value) => { const ps = path.split('/').filter(Boolean); let node = this.tree; for (const p of ps.slice(0, -1)) { if (typeof node[p] !== 'object' || node[p] === null) node[p] = {}; node = node[p]; } if (value === null) delete node[ps[ps.length - 1]]; else node[ps[ps.length - 1]] = value; };
    if (method === 'GET') { let node = this.tree; for (const p of parts) { node = node && typeof node === 'object' ? node[p] : undefined; } return { status: 200, body: node === undefined ? null : node }; }
    if (method === 'PUT') { set(parts.join('/'), body); return { status: 200, body }; }
    if (method === 'DELETE') { set(parts.join('/'), null); return { status: 200, body: null }; }
    if (method === 'PATCH') { for (const [k, v] of Object.entries(body)) set(parts.join('/') + '/' + k, v); return { status: 200, body }; }
    return { status: 405, body: {} };
  }
  /** network/teams/<team>/...: a JavaScript model of the Team Network section of database.rules.json (same conditions, same paths). */
  net(method, parts, uid, body, params) {
    const T = parts[2], rel = parts.slice(3); const team = (this.tree.network && this.tree.network.teams && this.tree.network.teams[T]) || null;
    const get = (obj, path) => path.reduce((n, p) => (n && typeof n === 'object' ? n[p] : undefined), obj);
    const deny = () => { this.denied++; return { status: 401, body: { error: 'Permission denied' } }; };
    const isMember = !!(team && team.members && team.members[uid]);
    if (method === 'GET') {
      if (!isMember) return deny();
      let node = get(team, rel); node = node === undefined ? null : node;
      const st = params.get('startAt');
      if (st && node && params.get('orderBy') === '"$key"') { const lo = JSON.parse(st); node = Object.fromEntries(Object.entries(node).filter(([k]) => k >= lo)); }
      return { status: 200, body: node };
    }
    // Flatten the write into leaf writes (PATCH keys may be paths), apply to a copy, then judge each leaf the way the rules do.
    const leaves = [];
    if (method === 'PATCH') for (const [k, v] of Object.entries(body)) leaves.push([[...rel, ...k.split('/')], v]);
    else leaves.push([rel, method === 'DELETE' ? null : body]);
    const after = JSON.parse(JSON.stringify(team || {}));
    const apply = (path, v) => { let n = after; for (const p of path.slice(0, -1)) { if (typeof n[p] !== 'object' || n[p] === null) n[p] = {}; n = n[p]; } if (v === null) delete n[path[path.length - 1]]; else n[path[path.length - 1]] = v; };
    for (const [path, v] of leaves) apply(path, v);
    for (const [path, v] of leaves) {
      const old = get(team, path); const [col, key] = path; const nv = v === null ? undefined : v;
      let ok = false;
      if (col === 'meta') ok = old === undefined && nv && nv.by === uid;
      else if (col === 'secret') ok = old === undefined && typeof nv === 'string' && nv.length === 12;
      else if (col === 'members') ok = path.length === 2 && key === uid && (nv === undefined || (nv.code === after.secret && nv.name && Number.isFinite(nv.at)));
      else if (!isMember) ok = false;
      else if (['trucks', 'rescues', 'posts', 'tips'].includes(col)) {
        ok = nv !== undefined ? nv.uid === uid && (old === undefined || old.uid === uid) && (col !== 'tips' || old !== undefined || !!get(team, ['rescues', nv.rid])) : !!old && old.uid === uid;
        if (nv !== undefined && col === 'trucks') ok = ok && Number.isFinite(nv.exp) && String(nv.carrierName || '').length <= 80;
        if (nv !== undefined && col === 'posts') ok = ok && String(nv.text || '').length <= 1200;
      }
      else if (col === 'tstat') ok = nv !== undefined ? nv.by === uid && key.endsWith('__' + uid.slice(0, 20)) && ['open', 'booked', 'withdrawn'].includes(nv.s) && (nv.s !== 'open' || (get(team, ['trucks', nv.id]) || {}).uid === uid) : !!old && old.by === uid;
      else if (col === 'marks') ok = nv !== undefined ? nv.by === uid && (get(team, ['rescues', nv.rid]) || {}).uid === uid : !!old && old.by === uid;
      else if (col === 'lane') ok = path[2] === 'ev' && path.length === 4 && key.endsWith('__' + uid) && (nv === undefined || (nv.u === uid && nv.k && nv.t && nv.o && nv.d));
      if (!ok) { this.denied++; this.netDenied = (this.netDenied || []).concat([method + ' ' + path.join('/')]); return deny(); }
    }
    this.tree.network = this.tree.network || { teams: {} }; this.tree.network.teams = this.tree.network.teams || {}; this.tree.network.teams[T] = after;
    return { status: 200, body: method === 'DELETE' ? null : body };
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
    else r = this.db(req.method(), url.pathname, url.searchParams.get('auth'), req.postData(), url.searchParams);
    return route.fulfill({ status: r.status, headers: { ...cors, 'content-type': 'application/json' }, body: JSON.stringify(r.body) });
  }
}
export const FAKE_CLOUD_CONFIG = { apiKey: 'fake-key', databaseURL: 'https://fs-test-default-rtdb.firebaseio.com', shareUrl: 'https://example.test/FREIGHT-SIGNAL/' };
