// Tiny DOM helpers. All text goes through textContent / text nodes, never innerHTML, so pasted load text,
// carrier names and e-mail bodies can never inject markup (and the strict CSP stays valid).

export function h(tag, props, ...children) {
  const el = document.createElement(tag);
  if (props) {
    for (const [k, v] of Object.entries(props)) {
      if (v === undefined || v === null || v === false) continue;
      if (k === 'class') el.className = v;
      else if (k === 'dataset') Object.assign(el.dataset, v);
      else if (k.startsWith('on') && typeof v === 'function') el.addEventListener(k.slice(2).toLowerCase(), v);
      else if (k === 'value') el.value = v;
      else if (k === 'checked' || k === 'disabled' || k === 'selected' || k === 'readOnly' || k === 'open') el[k] = !!v;
      else el.setAttribute(k, v === true ? '' : v);
    }
  }
  append(el, children);
  return el;
}

function append(el, children) {
  for (const c of children.flat(Infinity)) {
    if (c === null || c === undefined || c === false) continue;
    el.appendChild(c instanceof Node ? c : document.createTextNode(String(c)));
  }
}

export const clear = (el) => { while (el.firstChild) el.removeChild(el.firstChild); return el; };

export function toast(message, kind = 'info', ms = 4200) {
  let host = document.getElementById('toasts');
  if (!host) { host = h('div', { id: 'toasts', 'aria-live': 'polite' }); document.body.appendChild(host); }
  const t = h('div', { class: 'toast ' + kind }, message);
  host.appendChild(t);
  setTimeout(() => t.remove(), ms);
}

/** Modal dialog. Returns { close, body }. */
export function modal({ title, body, actions = [], wide = false, onClose }) {
  const overlay = h('div', { class: 'overlay', role: 'dialog', 'aria-modal': 'true', 'aria-label': title });
  const close = () => { overlay.remove(); document.removeEventListener('keydown', onKey); if (onClose) onClose(); };
  const onKey = (e) => { if (e.key === 'Escape') close(); };
  document.addEventListener('keydown', onKey);
  const bodyEl = h('div', { class: 'modal-body' }, body);
  const foot = h('div', { class: 'modal-foot' }, actions.map(a => h('button', {
    class: 'btn ' + (a.kind || ''), type: 'button',
    onclick: async () => { const keep = a.onClick ? await a.onClick(close) : undefined; if (keep !== false && !a.keepOpen) close(); },
  }, a.label)));
  const box = h('div', { class: 'modal' + (wide ? ' wide' : '') },
    h('div', { class: 'modal-head' }, h('h3', null, title), h('button', { class: 'icon-btn', type: 'button', 'aria-label': 'Close', onclick: close }, '✕')),
    bodyEl, actions.length ? foot : null);
  overlay.appendChild(box);
  overlay.addEventListener('mousedown', (e) => { if (e.target === overlay) close(); });
  document.body.appendChild(overlay);
  return { close, body: bodyEl };
}

export function confirmDialog(title, message, okLabel = 'Confirm') {
  return new Promise((resolve) => {
    let done = false;
    const m = modal({
      title, body: h('pre', { class: 'plain' }, message),
      actions: [
        { label: 'Cancel', onClick: () => { done = true; resolve(false); } },
        { label: okLabel, kind: 'primary', onClick: () => { done = true; resolve(true); } },
      ],
      onClose: () => { if (!done) resolve(false); },
    });
    return m;
  });
}

export function download(filename, content, mime = 'text/plain;charset=utf-8') {
  const blob = content instanceof Blob ? content : new Blob([content], { type: mime });
  const url = URL.createObjectURL(blob);
  const a = h('a', { href: url, download: filename });
  document.body.appendChild(a); a.click(); a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 2000);
}

export async function copyText(text, okMsg = 'Copied to clipboard.') {
  try {
    if (navigator.clipboard && window.isSecureContext) await navigator.clipboard.writeText(text);
    else {
      const ta = h('textarea', { value: text, class: 'offscreen' });
      document.body.appendChild(ta); ta.select(); document.execCommand('copy'); ta.remove();
    }
    toast(okMsg, 'ok');
    return true;
  } catch (e) {
    toast('Copy failed: ' + (e && e.message ? e.message : e), 'err');
    return false;
  }
}

export function openExternal(url) {
  const w = window.open(url, '_blank', 'noopener,noreferrer');
  if (!w) toast('The browser blocked the pop-up. Allow pop-ups for this site, or copy the link: ' + url, 'err', 9000);
}

export function pickFile(accept) {
  return new Promise((resolve) => {
    const input = h('input', { type: 'file', accept, class: 'offscreen' });
    input.addEventListener('change', () => { resolve(input.files[0] || null); input.remove(); });
    input.addEventListener('cancel', () => { resolve(null); input.remove(); });
    document.body.appendChild(input); input.click();
  });
}

export const readFileText = (file) => new Promise((resolve, reject) => {
  const r = new FileReader(); r.onload = () => resolve(String(r.result)); r.onerror = () => reject(r.error); r.readAsText(file);
});

export function field(label, input, hint) {
  return h('label', { class: 'field' }, h('span', { class: 'lbl' }, label), input, hint ? h('small', { class: 'hint' }, hint) : null);
}

export function inputEl(value, onCommit, props = {}) {
  const i = h('input', { class: 'cell', value: value ?? '', ...props });
  i.addEventListener('change', () => onCommit(i.value));
  return i;
}

export function selectEl(options, value, onChange, props = {}) {
  const s = h('select', { class: 'cell', ...props }, options.map(o => h('option', { value: o, selected: String(o) === String(value) }, o)));
  s.addEventListener('change', () => onChange(s.value));
  return s;
}

export const fmtDate = (iso) => {
  if (!iso) return '';
  const d = new Date(iso); if (isNaN(d)) return String(iso);
  let hr = d.getHours(); const ap = hr >= 12 ? 'PM' : 'AM'; hr = hr % 12 || 12;
  return `${d.getMonth() + 1}/${d.getDate()}/${d.getFullYear()} ${hr}:${String(d.getMinutes()).padStart(2, '0')} ${ap}`;
};
