// Inline SVG icons (stroke icons on a 24 x 24 grid). Built with createElementNS, so there is no innerHTML and the
// strict CSP (no inline styles, no external files) stays valid. Colour comes from `currentColor`.

const NS = 'http://www.w3.org/2000/svg';

// [tag, ...attrs] shapes. 'p' = path d, 'c' = circle cx cy r, 'r' = rect x y w h rx, 'l' = line x1 y1 x2 y2.
const SHAPES = {
  home: [['p', 'M3 10.5 12 3l9 7.5'], ['p', 'M5 9.5V20h5v-6h4v6h5V9.5']],
  board: [['r', 3, 4, 18, 4, 1.5], ['r', 3, 10, 18, 4, 1.5], ['r', 3, 16, 18, 4, 1.5]],
  spare: [['r', 3, 4, 18, 5, 1.2], ['p', 'M5 9v10a1 1 0 0 0 1 1h12a1 1 0 0 0 1-1V9'], ['p', 'M10 13h4']],
  carriers: [['p', 'M3 6h11v10H3z'], ['p', 'M14 9h4l3 3v4h-7'], ['c', 7, 17.5, 1.8], ['c', 17, 17.5, 1.8]],
  inquiry: [['p', 'M3 13l3-8h12l3 8'], ['p', 'M3 13v5a1 1 0 0 0 1 1h16a1 1 0 0 0 1-1v-5h-5l-1 2h-6l-1-2z']],
  zipmap: [['p', 'M12 21s7-5.5 7-11a7 7 0 1 0-14 0c0 5.5 7 11 7 11z'], ['c', 12, 10, 2.5]],
  drafts: [['r', 3, 5, 18, 14, 2], ['p', 'M3.5 7l8.5 6 8.5-6']],
  manual: [['p', 'M4 5.5A2.5 2.5 0 0 1 6.5 3H20v15H6.5A2.5 2.5 0 0 0 4 20.5z'], ['p', 'M4 20.5A2.5 2.5 0 0 0 6.5 23H20v-5']],
  system: [['l', 4, 7, 20, 7], ['l', 4, 17, 20, 17], ['c', 9, 7, 2.2], ['c', 15, 17, 2.2]],
  account: [['c', 12, 8, 4], ['p', 'M4 20.5c1-4 4-6 8-6s7 2 8 6']],
  palette: [['p', 'M12 3a9 9 0 1 0 0 18c1.5 0 2.2-1 1.6-2.1-.6-1.2.2-2.4 1.6-2.4H17a4 4 0 0 0 4-4C21 6.6 17 3 12 3z'], ['c', 7.5, 11.5, 1], ['c', 10, 7.2, 1], ['c', 14.6, 7.2, 1]],
  copy: [['r', 9, 9, 11, 11, 2], ['p', 'M5 15V6a2 2 0 0 1 2-2h9']],
  eye: [['p', 'M2 12s3.5-7 10-7 10 7 10 7-3.5 7-10 7S2 12 2 12z'], ['c', 12, 12, 3]],
  download: [['p', 'M12 4v11'], ['p', 'M7 11l5 5 5-5'], ['p', 'M4 20h16']],
  upload: [['p', 'M12 16V5'], ['p', 'M7 9l5-5 5 5'], ['p', 'M4 20h16']],
  trash: [['p', 'M4 7h16'], ['p', 'M9 7V4h6v3'], ['p', 'M6 7l1 13h10l1-13']],
  plus: [['l', 12, 5, 12, 19], ['l', 5, 12, 19, 12]],
  search: [['c', 11, 11, 6.5], ['p', 'M16 16l4.5 4.5']],
  sun: [['c', 12, 12, 4], ['p', 'M12 2v2M12 20v2M2 12h2M20 12h2M4.9 4.9l1.4 1.4M17.7 17.7l1.4 1.4M4.9 19.1l1.4-1.4M17.7 6.3l1.4-1.4']],
  moon: [['p', 'M20 14.5A8.5 8.5 0 0 1 9.5 4 8.5 8.5 0 1 0 20 14.5z']],
  menu: [['l', 4, 7, 20, 7], ['l', 4, 12, 20, 12], ['l', 4, 17, 20, 17]],
  close: [['p', 'M6 6l12 12M18 6L6 18']],
  check: [['p', 'M5 12.5l4.5 4.5L19 7']],
  refresh: [['p', 'M20 11a8 8 0 1 0-2.3 5.7'], ['p', 'M20 4v7h-7']],
  bolt: [['p', 'M13 2L4 14h7l-1 8 9-12h-7z']],
  external: [['p', 'M14 4h6v6'], ['p', 'M20 4l-9 9'], ['p', 'M18 14v5a1 1 0 0 1-1 1H5a1 1 0 0 1-1-1V7a1 1 0 0 1 1-1h5']],
  route: [['p', 'M8.2 18H15a3 3 0 0 0 0-6H9a3 3 0 0 1 0-6h6.8'], ['c', 6, 18, 0.1], ['c', 18, 6, 0.1]],
  image: [['r', 3, 4, 18, 16, 2], ['c', 9, 10, 1.8], ['p', 'M21 16l-5-5-9 9']],
  sparkle: [['p', 'M12 3l1.8 5.2L19 10l-5.2 1.8L12 17l-1.8-5.2L5 10l5.2-1.8z']],
  layers: [['p', 'M12 3l9 5-9 5-9-5z'], ['p', 'M3 13l9 5 9-5']],
  type: [['p', 'M5 6V4h14v2'], ['p', 'M12 4v16'], ['p', 'M9 20h6']],
  activity: [['p', 'M3 12h4l3-8 4 16 3-8h4']],
  shield: [['p', 'M12 3l8 3v6c0 5-3.5 8-8 9-4.5-1-8-4-8-9V6z']],
  grid: [['r', 3, 3, 7, 7, 1.5], ['r', 14, 3, 7, 7, 1.5], ['r', 3, 14, 7, 7, 1.5], ['r', 14, 14, 7, 7, 1.5]],
  info: [['c', 12, 12, 9], ['l', 12, 11, 12, 16], ['c', 12, 8, 0.1]],
  edit: [['p', 'M4 20h4L19 9a2.8 2.8 0 0 0-4-4L4 16z'], ['p', 'M13.5 6.5l4 4']],
  mail: [['r', 3, 5, 18, 14, 2], ['p', 'M3.5 7l8.5 6 8.5-6']],
  user: [['c', 12, 8, 4], ['p', 'M4 20.5c1-4 4-6 8-6s7 2 8 6']],
  sliders: [['l', 4, 7, 20, 7], ['l', 4, 17, 20, 17], ['c', 9, 7, 2.2], ['c', 15, 17, 2.2]],
  cloud: [['p', 'M7 18a4 4 0 0 1-.6-8A6 6 0 0 1 18 9a4.5 4.5 0 0 1-.5 9z']],
  database: [['p', 'M4 6c0-1.7 3.6-3 8-3s8 1.3 8 3-3.6 3-8 3-8-1.3-8-3z'], ['p', 'M4 6v6c0 1.7 3.6 3 8 3s8-1.3 8-3V6'], ['p', 'M4 12v6c0 1.7 3.6 3 8 3s8-1.3 8-3v-6']],
  chevron: [['p', 'M9 6l6 6-6 6']],
  chevdown: [['p', 'M6 9l6 6 6-6']],
  chevright: [['p', 'M9 6l6 6-6 6']],
  bulb: [['p', 'M9 18h6'], ['p', 'M10 21h4'], ['p', 'M12 3a6 6 0 0 0-3.5 10.9c.6.5 1 1.2 1 2.1h5c0-.9.4-1.6 1-2.1A6 6 0 0 0 12 3z']],
  customers: [['c', 9, 8, 3.5], ['p', 'M2.5 20c0-3.6 2.9-6 6.5-6s6.5 2.4 6.5 6'], ['c', 17, 9, 2.6], ['p', 'M17.5 14.2c2.5.2 4 2 4 4.8']],
  covers: [['p', 'M5 4h14v16H5z'], ['p', 'M9 9l2 2 4-4'], ['l', 8, 15, 16, 15]],
  phone: [['p', 'M5 4h4l2 5-2.5 1.5a11 11 0 0 0 5 5L15 13l5 2v4a1 1 0 0 1-1 1A15 15 0 0 1 4 5a1 1 0 0 1 1-1z']],
  storm: [['p', 'M7 15a4 4 0 0 1-.4-8A5.5 5.5 0 0 1 17 8a3.5 3.5 0 0 1 .5 7'], ['p', 'M12 12l-2 4h3l-2 4']],
  trendup: [['p', 'M3 17l6-6 4 4 8-8'], ['p', 'M15 7h6v6']],
  file: [['p', 'M6 3h8l5 5v12a1 1 0 0 1-1 1H6a1 1 0 0 1-1-1V4a1 1 0 0 1 1-1z'], ['p', 'M14 3v5h5']],
};

