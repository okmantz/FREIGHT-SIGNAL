// v14: the two Team Network transports against in-memory stand-ins (a fake Firebase call, a fake folder).
import test from 'node:test';
import assert from 'node:assert/strict';
import { CloudTransport, createTeam, joinTeam } from '../../js/store/netcloud.js';
import { FolderTransport } from '../../js/store/netfolder.js';

/** Minimal RTDB: PUT / PATCH (incl. multi-path keys) / DELETE / GET with orderBy="$key"&startAt. */
function fakeDb() {
  const data = {};
  const walk = (path, make) => { const parts = path.split('/').filter(Boolean); let n = data; for (const p of parts.slice(0, -1)) { if (typeof n[p] !== 'object' || n[p] === null) { if (!make) return [null, null]; n[p] = {}; } n = n[p]; } return [n, parts[parts.length - 1]]; };
  const put = (path, v) => { const [n, k] = walk(path, true); if (v === null) delete n[k]; else n[k] = v; };
  const call = async (method, path, body, query = '') => {
    if (method === 'GET') {
      const [n, k] = walk(path, false); let v = n ? n[k] : null; v = v === undefined ? null : v;
      const m = /startAt=([^&]+)/.exec(query);
      if (m && v) { const s = JSON.parse(decodeURIComponent(m[1])); v = Object.fromEntries(Object.entries(v).filter(([key]) => key >= s)); }
      return v;
    }
    if (method === 'DELETE') return put(path, null);
    if (method === 'PUT') return put(path, body);
    if (method === 'PATCH') { for (const [k, v] of Object.entries(body)) put(path + '/' + k, v); return body; }
  };
  return { data, call };
}

test('cloud: create a team, join with the code, share records, lane shards by month', async () => {
  const f = fakeDb();
  const t = await createTeam({ name: 'Chi', me: { uid: 'u1', name: 'A', email: 'a@x.co' }, call: f.call });
  assert.equal(f.data.network.teams[t.teamId].meta.name, 'Chi'); assert.equal(f.data.network.teams[t.teamId].members.u1.code, t.secret);
  const j = await joinTeam({ code: t.code.toLowerCase(), me: { uid: 'u2', name: 'B', email: 'b@x.co' }, call: f.call });
  assert.equal(j.teamId, t.teamId); assert.equal(j.name, 'Chi'); assert.ok(f.data.network.teams[t.teamId].members.u2);
  await assert.rejects(() => joinTeam({ code: 'nope', me: { uid: 'u3' }, call: f.call }), /not a team code/);
  const a = new CloudTransport(t.teamId, f.call);
  await a.put('trucks', 'k1', { uid: 'u1', carrierName: 'X' });
  assert.deepEqual((await a.list('trucks')).map(r => r.key), ['k1']); await a.remove('trucks', 'k1'); assert.deepEqual(await a.list('trucks'), []);
  await a.lanePutMany('202611__u1', { e1: { id: 'e1', k: 'c' }, e2: { id: 'e2', k: 'i' } });
  await a.lanePutMany('202501__u2', { e3: { id: 'e3', k: 'c' } });
  const lanes = await a.laneList('202606'); assert.deepEqual(lanes.map(l => l.shard), ['202611__u1']); assert.equal(lanes[0].events.length, 2);
});

/* A tiny in-memory directory with the File System Access API surface the folder transport uses. */
class FakeFile { constructor(text) { this.text = text; this.lastModified = 1; } get size() { return this.text.length; } async text_() { return this.text; } }
const mkFile = (store, name) => ({ kind: 'file', name, async getFile() { const f = store.files.get(name); return { size: f.text.length, lastModified: f.mod, text: async () => f.text }; },
  async createWritable() { let buf = ''; return { write: async (t) => { buf = t; }, close: async () => { store.files.set(name, { text: buf, mod: (store.files.get(name)?.mod || 0) + 1 }); } }; } });
function mkDir() {
  const store = { files: new Map(), dirs: new Map() };
  const dir = { kind: 'directory', store,
    async getDirectoryHandle(name, { create } = {}) { if (!store.dirs.has(name)) { if (!create) throw Object.assign(new Error('nf'), { name: 'NotFoundError' }); store.dirs.set(name, mkDir()); } return store.dirs.get(name); },
    async getFileHandle(name, { create } = {}) { if (!store.files.has(name)) { if (!create) throw Object.assign(new Error('nf'), { name: 'NotFoundError' }); store.files.set(name, { text: '', mod: 0 }); } return mkFile(store, name); },
    async removeEntry(name) { if (!store.files.delete(name)) throw Object.assign(new Error('nf'), { name: 'NotFoundError' }); },
    async *entries() { for (const n of store.files.keys()) yield [n, mkFile(store, n)]; } };
  return dir;
}

test('folder: records are one file each; unreadable files are skipped; lane shards merge only my own events', async () => {
  const root = mkDir(); const a = new FolderTransport(root), b = new FolderTransport(root);
  await a.prepare(); assert.equal(await a.readTeam(), null);
  await a.writeTeam({ teamId: 't1', name: 'Chi' }); assert.equal((await b.readTeam()).name, 'Chi');
  await a.put('trucks', 'k/1', { uid: 'u1', carrierName: 'X' });
  assert.deepEqual((await b.list('trucks')).map(r => r.key), ['k_1']);
  (await root.getDirectoryHandle('trucks')).store.files.set('half.json', { text: '{"uid":', mod: 1 });
  assert.equal((await b.list('trucks')).length, 1, 'a half-synced file is ignored, not fatal');
  await a.put('trucks', 'k/1', { uid: 'u1', carrierName: 'Y' });
  assert.equal((await b.list('trucks'))[0].value.carrierName, 'Y', 'the cache notices a changed file');
  await a.remove('trucks', 'k/1'); await a.remove('trucks', 'k/1'); assert.equal((await b.list('trucks')).length, 0);
  await a.lanePutMany('202611__u1', { e1: { id: 'e1' } }); await a.lanePutMany('202611__u1', { e2: { id: 'e2' } });
  await b.lanePutMany('202611__u2', { e9: { id: 'e9' } });
  const all = await b.laneList('202611'); assert.deepEqual(all.map(l => [l.shard, l.events.length]).sort(), [['202611__u1', 2], ['202611__u2', 1]]);
  assert.deepEqual(await b.laneList('202701'), []);
});
