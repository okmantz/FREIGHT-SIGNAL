// Table cells that turn contact details into one-click actions: a phone number becomes a tel: link (it dials from a softphone or a
// phone linked to the computer), an e-mail a mailto: link, and a carrier's MC/DOT a link to its FMCSA SAFER record in a new tab.
// Nothing is fetched; the links only open when clicked.

import { h } from './dom.js';
import { telHref, mailHref, fmcsaUrl } from '../core/resources.js';

export function contactCell(key, value) {
  const v = String(value ?? '');
  if (!v.trim()) return h('td', null, '');
  if (key === 'phone') { const href = telHref(v); return h('td', null, href ? h('a', { class: 'xlink', href, title: 'Call ' + v }, v) : v); }
  if (key === 'email') { const href = mailHref(v); return h('td', null, href ? h('a', { class: 'xlink', href, title: 'Write to ' + v }, v) : v); }
  if (key === 'mc') { const href = fmcsaUrl(v); return h('td', null, href ? h('a', { class: 'xlink', href, target: '_blank', rel: 'noopener noreferrer', title: 'Check authority, insurance and safety rating on FMCSA SAFER' }, v) : v); }
  return h('td', null, v);
}