/** icon('copy') -> <svg class="ico">. `size` in px. */
export function icon(name, size = 18, extraClass = '') {
  const svg = document.createElementNS(NS, 'svg');
  svg.setAttribute('viewBox', '0 0 24 24');
  svg.setAttribute('width', String(size));
  svg.setAttribute('height', String(size));
  svg.setAttribute('fill', 'none');
  svg.setAttribute('stroke', 'currentColor');
  svg.setAttribute('stroke-width', '1.7');
  svg.setAttribute('stroke-linecap', 'round');
  svg.setAttribute('stroke-linejoin', 'round');
  svg.setAttribute('aria-hidden', 'true');
  svg.setAttribute('focusable', 'false');
  svg.setAttribute('class', 'ico' + (extraClass ? ' ' + extraClass : ''));
  for (const [t, ...a] of SHAPES[name] || SHAPES.info) {
    let el;
    if (t === 'p') { el = document.createElementNS(NS, 'path'); el.setAttribute('d', a[0]); }
    else if (t === 'c') { el = document.createElementNS(NS, 'circle'); el.setAttribute('cx', a[0]); el.setAttribute('cy', a[1]); el.setAttribute('r', a[2]); }
    else if (t === 'r') { el = document.createElementNS(NS, 'rect'); ['x', 'y', 'width', 'height', 'rx'].forEach((k, i) => el.setAttribute(k, a[i])); }
    else { el = document.createElementNS(NS, 'line'); ['x1', 'y1', 'x2', 'y2'].forEach((k, i) => el.setAttribute(k, a[i])); }
    svg.appendChild(el);
  }
  return svg;
}

export const ICON_NAMES = Object.keys(SHAPES);
