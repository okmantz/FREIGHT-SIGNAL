// Team hub: the one place to create or join a team, see who is in it, and change team settings. Everything else lives on its own page.
import { h, toast, confirmDialog, copyText, field } from '../dom.js';
import { state, actions } from '../../store/state.js';
import * as net from '../../store/net.js';
import * as cloud from '../../store/cloud.js';
import { pickFolder, folderSupported } from '../../store/netfolder.js';
import { pageHead, emptyState, iconBtn, flash } from '../chrome.js';
import { icon } from '../icons.js';
import { ago } from '../../core/netcommon.js';
import { TTL_OPTIONS } from '../../core/trucks.js';
import { boardSettings, BOARD_LINKS } from '../../core/boards.js';

const STATUS_TEXT = { ok: 'Connected', loading: 'Connecting…', error: 'Problem', reconnect: 'Needs reconnecting', signin: 'Sign in to connect', off: '' };

/** Shown by every team page until a team exists: one clear next step instead of an empty screen. */
export function notJoined(what) {
  const names = { trucks: 'Team Truck Board', rescue: 'Load Rescue', lanes: 'Lane Intel', channels: 'Team Channels' };
  return h('div', null, pageHead({ icon: 'customers', title: names[what] || 'Team', sub: 'Work with your teammates without any setup beyond one click.' }),
    emptyState({ icon: 'customers', title: 'Start or join a team first', text: 'It takes about a minute. Your own loads and carriers stay private.', actions: [iconBtn('customers', 'Set up my team', { class: 'primary', onclick: () => { location.hash = '#/team'; } })] }));
}

function setupPanel() {
  const cloudOk = cloud.enabled() && cloud.user();
  const nameIn = h('input', { class: 'cell', value: '', placeholder: 'e.g. TQL Chicago team', 'aria-label': 'Team name', 'data-live': '1' });
  const codeIn = h('input', { class: 'cell', value: '', placeholder: 'ABCD-EFGH-JKLM-NPQR-STUV', 'aria-label': 'Team code', 'data-live': '1' });
  const err = h('div', { class: 'banner err', hidden: true });
  const fail = (e) => { err.hidden = false; err.textContent = e.message || String(e); };
  const run = async (fn) => { err.hidden = true; try { await fn(); } catch (e) { fail(e); } };
  const folderCard = h('div', { class: 'panel' }, h('h3', null, 'Share through a folder'), h('p', { class: 'muted' }, 'Easiest if your team already shares a network drive or a OneDrive / SharePoint folder. No accounts, no sign-up. Everyone picks the same folder.'),
    !folderSupported() ? h('div', { class: 'banner' }, 'Folders need Chrome or Edge on a computer.') : null,
    h('div', { class: 'toolbar' },
      iconBtn('plus', 'Create team in a folder…', { class: 'primary', disabled: !folderSupported(), 'data-act': 'team-create-folder', onclick: () => run(async () => { const handle = await pickFolder(); if (!handle) return; await net.createTeam({ mode: 'folder', name: nameIn.value, handle }); toast('Team created. Ask teammates to choose Join with this same folder.', 'ok'); }) }),
      iconBtn('customers', 'Join with this folder…', { disabled: !folderSupported(), 'data-act': 'team-join-folder', onclick: () => run(async () => { const handle = await pickFolder(); if (!handle) return; await net.joinTeam({ mode: 'folder', handle }); toast('You are in.', 'ok'); }) })));
  const cloudCard = h('div', { class: 'panel' }, h('h3', null, 'Share through your Freight Signal account'),
    !cloud.enabled() ? h('p', { class: 'muted' }, 'Needs the cloud accounts option from docs/CLOUD-SETUP.md. Until then, use a shared folder.')
      : !cloud.user() ? h('p', { class: 'muted' }, 'Sign in to your account first, then come back here.')
        : h('p', { class: 'muted' }, 'Works from anywhere. Teammates join with a short code.'),
    h('div', { class: 'toolbar' }, iconBtn('plus', 'Create team', { class: 'primary', disabled: !cloudOk, 'data-act': 'team-create-cloud', onclick: () => run(async () => { await net.createTeam({ mode: 'cloud', name: nameIn.value }); toast('Team created. Send the code to your teammates.', 'ok'); }) })),
    h('div', { class: 'toolbar' }, codeIn, iconBtn('customers', 'Join with code', { disabled: !cloudOk, 'data-act': 'team-join-cloud', onclick: () => run(async () => { await net.joinTeam({ mode: 'cloud', code: codeIn.value }); toast('You are in.', 'ok'); }) })));
  // Without cloud accounts there is only one way to share, so show only that one (the other option is explained in a single line).
  const cards = cloud.enabled() ? h('div', { class: 'grid2' }, folderCard, cloudCard) : h('div', null, folderCard, h('p', { class: 'muted small' }, 'Want to share through accounts with a short invite code instead? That needs the cloud accounts option (docs/CLOUD-SETUP.md).'));
  return h('div', null, field('Team name (for a new team)', nameIn), err, cards);
}

