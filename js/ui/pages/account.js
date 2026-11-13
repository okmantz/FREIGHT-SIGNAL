// Account Settings: profile + full appearance control. Every control updates the app live and in place (no page re-render),
// so sliders can be dragged smoothly and the preview is the app itself.
import { h, toast, confirmDialog, download, pickFile, readFileText, field } from '../dom.js';
import { actions, state } from '../../store/state.js';
import { icon } from '../icons.js';
import { pageHead, paint } from '../chrome.js';
import {
  SKINS, ACCENTS, BACKGROUNDS, DENSITIES, RADII, SIZES, FONTS, DEFAULTS,
  getAppearance, setAppearance, resetAppearance, exportAppearance, importAppearance, imageFileToDataUrl, resolvedMode,
} from '../appearance.js';
import { TABS } from '../../main.js';
import * as auth from '../../store/auth.js';

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
  const savedHint = h('small', { class: 'muted' }, 'Stored only in this browser. Used for the greeting on Home and the header chip.');
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
  const paintSignin = () => {
    signinBody.textContent = '';
    const a = auth.account();
    if (!a) {
      const email = h('input', { type: 'email', autocomplete: 'email', placeholder: 'you@company.com', 'data-fk': 'acct-email' });
      const pw = h('input', { type: 'password', autocomplete: 'new-password', placeholder: 'At least ' + auth.MIN_PASSWORD + ' characters', 'data-fk': 'acct-pw' });
      const err = h('p', { class: 'autherr', role: 'alert' });
      signinBody.append(
        h('p', { class: 'muted' }, 'No sign-in is set up. Add an e-mail and password so this workspace asks for them when it opens.'),
        h('div', { class: 'grid2' }, field('E-mail', email), field('Password', pw)), err,
        h('button', { class: 'btn primary', type: 'button', 'data-act': 'create-account', onclick: async () => {
          err.textContent = '';
          try { await auth.createAccount(email.value, pw.value, true); toast('Sign-in created.', 'ok'); paintSignin(); rerenderPage(); } catch (e) { err.textContent = e.message || String(e); }
        } }, icon('lock', 15), 'Create sign-in'));
      return;
    }
    signinBody.append(
      row('E-mail', 'The e-mail this workspace is tied to.', h('b', { class: 'mono' }, a.email)),
      row('Change e-mail', 'Needs your password.', h('button', { class: 'btn', type: 'button', onclick: async () => {
        const next = h('input', { type: 'email', value: a.email, 'data-live': '' });
        const { modal } = await import('../dom.js');
        modal({ title: 'Change e-mail', body: h('div', null, field('New e-mail', next)), actions: [{ label: 'Cancel' }, { label: 'Next', kind: 'primary', onClick: async () => {
          if (!auth.isEmail(next.value)) { toast('Enter a valid e-mail address.', 'warn'); return false; }
          const pw = await askPassword('Confirm with your password', 'Enter your password to change the e-mail.');
          if (pw === null) return false;
          try { await auth.changeEmail(pw, next.value); toast('E-mail changed.', 'ok'); paintSignin(); rerenderPage(); } catch (e) { toast(e.message, 'err'); return false; }
        } }] });
      } }, 'Change')),
      row('Change password', 'At least ' + auth.MIN_PASSWORD + ' characters.', h('button', { class: 'btn', type: 'button', onclick: async () => {
        const cur = h('input', { type: 'password', autocomplete: 'current-password' }); const nw = h('input', { type: 'password', autocomplete: 'new-password' });
        const { modal } = await import('../dom.js');
        modal({ title: 'Change password', body: h('div', null, field('Current password', cur), field('New password', nw)), actions: [{ label: 'Cancel' }, { label: 'Change', kind: 'primary', onClick: async () => {
          try { await auth.changePassword(cur.value, nw.value); toast('Password changed.', 'ok'); } catch (e) { toast(e.message, 'err'); return false; }
        } }] });
      } }, 'Change')),
      row('Sign out', 'Locks the workspace until you sign in again.', h('button', { class: 'btn', type: 'button', onclick: () => { auth.signOut(); location.reload(); } }, icon('logout', 15), 'Sign out')),
      row('Remove sign-in', 'Stop asking for a password on this computer. Your data is kept.', h('button', { class: 'btn danger', type: 'button', onclick: async () => {
        const pw = await askPassword('Remove sign-in', 'Enter your password to remove the sign-in.'); if (pw === null) return;
        try { await auth.removeAccount(pw); toast('Sign-in removed.', 'ok'); paintSignin(); rerenderPage(); } catch (e) { toast(e.message, 'err'); }
      } }, 'Remove')),
      h('p', { class: 'muted small' }, 'The sign-in is stored only in this browser (the password is salted and hashed, never sent anywhere) and is included in backups. It is a door lock for this computer, not a vault: your data is not encrypted, and it does not follow you to other devices.'));
  };
  paintSignin();
  const signin = card('signin', 'lock', 'Sign-in & e-mail', auth.account() ? 'Signed in as ' + auth.account().email : 'Tie this workspace to your e-mail and a password.', signinBody);

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
