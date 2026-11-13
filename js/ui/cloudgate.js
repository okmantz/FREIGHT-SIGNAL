// The cloud sign-in screen: "Sign in" and "Create account" in one card, shown before the app when this site has cloud accounts
// switched on (js/config.js) and nobody is signed in. Resolves once the person is in. Logic lives in store/cloud.js.
import { h, modal, toast } from './dom.js';
import { icon } from './icons.js';
import * as cloud from '../store/cloud.js';
import * as local from '../store/localacct.js';

const root = () => document.documentElement;

function passwordField(label, name, autocomplete, onEnter) {
  const input = h('input', { type: 'password', name, autocomplete, required: true, 'aria-label': label, placeholder: label, 'data-live': '' });
  const eye = h('button', { class: 'pw-eye', type: 'button', tabindex: '-1', 'aria-label': 'Show or hide the password', title: 'Show / hide', onclick: () => { input.type = input.type === 'password' ? 'text' : 'password'; input.focus(); } }, icon('eye', 16));
  if (onEnter) input.addEventListener('keydown', (e) => { if (e.key === 'Enter') { e.preventDefault(); onEnter(); } });
  return { input, el: h('label', { class: 'af' }, h('span', null, label), h('div', { class: 'pw' }, input, eye)) };
}

function forgotLocal(prefill) {
  const em = h('input', { type: 'email', placeholder: 'you@company.com', 'aria-label': 'Account e-mail', value: prefill || '', 'data-live': '' });
  const pw = h('input', { type: 'password', autocomplete: 'new-password', placeholder: 'New password', 'aria-label': 'New password', 'data-live': '' });
  const err = h('p', { class: 'autherr', role: 'alert' });
  let m;
  const go = async () => {
    err.textContent = '';
    try { await local.resetPassword(em.value, pw.value); m.close(); toast('Password reset. Sign in with the new password.', 'ok', 7000); }
    catch (e) { err.textContent = e.message || String(e); }
  };
  m = modal({
    title: 'Forgot your password?',
    body: h('div', null,
      h('p', null, 'Accounts on this computer are kept only on this computer, so there is no e-mail link. Type the account\'s e-mail and choose a new password. Your loads, carriers and settings are kept.'),
      h('p', { class: 'muted' }, 'Anyone at this computer can do this, so treat the sign-in as a door lock, not a vault.'), em, pw, err),
    actions: [{ label: 'Cancel' }, { label: 'Reset password', kind: 'primary', keepOpen: true, onClick: go }],
  });
  setTimeout(() => em.focus(), 40);
}

function forgot(prefill) {
  const inp = h('input', { type: 'email', placeholder: 'you@company.com', 'aria-label': 'Account e-mail', value: prefill || '', 'data-live': '' });
  const err = h('p', { class: 'autherr', role: 'alert' });
  let m;
  const go = async () => {
    err.textContent = '';
    try { await cloud.sendReset(inp.value); m.close(); toast('If that address has an account, a reset link is on its way. Check your spam folder too.', 'ok', 9000); }
    catch (e) { err.textContent = e.message || String(e); }
  };
  inp.addEventListener('keydown', (e) => { if (e.key === 'Enter') { e.preventDefault(); go(); } });
  m = modal({
    title: 'Reset your password',
    body: h('div', null, h('p', null, 'Enter the e-mail address of your account. We will send you a link to choose a new password. Your data is kept.'), inp, err),
    actions: [{ label: 'Cancel' }, { label: 'Send reset link', kind: 'primary', keepOpen: true, onClick: go }],
  });
  setTimeout(() => inp.focus(), 40);
}