function membersPanel() {
  const rows = net.net.members.slice().sort((a, b) => a.name.localeCompare(b.name));
  return h('div', { class: 'panel' }, h('h3', null, `People (${rows.length})`),
    rows.length ? h('div', { class: 'members' }, rows.map(m => h('div', { class: 'member' }, h('span', { class: 'avatar' }, (m.name || '?')[0].toUpperCase()), h('b', null, m.name + (m.uid === net.myUid() ? ' (you)' : '')), h('span', { class: 'muted small' }, m.email), h('span', { class: 'muted small' }, m.seen ? 'active ' + ago(m.seen) : '')))) : h('p', { class: 'muted' }, 'Nobody else yet.'));
}

function settingsPanel() {
  const c = net.net.cfg; const b = boardSettings(state.settings);
  const sel = (key, opts) => { const s = h('select', { class: 'cell', 'aria-label': key }, opts.map(([v, l]) => h('option', { value: String(v), selected: String(v) === String(c[key]) }, l))); s.addEventListener('change', () => net.saveCfg({ [key]: isNaN(Number(s.value)) ? s.value : Number(s.value) })); return s; };
  const share = h('input', { type: 'checkbox', checked: !!c.shareLane, 'data-act': 'share-lane' }); share.addEventListener('change', () => net.saveCfg({ shareLane: share.checked }));
  const bf = (key, label, ph) => { const i = h('input', { class: 'cell', value: b[key] || '', placeholder: ph, 'data-live': '1' }); i.addEventListener('change', () => actions.saveSettings({ boards: { ...(state.settings.boards || {}), [key]: i.value.trim() } })); return field(label, i); };
  return h('div', { class: 'panel' }, h('h3', null, 'Team settings'),
    h('div', { class: 'grid3' }, field('Trucks stay listed for', sel('ttlHours', TTL_OPTIONS.filter(o => o[0] !== 'date').map(([v, l]) => [v, l.replace(' (default)', '')]))), field('Suggest asking for help after', sel('rescueAfterMin', [[45, '45 minutes'], [60, '1 hour'], [90, '90 minutes'], [120, '2 hours']]))),
    h('label', { class: 'check' }, share, ' Share anonymous lane data (lane, rates, carrier name / MC, no customers, no contact details) so everyone gets better rate advice'),
    h('h4', null, 'Your contact on other load boards'), h('p', { class: 'muted small' }, 'Used when you post loads to TruckSmarter or Trucker Path.'),
    h('div', { class: 'grid2' }, bf('contactPhone', 'Phone carriers should call', '(312) 555-0100'), bf('contactEmail', 'E-mail', 'you@tql.com')));
}

export function render() {
  const n = net.net;
  const head = (actions) => pageHead({ icon: 'customers', title: 'Team', sub: 'Shared trucks, load rescue and lane intelligence. Your own database stays yours.', actions });
  if (!net.joined()) return h('div', null, head(), h('div', { class: 'banner ok' }, 'Pick whichever fits: a shared folder needs nothing but a folder everyone can open.'), setupPanel());
  const code = net.invite();
  const status = h('div', { class: 'panel' }, h('h3', null, n.cfg.name || 'Your team'),
    h('p', null, h('span', { class: 'pill ' + (n.status === 'ok' ? 'orig' : 'warn') }, STATUS_TEXT[n.status] || n.status), '  ', n.lastPoll ? h('span', { class: 'muted small' }, 'updated ' + ago(n.lastPoll)) : null, '  ', h('span', { class: 'muted small' }, net.transportKind() === 'folder' || n.cfg.mode === 'folder' ? 'Shared folder' : 'Your account')),
    n.error ? h('div', { class: 'banner err' }, n.error) : null,
    code ? h('div', { class: 'invite' }, h('span', { class: 'muted' }, 'Invite code'), h('code', { 'data-test': 'invite-code' }, code), iconBtn('copy', 'Copy', { onclick: (e) => { copyText(code, 'Code copied.'); flash(e.currentTarget); } })) : h('p', { class: 'muted' }, 'To add people, ask them to choose Join with this folder and pick the same folder.'),
    h('div', { class: 'toolbar' }, n.status === 'reconnect' ? iconBtn('refresh', 'Reconnect', { class: 'primary', onclick: () => net.reconnect().catch(e => toast(e.message, 'err')) }) : iconBtn('refresh', 'Refresh now', { onclick: () => net.refresh() }),
      iconBtn('logout', 'Leave team', { class: 'danger', onclick: async () => { if (await confirmDialog('Leave team', 'You stop seeing the team\'s trucks, requests and lane data. Your own database is not touched.', 'Leave')) await net.leave(); } })));
  const tiles = h('div', { class: 'cards' }, [['truck', 'Team Truck Board', 'trucks', 'Share and find available trucks'], ['sparkle', 'Load Rescue', 'rescue', 'Get help on a stuck load'], ['trendup', 'Lane Intel', 'lanes', 'What actually covers lanes'], ['mail', 'Channels', 'channels', 'Alerts, market talk, general']].map(([ic, t, id, s]) =>
    h('a', { class: 'panel tilelink', href: '#/' + id }, icon(ic, 22), h('b', null, t), h('span', { class: 'muted small' }, s))));
  return h('div', null, head(), status, tiles, membersPanel(), settingsPanel());
}
