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

/**
 * Modal dialog. Returns { close, body }.
 * v23: Enter in a one-line field presses the primary button (so a cover can be logged without the mouse), the first field gets the
 * focus, focus goes back to where you were when the dialog closes, and a button cannot fire twice from a double click.
 */
export function modal({ title, body, actions = [], wide = false, onClose }) {
  const overlay = h('div', { class: 'overlay', role: 'dialog', 'aria-modal': 'true', 'aria-label': title });
  const opener = document.activeElement;
  const close = () => {
    overlay.remove(); document.removeEventListener('keydown', onKey);
    if (opener && opener !== document.body && document.contains(opener) && typeof opener.focus === 'function') { try { opener.focus({ preventScroll: true }); } catch { /* element is gone */ } }
    if (onClose) onClose();
  };
  const onKey = (e) => { if (e.key === 'Escape') close(); };
  document.addEventListener('keydown', onKey);
  const bodyEl = h('div', { class: 'modal-body' }, body);
  const foot = h('div', { class: 'modal-foot' }, actions.map(a => {
    let busy = false;
    return h('button', {
      class: 'btn ' + (a.kind || ''), type: 'button',
      onclick: async () => { if (busy) return; busy = true; try { const keep = a.onClick ? await a.onClick(close) : undefined; if (keep !== false && !a.keepOpen) close(); } finally { busy = false; } },
    }, a.label);
  }));
  const box = h('div', { class: 'modal' + (wide ? ' wide' : '') },
    h('div', { class: 'modal-head' }, h('h3', null, title), h('button', { class: 'icon-btn', type: 'button', 'aria-label': 'Close', onclick: close }, '\u2715')),
    bodyEl, actions.length ? foot : null);
  overlay.appendChild(box);
  overlay.addEventListener('mousedown', (e) => { if (e.target === overlay) close(); });
  overlay.addEventListener('keydown', (e) => {
    if (e.key !== 'Enter' || e.defaultPrevented || e.isComposing || e.shiftKey || e.altKey) return;
    const t = e.target; if (!t || t.tagName !== 'INPUT' || t.hasAttribute('list') || /^(checkbox|radio|button|submit|file|search)$/.test(t.type || '')) return;   // a field with suggestions keeps Enter for picking one
    const go = foot.querySelector('.btn.primary'); if (!go) return;
    e.preventDefault(); go.click();
  });
  document.body.appendChild(overlay);
  // First field gets the focus (a dialog that sets its own focus a moment later simply overrides this).
  const first = bodyEl.querySelector('input:not([type=checkbox]):not([type=radio]):not([type=file]):not([type=hidden]), textarea');
  if (first) setTimeout(() => { if (document.contains(first) && (!document.activeElement || document.activeElement === document.body || !overlay.contains(document.activeElement))) first.focus({ preventScroll: true }); }, 0);
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

/**
 * Menu placement (v23). A <details> menu whose list is fixed to the screen, so it is never clipped by the page's scroll area or the sidebar and
 * never runs off an edge: it opens under the button (left edges lined up), swaps to right-aligned when that would overflow, flips above the button
 * when there is no room below, and scrolls inside itself when the screen is short. Escape closes it, arrow keys move through the items, a click
 * anywhere else closes it. Works with the .dir-menu (list pages) and .menu (load board) markup.
 */
let popoverGlobals = false;
export function wirePopover(d, list) {
  list.classList.add('pop-fixed'); d.setAttribute('data-popover', '');
  if (!popoverGlobals) {
    popoverGlobals = true;
    document.addEventListener('click', (e) => { document.querySelectorAll('details[data-popover][open]').forEach(x => { if (!x.contains(e.target)) x.open = false; }); }, true);
  }
  const sum = d.querySelector('summary');
  let kb = false, byUser = true;
  sum.addEventListener('click', (e) => { byUser = e.isTrusted; });   // a menu opened from code (not by a person) is never closed just because the page scrolled
  const place = () => {
    const keepScroll = list.scrollTop;
    list.style.maxHeight = ''; list.style.left = '0px'; list.style.top = '0px';
    // Where is the list's own (0, 0)? Normally the window corner; inside a page that is mid-animation (transform) it is that box's corner. Correct for it.
    const o0 = list.getBoundingClientRect(), ox = o0.left, oy = o0.top;
    const vw = document.documentElement.clientWidth, vh = document.documentElement.clientHeight, m = 8, gap = 6;
    let r = sum.getBoundingClientRect();
    if (r.bottom < 0 || r.top > vh) { try { sum.scrollIntoView({ block: 'center', inline: 'nearest' }); } catch { /* old browser */ } r = sum.getBoundingClientRect(); }   // opened from code while off screen: bring the button into view first
    const w = list.offsetWidth, ht = list.offsetHeight;
    let left = r.left; if (left + w > vw - m) left = r.right - w;
    left = Math.max(m, Math.min(left, vw - w - m));
    // never slide under the page header or a pinned toolbar that sits above the button
    let topLimit = m; const hd = document.querySelector('header.top'); if (hd) topLimit = Math.max(topLimit, hd.getBoundingClientRect().bottom + 4);
    document.querySelectorAll('#view .toolbar.sticky').forEach((t) => { const b = t.getBoundingClientRect(); if (b.bottom <= r.top + 2 && b.bottom > 0) topLimit = Math.max(topLimit, b.bottom + 4); });
    const below = vh - r.bottom - gap - m, above = r.top - gap - topLimit;
    let top, max = 0;
    if (ht <= below) top = r.bottom + gap;
    else if (ht <= above) top = r.top - gap - ht;
    else if (Math.max(below, above) >= 160) {                       // scroll inside the list, on the roomier side of the button
      if (below >= above) { top = r.bottom + gap; max = below; } else { max = above; top = r.top - gap - Math.min(ht, max); }
    } else {                                                         // the button is near an edge: use the whole window height (over the button if needed)
      max = Math.max(120, vh - m - topLimit); top = Math.min(Math.max(r.bottom + gap, topLimit), vh - m - Math.min(ht, max));
    }
    top = Math.min(Math.max(top, topLimit), Math.max(topLimit, vh - m - Math.min(ht, max || ht)));      // whatever happened above, the list ends up inside the window
    list.style.left = Math.round(left - ox) + 'px'; list.style.top = Math.round(top - oy) + 'px'; if (max) list.style.maxHeight = Math.floor(max) + 'px';
    list.scrollTop = keepScroll; anchor = [r.left, r.top, r.width, r.height].map(Math.round).join(',');
    list.classList.add('placed');
  };
  const shut = () => { d.open = false; };
  // The page scrolled under an open menu: keep the list attached to its button (close it only when the button has left the window).
  let raf = 0, anchor = '';
  const onScroll = (e) => {
    if (list.contains(e.target)) return;
    cancelAnimationFrame(raf);
    raf = requestAnimationFrame(() => {
      if (!d.open) return;
      const r = sum.getBoundingClientRect(); if (r.bottom < 0 || r.top > document.documentElement.clientHeight) { if (byUser) shut(); return; }
      const key = [r.left, r.top, r.width, r.height].map(Math.round).join(',');
      if (key === anchor) return;                                  // the button did not move (the list scrolled inside itself): leave the list alone
      try { place(); } catch { /* keep the old spot */ }
    });
  };
  d.addEventListener('toggle', () => {
    if (d.open) {
      try { place(); } catch { list.classList.add('placed'); }
      window.addEventListener('resize', shut); document.addEventListener('scroll', onScroll, true);
      if (kb) { const first = list.querySelector('button:not(:disabled)'); if (first) first.focus(); }
    } else {
      list.classList.remove('placed'); list.style.left = ''; list.style.top = ''; list.style.maxHeight = '';
      window.removeEventListener('resize', shut); document.removeEventListener('scroll', onScroll, true);
    }
    kb = false;
  });
  d.addEventListener('keydown', (e) => {
    const items = [...list.querySelectorAll('button:not(:disabled)')];
    if (!d.open) { if (e.target === sum && (e.key === 'Enter' || e.key === ' ' || e.key === 'ArrowDown')) kb = true; if (e.target === sum && e.key === 'ArrowDown') { e.preventDefault(); d.open = true; } return; }
    const i = items.indexOf(document.activeElement);
    if (e.key === 'Escape') { e.preventDefault(); e.stopPropagation(); d.open = false; sum.focus(); }
    else if (e.key === 'ArrowDown') { e.preventDefault(); (items[i + 1] || items[0] || sum).focus(); }
    else if (e.key === 'ArrowUp') { e.preventDefault(); (items[i - 1] || items[items.length - 1] || sum).focus(); }
    else if (e.key === 'Tab') { d.open = false; }
  });
  return d;
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
