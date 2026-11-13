// The first-run "create your account" screen and the "sign in" screen. Shown over the background scene before the app
// itself appears; resolves once the person is in. (Logic lives in store/auth.js.)
import { h, modal } from './dom.js';
import { icon } from './icons.js';
import { hasAccount, account, createAccount, signIn, resetAccount, skipForNow, isEmail, passwordProblem, normEmail } from '../store/auth.js';

const root = () => document.documentElement;

function passwordField(label, name, autocomplete, onEnter) {
  const input = h('input', { type: 'password', name, autocomplete, required: true, 'aria-label': label, placeholder: label, 'data-live': '' });
  const eye = h('button', { class: 'pw-eye', type: 'button', tabindex: '-1', 'aria-label': 'Show or hide the password', title: 'Show / hide', onclick: () => { input.type = input.type === 'password' ? 'text' : 'password'; input.focus(); } }, icon('eye', 16));
  if (onEnter) input.addEventListener('keydown', (e) => { if (e.key === 'Enter') { e.preventDefault(); onEnter(); } });
  return { input, el: h('label', { class: 'af' }, h('span', null, label), h('div', { class: 'pw' }, input, eye)) };
}

function emailField(value, autocomplete = 'username') {
  const input = h('input', { type: 'email', name: 'email', autocomplete, required: true, placeholder: 'you@company.com', value: value || '', 'aria-label': 'E-mail', 'data-live': '', spellcheck: 'false' });
  return { input, el: h('label', { class: 'af' }, h('span', null, 'E-mail'), input) };
}

function forgot() {
  const a = account();
  const inp = h('input', { type: 'email', placeholder: 'Type your account e-mail to confirm', 'aria-label': 'Account e-mail', 'data-live': '' });
  const err = h('p', { class: 'autherr', role: 'alert' });
  let m;
  const go = async () => {
    try { await resetAccount(inp.value); m.close(); location.reload(); }
    catch (e) { err.textContent = e.message || String(e); }
  };
  inp.addEventListener('keydown', (e) => { if (e.key === 'Enter') { e.preventDefault(); go(); } });
  m = modal({
    title: 'Forgot your password?',
    body: h('div', null,
      h('p', null, 'Freight Signal keeps everything on this computer, so there is no server that can e-mail you a reset link. You can reset the sign-in here instead:'),
      h('ul', { class: 'plainlist' }, h('li', null, 'Your loads, carriers, customers and settings are kept.'), h('li', null, 'The current password is removed and you create a new one.')),
      h('p', { class: 'muted' }, 'Anyone at this computer can do this, so treat the sign-in as a door lock, not a vault. The account is ', h('b', null, a ? a.email : ''), '.'),
      inp, err),
    actions: [{ label: 'Cancel' }, { label: 'Reset sign-in', kind: 'primary', keepOpen: true, onClick: go }],
  });
  setTimeout(() => inp.focus(), 40);
}

function card(kind, done) {
  const creating = kind === 'create';
  const a = account();
  const em = emailField(creating ? '' : (a && a.email) || '', creating ? 'username' : 'username');
  const submit = h('button', { class: 'btn primary authbtn', type: 'submit' }, creating ? 'Create account' : 'Sign in');
  const err = h('p', { class: 'autherr', role: 'alert' });
  const keep = h('input', { type: 'checkbox', checked: true, 'data-live': '' });
  let pw2 = null;
  const run = async () => {
    err.textContent = '';
    const email = em.input.value.trim();
    if (!isEmail(email)) { err.textContent = 'Enter a valid e-mail address.'; em.input.focus(); return; }
    if (creating) {
      const bad = passwordProblem(pw.input.value);
      if (bad) { err.textContent = bad; pw.input.focus(); return; }
      if (pw.input.value !== pw2.input.value) { err.textContent = 'The two passwords do not match.'; pw2.input.focus(); return; }
    }
    submit.disabled = true;
    try {
      if (creating) await createAccount(email, pw.input.value, keep.checked);
      else if (!(await signIn(email, pw.input.value, keep.checked))) { err.textContent = 'That e-mail and password do not match.'; pw.input.select(); submit.disabled = false; return; }
      done();
    } catch (e) { err.textContent = e.message || String(e); submit.disabled = false; }
  };
  const pw = passwordField(creating ? 'Create a password' : 'Password', 'password', creating ? 'new-password' : 'current-password', creating ? null : run);
  if (creating) pw2 = passwordField('Confirm password', 'confirm', 'new-password', run);
  const form = h('form', { class: 'authform', novalidate: true, onsubmit: (e) => { e.preventDefault(); run(); } },
    em.el, pw.el, pw2 ? pw2.el : null,
    h('label', { class: 'keep' }, keep, ' Keep me signed in on this computer'),
    err, submit);
  return h('div', { class: 'authcard' },
    h('img', { class: 'authlogo', src: 'assets/logo-mark.png', alt: 'Freight Signal' }),
    h('h1', null, creating ? 'Create your account' : 'Welcome back'),
    h('p', { class: 'authsub' }, creating ? 'Your e-mail and password protect this workspace and are saved in Account Settings.' : 'Sign in to open your Freight Signal workspace.'),
    form,
    h('div', { class: 'authlinks' },
      creating ? h('button', { class: 'linkbtn', type: 'button', onclick: async () => { await skipForNow(); done(); } }, 'Skip for now') : h('button', { class: 'linkbtn', type: 'button', onclick: forgot }, 'Forgot password?')),
    h('p', { class: 'authnote' }, icon('shield', 13), ' Saved only in this browser. Nothing is sent to a server.'));
}

/** Show the gate (create or sign-in, whichever applies) and resolve when the person is through. */
export function showGate() {
  return new Promise((resolve) => {
    root().classList.add('locked');
    const host = h('div', { class: 'authgate', id: 'auth' });
    const done = () => { host.remove(); root().classList.remove('locked'); resolve(); };
    host.appendChild(card(hasAccount() ? 'signin' : 'create', done));
    document.body.appendChild(host);
    setTimeout(() => { const f = host.querySelector('input[type="email"]'); const p = host.querySelector('input[type="password"]'); (f && !f.value ? f : p || f).focus(); }, 60);
  });
}

export { normEmail };