function card(mode, done, setMode, B, isLocal) {
  const creating = mode === 'create';
  const email = h('input', { type: 'email', name: 'email', autocomplete: 'username', required: true, placeholder: 'you@company.com', 'aria-label': 'E-mail', 'data-live': '', spellcheck: 'false' });
  const submit = h('button', { class: 'btn primary authbtn', type: 'submit' }, creating ? 'Create account' : 'Sign in');
  const err = h('p', { class: 'autherr', role: 'alert' });
  const keep = h('input', { type: 'checkbox', checked: true, 'data-live': '' });
  let pw2 = null;
  const run = async () => {
    err.textContent = '';
    if (!B.isEmail(email.value)) { err.textContent = 'Enter a valid e-mail address.'; email.focus(); return; }
    if (creating) {
      const bad = B.passwordProblem(pw.input.value);
      if (bad) { err.textContent = bad; pw.input.focus(); return; }
      if (pw.input.value !== pw2.input.value) { err.textContent = 'The two passwords do not match.'; pw2.input.focus(); return; }
    }
    submit.disabled = true; submit.textContent = creating ? 'Creating your account…' : 'Signing in…';
    try {
      if (creating) await B.signUp(email.value, pw.input.value, keep.checked); else await B.signIn(email.value, pw.input.value, keep.checked);
      done();
    } catch (e) {
      err.textContent = e.message || String(e); submit.disabled = false; submit.textContent = creating ? 'Create account' : 'Sign in';
      if (!creating) pw.input.select();
    }
  };
  const pw = passwordField(creating ? 'Create a password' : 'Password', 'password', creating ? 'new-password' : 'current-password', creating ? null : run);
  if (creating) pw2 = passwordField('Confirm password', 'confirm', 'new-password', run);
  const tabs = h('div', { class: 'seg', role: 'group', 'aria-label': 'Sign in or create an account' },
    h('button', { type: 'button', 'aria-pressed': String(!creating), 'data-act': 'tab-signin', onclick: () => setMode('signin') }, 'Sign in'),
    h('button', { type: 'button', 'aria-pressed': String(creating), 'data-act': 'tab-create', onclick: () => setMode('create') }, 'Create account'));
  const form = h('form', { class: 'authform', novalidate: true, onsubmit: (e) => { e.preventDefault(); run(); } },
    h('label', { class: 'af' }, h('span', null, 'E-mail'), email), pw.el, pw2 ? pw2.el : null,
    h('label', { class: 'keep' }, keep, ' Keep me signed in on this computer'), err, submit);
  return h('div', { class: 'authcard', 'data-mode': mode },
    h('img', { class: 'authlogo', src: 'assets/logo-mark.png', alt: 'Freight Signal' }),
    h('h1', null, creating ? 'Create your account' : 'Welcome back'),
    h('p', { class: 'authsub' }, creating ? (isLocal ? 'Your own private workspace on this computer: loads, carriers, customers and settings are saved in this browser under your e-mail.' : 'Your own private workspace: loads, carriers, customers and settings are saved to your account and follow you to any computer.') : 'Sign in to open your Freight Signal workspace.'),
    tabs, form,
    h('div', { class: 'authlinks' }, creating ? null : h('button', { class: 'linkbtn', type: 'button', onclick: () => (isLocal ? forgotLocal(email.value) : forgot(email.value)) }, 'Forgot password?')),
    h('p', { class: 'authnote' }, icon('shield', 13), isLocal ? ' Saved only on this computer. Nothing is sent to a server. Freight Signal never sends e-mail for you.' : ' Each account is private to its owner. Freight Signal never sends e-mail for you.'));
}

/** Show the screen and resolve when the person has signed in or created an account. local: true = accounts kept on this computer. */
export function showCloudGate({ message = '', local: isLocal = false } = {}) {
  return new Promise(async (resolve) => {
    const B = isLocal ? local : cloud;
    root().classList.add('locked');
    const host = h('div', { class: 'authgate', id: 'auth' });
    const done = () => { host.remove(); root().classList.remove('locked'); resolve(B.user()); };
    const setMode = (mode) => {
      host.textContent = '';
      host.appendChild(card(mode, done, setMode, B, isLocal));
      if (message) host.querySelector('.authsub').after(h('p', { class: 'autherr', role: 'alert' }, message));
      setTimeout(() => host.querySelector('input[type="email"]').focus(), 40);
    };
    setMode(isLocal ? await local.startMode() : 'signin');
    document.body.appendChild(host);
  });
}
