// Team Network storage, shared-folder flavour: no server, no sign-up. Everyone picks the SAME folder (a network drive, or a OneDrive /
// SharePoint folder that syncs to each computer) and the app keeps small JSON files in it:
//
//   <folder>/team.json                     { name, createdAt, by }
//   <folder>/<collection>/<key>.json       one file per record (members, trucks, tstat, rescues, tips, marks, posts)
//   <folder>/lane/<yyyymm__uid>.json       { ev: { <eventId>: event } }   one file per person per month
//
// Every file has exactly ONE writer (the person who created it), so two people can never overwrite each other and file-sync products
// never produce "conflicted copy" files. Anyone who can open the folder is in the team: the folder's own permissions are the access
// control. Uses the File System Access API (Chrome / Edge); the picked folder is remembered per computer.
// Changes show up as fast as the folder syncs (seconds on a network drive, up to a minute or two on OneDrive).

export class FolderError extends Error { constructor(message, code = 'folder') { super(message); this.code = code; } }

const safe = (k) => String(k).replace(/[^A-Za-z0-9_.-]/g, '_');
const COLS = ['members', 'trucks', 'tstat', 'rescues', 'tips', 'marks', 'posts', 'lane'];

export class FolderTransport {
  constructor(root) { this.kind = 'folder'; this.root = root; this.dirs = new Map(); this.cache = new Map(); this.mine = new Map(); }

  async #dir(name) {
    if (!this.dirs.has(name)) this.dirs.set(name, await this.root.getDirectoryHandle(name, { create: true }));
    return this.dirs.get(name);
  }
  async #write(dir, file, text) {
    for (let attempt = 0; ; attempt++) {
      try { const fh = await dir.getFileHandle(file, { create: true }); const w = await fh.createWritable(); await w.write(text); await w.close(); return; }
      catch (e) { if (attempt >= 1 || (e && e.name === 'NotAllowedError')) throw this.#wrap(e); await new Promise(r => setTimeout(r, 250)); }
    }
  }
  #wrap(e) {
    if (e && (e.name === 'NotAllowedError' || e.name === 'SecurityError')) return new FolderError('Freight Signal no longer has access to the shared folder. Click Reconnect.', 'permission');
    if (e && e.name === 'NotFoundError') return new FolderError('The shared folder could not be found. Is the network drive connected?', 'missing');
    return e;
  }

  /** Make sure the standard sub-folders exist (creating a team, or joining one on a fresh folder). */
  async prepare() { try { for (const c of COLS) await this.#dir(c); } catch (e) { throw this.#wrap(e); } }

  async readTeam() {
    try { const fh = await this.root.getFileHandle('team.json'); return JSON.parse(await (await fh.getFile()).text()); }
    catch (e) { if (e && e.name === 'NotFoundError') return null; if (e instanceof SyntaxError) return null; throw this.#wrap(e); }
  }
  async writeTeam(info) { try { await this.#write(this.root, 'team.json', JSON.stringify(info)); } catch (e) { throw this.#wrap(e); } }
  async meta() { return this.readTeam(); }

  async list(col) {
    let dir; try { dir = await this.#dir(col); } catch (e) { throw this.#wrap(e); }
    const out = [], seen = new Set();
    try {
      for await (const [name, h] of dir.entries()) {
        if (!h || h.kind !== 'file' || !name.endsWith('.json')) continue;
        const ck = col + '/' + name; seen.add(ck);
        const f = await h.getFile(); const sig = f.size + ':' + f.lastModified;
        const hit = this.cache.get(ck);
        if (hit && hit.sig === sig) { out.push(hit.item); continue; }
        try { const item = { key: name.slice(0, -5), value: JSON.parse(await f.text()) }; this.cache.set(ck, { sig, item }); out.push(item); }
        catch { /* a file that is still being synced: pick it up on the next round */ }
      }
    } catch (e) { throw this.#wrap(e); }
    for (const k of [...this.cache.keys()]) if (k.startsWith(col + '/') && !seen.has(k)) this.cache.delete(k);
    return out;
  }
  async put(col, key, value) {
    try { await this.#write(await this.#dir(col), safe(key) + '.json', JSON.stringify(value)); } catch (e) { throw this.#wrap(e); }
    this.cache.delete(col + '/' + safe(key) + '.json');
  }
  async remove(col, key) {
    try { await (await this.#dir(col)).removeEntry(safe(key) + '.json'); }
    catch (e) { if (!(e && e.name === 'NotFoundError')) throw this.#wrap(e); }
    this.cache.delete(col + '/' + safe(key) + '.json');
  }
  async laneList(sinceMonth) {
    const out = [];
    for (const { key, value } of await this.list('lane')) {
      if (key.split('__')[0] < sinceMonth) continue;
      out.push({ shard: key, events: Object.entries((value && value.ev) || {}).map(([id, e]) => ({ ...e, id: e && e.id ? e.id : id })) });
    }
    return out;
  }
  async lanePutMany(shard, events) {
    let cur = this.mine.get(shard);
    if (!cur) { const own = (await this.list('lane')).find(x => x.key === shard); cur = { ev: { ...((own && own.value && own.value.ev) || {}) } }; }
    cur = { ev: { ...cur.ev, ...events } };
    await this.put('lane', shard, cur);
    this.mine.set(shard, cur);
  }
}

/* ------------------------------------------------------------------------------------------------ browser glue */
export const folderSupported = () => typeof globalThis.showDirectoryPicker === 'function';

/** Ask the person for the shared folder (must be called from a click). */
export async function pickFolder() {
  if (!folderSupported()) throw new FolderError('This browser cannot use a shared folder. Use Chrome or Edge.', 'unsupported');
  try { return await globalThis.showDirectoryPicker({ id: 'freight-signal-team', mode: 'readwrite' }); }
  catch (e) { if (e && e.name === 'AbortError') return null; throw e; }
}

/** 'granted' | 'prompt' | 'denied' for a remembered handle. */
export async function folderPermission(handle, request = false) {
  if (!handle) return 'denied';
  try {
    const opts = { mode: 'readwrite' };
    let p = handle.queryPermission ? await handle.queryPermission(opts) : 'granted';
    if (p !== 'granted' && request && handle.requestPermission) p = await handle.requestPermission(opts);
    return p;
  } catch { return 'denied'; }
}
