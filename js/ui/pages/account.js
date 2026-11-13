// Account Settings: profile + full appearance control. Every control updates the app live and in place (no page re-render),
// so sliders can be dragged smoothly and the preview is the app itself.
import { h, toast, modal, confirmDialog, download, pickFile, readFileText, field, copyText } from '../dom.js';
import { actions, state } from '../../store/state.js';
import { icon } from '../icons.js';
import { pageHead, paint } from '../chrome.js';
import {
  SKINS, ACCENTS, BACKGROUNDS, DENSITIES, RADII, SIZES, FONTS, DEFAULTS,
  getAppearance, setAppearance, resetAppearance, exportAppearance, importAppearance, imageFileToDataUrl, resolvedMode,
} from '../appearance.js';
import { TABS } from '../../main.js';
import * as auth from '../../store/auth.js';
import * as cloud from '../../store/cloud.js';
import * as local from '../../store/localacct.js';

const A = () => getAppearance();

/** Segmented (radio-like) button group. `sync` re-reads the current value when appearance changes elsewhere. */
function seg(options, get, set) {
  const wrap = h('div', { class: 'seg', role: 'group' });
  const btns = options.map(([val, label, ic]) => {
    const b = h('button', { type: 'button', 'aria-pressed': 'false', onclick: () => { set(val); refresh(); } }, ic ? icon(ic, 15) : null, label);
    b.dataset.val = val; wrap.appendChild(b); return b;
  });
  const refresh = () => btns.forEach(b => b.setAttribute('aria-pressed', String(b.dataset.val === String(get()))));
  refresh(); wrap.refresh = refresh; return wrap;
}

function toggle(get, set) {
  const input = h('input', { type: 'checkbox', checked: !!get() });
  input.addEventListener('change', () => set(input.checked));
  const w = h('span', { class: 'switch' }, input, h('i'));
  w.refresh = () => { input.checked = !!get(); };
  return w;
}

function slider(min, max, get, set, unit = '', step = 1) {
  const out = h('output', null, get() + unit);
  const input = h('input', { type: 'range', min, max, step, value: get() });
  input.addEventListener('input', () => { out.textContent = input.value + unit; set(Number(input.value)); });
  const w = h('div', { class: 'slider' }, input, out);
  w.refresh = () => { input.value = get(); out.textContent = get() + unit; };
  return w;
}

const row = (title, hint, control) => h('div', { class: 'set-row' }, h('div', { class: 'sl' }, h('b', null, title), hint ? h('small', { class: 'muted' }, hint) : null), control);
const sub = (t) => h('div', { class: 'set-sub' }, t);
/** Settings sections are collapsed <details>; which ones are open is remembered while the app stays open. */
const openSecs = new Set();
const card = (id, ic, title, text, ...kids) => {
  const d = h('details', { class: 'set-card', id: 'acct-' + id, open: openSecs.has(id) },
    h('summary', null, h('span', { class: 'si' }, icon(ic, 21)), h('div', { class: 'st' }, h('h3', null, title), h('p', null, text)), h('span', { class: 'sect-ch' }, icon('chevdown', 18))),
    h('div', { class: 'set-body' }, ...kids));
  d.addEventListener('toggle', () => { if (d.open) openSecs.add(id); else openSecs.delete(id); });
  return d;
};

const rerenderPage = () => import('../../main.js').then(m => { m.render(); m.renderChrome && m.renderChrome(); });
const askPassword = (title, text, label = 'Password') => new Promise((resolve) => {
  const pw = h('input', { type: 'password', autocomplete: 'current-password', 'data-live': '' });
  import('../dom.js').then(({ modal }) => modal({ title, body: h('div', null, h('p', { class: 'muted' }, text), field(label, pw)),
    actions: [{ label: 'Cancel', onClick: () => resolve(null) }, { label: 'Continue', kind: 'primary', onClick: () => resolve(pw.value) }], onClose: () => resolve(null) }));
  setTimeout(() => pw.focus(), 60);
});

export function render() {
  const live = [];                   // controls that need refreshing when the user resets / imports
  const track = (el) => { live.push(el); return el; };
  const refreshAll = () => { live.forEach(el => el.refresh && el.refresh()); };

  /* ------------------------------------------------------------------------------------------- profile */
  const pf = { name: '', title: '', company: '', startPage: 'home', ...(state.settings.profile || {}) };
  const savedHint = h('small', { class: 'muted' }, cloud.storedWhere() + ' Used for the greeting on Home and the header chip.');
  let t = 0;
  const saveProfile = (patch) => {
    Object.assign(pf, patch);
    clearTimeout(t);
    t = setTimeout(async () => {
      await actions.savePrefs({ profile: { ...pf } });
      import('../../main.js').then(m => m.renderChrome && m.renderChrome());
    }, 250);
  };
  const txt = (key, ph) => { const i = h('input', { value: pf[key], placeholder: ph, maxlength: 60, autocomplete: 'off' }); i.addEventListener('input', () => saveProfile({ [key]: i.value.trim() })); return i; };
  const startSel = h('select', null, TABS.map(x => h('option', { value: x.id, selected: x.id === pf.startPage }, x.label)));
  startSel.addEventListener('change', () => saveProfile({ startPage: startSel.value }));
  const avatar = h('div', { class: 'avatar lg' });
  const paintAvatar = () => { avatar.textContent = ''; const p = String(pf.name || '').trim().split(/\s+/).filter(Boolean); avatar.append(p.length ? (p[0][0] + (p.length > 1 ? p[p.length - 1][0] : '')).toUpperCase() : icon('user', 34)); };
  paintAvatar();
  const nameIn = txt('name', 'Your name'); nameIn.addEventListener('input', paintAvatar);
  const profile = card('profile', 'user', 'Profile', 'Who is using this workspace.',
    h('div', { class: 'profile-grid' }, avatar,
      h('div', { class: 'fields' },
        field('Name', nameIn), field('Role / title', txt('title', 'e.g. Freight Broker')),
        field('Company', txt('company', 'Optional')), field('Open the app on', startSel),
        h('div', { class: 'wide' }, savedHint))));

  /* ----------------------------------------------------------------------------------------- sign-in */
  const signinBody = h('div', null);
  /* Local accounts (no cloud set up): each person has an account on THIS computer, with their own private data. */
  const installRow = () => row('Install on this computer', 'Opens Freight Signal in its own window with a desktop icon, and keeps working offline.', h('button', { class: 'btn', type: 'button', onclick: async () => {
    const inst = await import('../install.js');
    if (inst.isInstalled()) { toast('Freight Signal is already installed on this computer.', 'info'); return; }
    if (inst.canInstall()) { if (await inst.install()) toast('Installed. Look for Freight Signal in your Start menu or Applications.', 'ok', 7000); return; }
    toast('In Chrome or Edge, open the browser menu and choose Install Freight Signal (under Save and share, Apps or Cast, save, and share). Or open dist/freight-signal.html from disk.', 'info', 12000);
  } }, icon('download', 15), 'Install app'));
  const paintLocal = () => {
    signinBody.textContent = '';
    const u = local.user(); if (!u) return;
    const doSignOut = () => { local.signOut(); location.reload(); };
    signinBody.append(
      row('Signed in as', 'An account on this computer. Anyone else who uses this browser creates their own.', h('b', { class: 'mono' }, u.email)),
      row('Where your data is', 'Saved in this browser on this computer only, under this account. Download a backup (System page) to keep a copy or move to another computer.', h('a', { class: 'btn', href: '#/system' }, icon('database', 15), 'Backup')),
      installRow(),
      row('Change password', 'At least ' + auth.MIN_PASSWORD + ' characters.', h('button', { class: 'btn', type: 'button', onclick: async () => {
        const cur = h('input', { type: 'password', autocomplete: 'current-password', 'data-live': '' }); const nw = h('input', { type: 'password', autocomplete: 'new-password', 'data-live': '' });
        modal({ title: 'Change password', body: h('div', null, field('Current password', cur), field('New password', nw)), actions: [{ label: 'Cancel' }, { label: 'Change', kind: 'primary', onClick: async () => {
          try { await local.changePassword(cur.value, nw.value); toast('Password changed.', 'ok'); } catch (e) { toast(e.message, 'err'); return false; }
        } }] });
      } }, 'Change')),
      row('Sign out', 'Returns to the sign-in screen. Your data stays on this computer.', h('button', { class: 'btn', type: 'button', onclick: doSignOut }, icon('logout', 15), 'Sign out')),
      row('Delete my account', 'Permanently removes this account and all of its data from this computer. This cannot be undone.', h('button', { class: 'btn danger', type: 'button', onclick: async () => {
        const pw = await askPassword('Delete account', 'This permanently deletes this account and all of its loads, carriers, customers and settings from this computer. Download a backup first if you might need them. Enter your password to confirm.'); if (pw === null) return;
        try { await local.deleteAccount(pw); toast('Account deleted.', 'ok'); setTimeout(() => location.reload(), 800); } catch (e) { toast(e.message, 'err', 8000); }
      } }, 'Delete')),
      h('p', { class: 'muted small' }, 'The password is kept only as a salted hash and is never sent anywhere. It keeps other people at this keyboard out of your workspace, but it is a door lock, not a vault: the data itself is not encrypted. Want accounts that follow you across computers? See docs/CLOUD-SETUP.md.'));
  };
  /* Cloud accounts (js/config.js is filled in): a real account, saved to the cloud, shareable by link. */
  let unsubStatus = null;
  const paintCloud = () => {
    signinBody.textContent = '';
    const u = cloud.user(); if (!u) return;
    const statEl = h('b', null);
    const paintStat = () => {
      const st = cloud.getStatus();
      const when = st.lastSync ? ' Last checked ' + new Date(st.lastSync).toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' }) + '.' : '';
      statEl.textContent = st.status === 'synced' ? 'Saved to your account.' + when : st.status === 'saving' ? 'Saving…' : st.status === 'offline' ? 'Offline. ' + st.detail : st.status === 'error' ? 'Problem: ' + st.detail : 'Starting…';
      statEl.className = st.status === 'error' || st.status === 'offline' ? 'warnText' : '';
    };
    paintStat();
    if (unsubStatus) unsubStatus();
    unsubStatus = cloud.onStatus(() => { if (statEl.isConnected) paintStat(); });
    const link = h('input', { value: cloud.shareUrl(), readOnly: true, 'aria-label': 'Invite link', 'data-live': '', onfocus: (e) => e.target.select() });
    const syncBtn = h('button', { class: 'btn', type: 'button', onclick: async () => { syncBtn.disabled = true; await cloud.syncNow(); syncBtn.disabled = false; paintStat(); } }, icon('refresh', 15), 'Sync now');
    const doSignOut = async (clearDevice) => {
      toast('Saving your changes, then signing out…', 'info', 6000);
      try { await cloud.signOut({ clearDevice }); } catch (e) { toast(e.message || String(e), 'err', 9000); return; }
      location.reload();
    };
    signinBody.append(
      row('Signed in as', 'Your own private account.', h('b', { class: 'mono' }, u.email)),
      row('Cloud sync', 'Every change is saved to your account automatically and also kept on this device, so the app works offline.', h('div', { class: 'sync-row' }, statEl, ' ', syncBtn)),
      row('Invite people', 'Send this link. Each person creates their own account; their loads, carriers, customers and settings stay private to them.',
        h('div', { class: 'sync-row' }, link, ' ', h('button', { class: 'btn primary', type: 'button', onclick: () => copyText(link.value, 'Invite link copied.') }, icon('copy', 15), 'Copy link'))),
      installRow(),
      row('Change password', 'At least ' + auth.MIN_PASSWORD + ' characters.', h('button', { class: 'btn', type: 'button', onclick: async () => {
        const cur = h('input', { type: 'password', autocomplete: 'current-password', 'data-live': '' }); const nw = h('input', { type: 'password', autocomplete: 'new-password', 'data-live': '' });
        modal({ title: 'Change password', body: h('div', null, field('Current password', cur), field('New password', nw)), actions: [{ label: 'Cancel' }, { label: 'Change', kind: 'primary', onClick: async () => {
          try { await cloud.changePassword(cur.value, nw.value); toast('Password changed. Other devices will ask you to sign in again.', 'ok', 7000); } catch (e) { toast(e.message, 'err'); return false; }
        } }] });
      } }, 'Change')),
      row('Forgot your password?', 'Sends a reset link to ' + u.email + '.', h('button', { class: 'btn', type: 'button', onclick: async () => {
        try { await cloud.sendReset(u.email); toast('Reset link sent. Check your inbox (and spam).', 'ok', 7000); } catch (e) { toast(e.message, 'err'); }
      } }, 'E-mail me a link')),
      row('Sign out', 'Uploads anything unsaved, then returns to the sign-in screen.', h('button', { class: 'btn', type: 'button', onclick: () => doSignOut(false) }, icon('logout', 15), 'Sign out')),
      row('Sign out and remove this device\'s copy', 'Use on a shared or public computer. Your data stays safe in your account.', h('button', { class: 'btn', type: 'button', onclick: async () => {
        if (await confirmDialog('Remove this device\'s copy?', 'This signs you out and deletes the copy of your data cached in this browser. Nothing is lost from your account.', 'Sign out and remove')) doSignOut(true);
      } }, 'Sign out and remove')),
      row('Delete my account', 'Permanently deletes the account and everything saved in it. This cannot be undone.', h('button', { class: 'btn danger', type: 'button', onclick: async () => {
        const pw = await askPassword('Delete account', 'This permanently deletes your account and all of your saved loads, carriers, customers and settings. Enter your password to confirm.'); if (pw === null) return;
        try { await cloud.deleteAccount(pw); toast('Account deleted.', 'ok'); setTimeout(() => location.reload(), 800); } catch (e) { toast(e.message, 'err', 8000); }
      } }, 'Delete')),
      h('p', { class: 'muted small' }, 'Your data lives in this site\'s Firebase project, behind your sign-in: the database only lets you open your own account\'s data. If you edit the same list on two devices at the same moment, the most recent save wins.'));
  };
  const paintSignin = () => {
    if (cloud.enabled()) { paintCloud(); return; }
    paintLocal();
  };
  paintSignin();
  const signin = card('signin', 'lock', cloud.enabled() ? 'Account & sync' : 'Account', cloud.enabled() ? (cloud.user() ? 'Signed in as ' + cloud.user().email : '') : (local.user() ? 'Signed in as ' + local.user().email : ''), signinBody);

  /* --------------------------------------------------------------------------------------------- theme */
  const skinTiles = SKINS.map(s => {
    const prev = h('div', { class: 'skin-prev', 'data-skin': s.id, 'data-theme': resolvedMode() },
      h('div', { class: 'sp-top' }, h('i'), h('i')), h('div', { class: 'sp-side' }, h('i'), h('i'), h('i')),
      h('div', { class: 'sp-main' }, h('div', { class: 'a' }), h('div', { class: 'b' }, h('i'))));
    const b = h('button', { type: 'button', class: 'skin-tile', 'aria-pressed': 'false', onclick: () => { setAppearance({ skin: s.id }); refreshAll(); } },
      prev, h('span', { class: 'cap' }, h('b', null, s.label), h('small', { class: 'muted' }, s.blurb)));
    b.refresh = () => { b.setAttribute('aria-pressed', String(A().skin === s.id)); prev.setAttribute('data-theme', resolvedMode()); };
    b.refresh(); return track(b);
  });

  const customIn = h('input', { type: 'color', class: 'offscreen', value: A().accentHex, 'aria-label': 'Custom accent colour' });
  const swatches = h('div', { class: 'swatches' });
  const mkSwatch = (cls, label, onPick, id, color) => {
    const b = h('button', { type: 'button', class: 'swatch ' + cls, title: label, 'aria-label': label, 'aria-pressed': 'false', onclick: onPick });
    if (color) paint(b, { background: color, '--sw': color });
    b.refresh = () => b.setAttribute('aria-pressed', String(A().accent === id));
    b.refresh(); track(b); swatches.appendChild(b); return b;
  };
  mkSwatch('auto', 'Theme default', () => { setAppearance({ accent: 'auto' }); refreshAll(); }, 'auto');
  ACCENTS.forEach(ac => mkSwatch('', ac.label, () => { setAppearance({ accent: ac.id }); refreshAll(); }, ac.id, ac.dark));
  const customSw = mkSwatch('custom', 'Custom colour', () => customIn.click(), 'custom');
  customIn.addEventListener('input', () => { setAppearance({ accent: 'custom', accentHex: customIn.value }); refreshAll(); });
  swatches.appendChild(customIn);
  track({ refresh: () => { customIn.value = A().accentHex; } });

  const strip = h('div', { class: 'preview-strip' },
    h('button', { class: 'btn primary', type: 'button' }, 'Primary'), h('button', { class: 'btn', type: 'button' }, 'Secondary'),
    h('button', { class: 'btn ghost', type: 'button' }, 'Ghost'), h('span', { class: 'pill' }, 'Pill'), h('span', { class: 'pill warn' }, 'Warning'),
    h('a', { href: '#/account', onclick: (e) => e.preventDefault() }, 'Link text'));

  const theme = card('theme', 'palette', 'Theme & colour', 'Pick an interface theme, light or dark, and an accent colour.',
    sub('Mode'),
    row('Colour mode', 'Auto follows your device.', track(seg([['dark', 'Dark', 'moon'], ['light', 'Light', 'sun'], ['auto', 'Auto', 'sliders']], () => A().mode, (v) => { setAppearance({ mode: v }); refreshAll(); }))),
    sub('Interface theme'), h('div', { class: 'tile-grid' }, skinTiles),
    sub('Accent colour'), swatches, strip);

  /* ------------------------------------------------------------------------------------------ background */
  const groups = [...new Set(BACKGROUNDS.map(b => b.group))];
  const imgInfo = h('small', { class: 'muted' }, '');
  const drop = h('div', { class: 'drop' });
  const thumb = h('div', { class: 'thumb' });
  const refreshDrop = () => {
    drop.classList.toggle('has', !!A().image);
    imgInfo.textContent = A().image ? 'Your image is stored only in this browser (included in backups).' : 'JPG, PNG or WebP. It is resized and kept only in this browser.';
  };
  const chooseImage = async () => {
    const f = await pickFile('image/*'); if (!f) return;
    try { const url = await imageFileToDataUrl(f); setAppearance({ image: url, bg: 'image' }); refreshAll(); toast('Background image set.', 'ok'); }
    catch (e) { toast(e.message, 'err', 7000); }
  };
  drop.append(thumb, h('div', { class: 'sl' }, h('b', null, 'Your own picture'), imgInfo),
    h('button', { class: 'btn small primary', type: 'button', onclick: chooseImage }, icon('upload', 15), 'Choose image'),
    h('button', { class: 'btn small', type: 'button', onclick: () => { setAppearance({ image: '', bg: A().bg === 'image' ? DEFAULTS.bg : A().bg }); refreshAll(); } }, icon('trash', 15), 'Remove'));
  track({ refresh: refreshDrop }); refreshDrop();

  const bgTiles = groups.map(g => h('div', null, sub(g), h('div', { class: 'tile-grid' }, BACKGROUNDS.filter(b => b.group === g).map(b => {
    const prev = h('div', { class: 'bg-prev' }, b.photo === false ? h('div', { class: 'bg-art art-' + b.id }) : h('div', { class: 'bg-thumb t-' + b.id }), b.fx ? h('span', { class: 'bg-lock' }, 'Animated') : null);
    const tile = h('button', { type: 'button', class: 'bg-tile', 'aria-pressed': 'false', onclick: () => { if (b.id === 'image' && !A().image) return chooseImage(); setAppearance({ bg: b.id }); refreshAll(); } },
      prev, h('span', { class: 'cap' }, h('b', null, b.label), h('small', { class: 'muted' }, b.blurb)));
    tile.refresh = () => tile.setAttribute('aria-pressed', String(A().bg === b.id));
    tile.refresh(); return track(tile);
  }))));

  const gradA = h('input', { type: 'color', value: A().gradA, 'aria-label': 'Gradient start colour' });
  const gradB = h('input', { type: 'color', value: A().gradB, 'aria-label': 'Gradient end colour' });
  gradA.addEventListener('input', () => { setAppearance({ gradA: gradA.value, bg: 'gradient' }); refreshAll(); });
  gradB.addEventListener('input', () => { setAppearance({ gradB: gradB.value, bg: 'gradient' }); refreshAll(); });
  const gradAngle = track(slider(0, 360, () => A().gradAngle, (v) => setAppearance({ gradAngle: v, bg: 'gradient' }), '°'));
  track({ refresh: () => { gradA.value = A().gradA; gradB.value = A().gradB; } });

  const background = card('background', 'image', 'Background', 'Scenes, seasons, your own gradient or picture.',
    bgTiles,
    sub('Custom gradient'),
    h('div', { class: 'grad-row' }, field('Start', gradA), field('End', gradB), field('Angle', gradAngle)),
    sub('Your image'), drop,
    sub('Fine tuning'),
    row('Animated scenes', 'Falling leaves, snow, petals, rain and more over the photo. Pauses when the tab is hidden; off for reduced-motion.', track(toggle(() => A().motion, (v) => setAppearance({ motion: v })))),
    row('Dim the background', 'Darker backgrounds make text easier to read.', track(slider(0, 85, () => A().dim, (v) => setAppearance({ dim: v }), '%'))),
    row('Blur the background', 'Soften the scene behind the app.', track(slider(0, 14, () => A().blur, (v) => setAppearance({ blur: v }), 'px'))),
    row('Panel opacity', 'Lower values let more of the background show through.', track(slider(40, 100, () => A().glass, (v) => setAppearance({ glass: v }), '%'))),
    row('Frosted glass', 'Blur what is behind panels.', track(toggle(() => A().glassBlur, (v) => setAppearance({ glassBlur: v })))));

  /* ------------------------------------------------------------------------------------------- layout */
  const layout = card('layout', 'layers', 'Layout & type', 'Density, corners, text and the sidebar.',
    row('Density', 'How much breathing room panels and rows have.', track(seg(DENSITIES, () => A().density, (v) => setAppearance({ density: v })))),
    row('Corner style', null, track(seg(RADII, () => A().radius, (v) => setAppearance({ radius: v })))),
    row('Text size', null, track(seg(SIZES, () => A().size, (v) => setAppearance({ size: v })))),
    row('Typeface', FONTS.find(f => f[0] === A().font)?.[2] || '', track(seg(FONTS.map(f => [f[0], f[1]]), () => A().font, (v) => setAppearance({ font: v })))),
    row('Sidebar', 'Compact shows icons only.', track(seg([['full', 'Full'], ['compact', 'Compact']], () => A().sidebar, (v) => setAppearance({ sidebar: v })))),
    row('Striped table rows', null, track(toggle(() => A().zebra, (v) => setAppearance({ zebra: v })))),
    row('Show product tagline', 'The “Intelligent Carrier Sourcing Optimization System” line in the header.', track(toggle(() => A().tagline, (v) => setAppearance({ tagline: v })))));

  /* -------------------------------------------------------------------------------------------- backup */
  const backup = card('backup', 'database', 'Backup & reset', 'Move your look to another computer, or start over.',
    row('Export appearance', 'Saves your theme choices as a small file (without a background picture).',
      h('button', { class: 'btn', type: 'button', onclick: () => download('freight-signal-appearance.json', JSON.stringify(exportAppearance(), null, 2), 'application/json') }, icon('download', 15), 'Export')),
    row('Import appearance', 'Load a file exported from this page.',
      h('button', { class: 'btn', type: 'button', onclick: async () => {
        const f = await pickFile('.json'); if (!f) return;
        try { importAppearance(JSON.parse(await readFileText(f))); refreshAll(); toast('Appearance imported.', 'ok'); } catch (e) { toast(e.message || 'That file could not be read.', 'err', 7000); }
      } }, icon('upload', 15), 'Import')),
    row('Reset appearance', 'Back to the default look. Your data is not touched.',
      h('button', { class: 'btn danger', type: 'button', onclick: async () => {
        if (!(await confirmDialog('Reset appearance', 'Reset every theme, colour, background and layout choice to the defaults?', 'Reset'))) return;
        resetAppearance(); refreshAll(); toast('Appearance reset.', 'ok');
      } }, icon('refresh', 15), 'Reset')),
    row('Carrier data, backups and the Outlook bridge', 'Those live on the System page.',
      h('a', { class: 'btn', href: '#/system' }, icon('system', 15), 'Open System')));

  /* --------------------------------------------------------------------------------------------- page */
  const sections = [['signin', 'lock', 'Sign-in'], ['profile', 'user', 'Profile'], ['theme', 'palette', 'Theme & colour'], ['background', 'image', 'Background'], ['layout', 'layers', 'Layout & type'], ['backup', 'database', 'Backup & reset']];
  const toc = h('div', { class: 'acct-toc' }, sections.map(([id, ic, label]) =>
    h('button', { type: 'button', onclick: () => { const el = document.getElementById('acct-' + id); if (el) { el.open = true; el.scrollIntoView({ behavior: 'smooth', block: 'start' }); } } }, icon(ic, 15), label)));

  return h('div', null,
    pageHead({ icon: 'palette', title: 'Account Settings', sub: 'Sign-in, profile and look. Open a section to change it; changes apply instantly.' }),
    toc, signin, profile, theme, background, layout, backup);
}
