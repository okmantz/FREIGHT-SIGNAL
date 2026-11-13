/* Runs before first paint (classic script, loaded in <head>): replays the last saved appearance from localStorage so the
 * theme, accent and background never flash. The real engine is js/ui/appearance.js; this file only reads what it wrote. */
(function () {
  try {
    var m = JSON.parse(localStorage.getItem('fs-appearance') || 'null');
    if (!m || m.v !== 1) return;
    var el = document.documentElement;
    var theme = m.auto ? (window.matchMedia && window.matchMedia('(prefers-color-scheme: light)').matches ? 'light' : 'dark') : m.theme;
    el.setAttribute('data-theme', theme === 'light' ? 'light' : 'dark');
    var a = m.attrs || {};
    for (var k in a) if (Object.prototype.hasOwnProperty.call(a, k) && /^data-[a-z]+$/.test(k)) el.setAttribute(k, String(a[k]));
    var v = (theme === 'light' ? m.varsLight : m.varsDark) || {};
    for (var p in v) if (Object.prototype.hasOwnProperty.call(v, p) && /^--[a-z0-9-]+$/.test(p)) el.style.setProperty(p, String(v[p]));
    // This file is included twice: in <head> (attributes, before paint) and at the end of <body> (the artwork element exists by then).
    var art = document.getElementById('bg-art');
    var legacy = { mountains: 'midnight-ocean', aurora: 'cosmic-drift', sakura: 'sakura-reverie', neural: 'cosmic-drift', grid: 'plain' };
    var bg = legacy[a['data-bg']] || a['data-bg'];
    if (a['data-bg'] && legacy[a['data-bg']]) el.setAttribute('data-bg', bg);
    if (art && /^[a-z-]+$/.test(bg || '')) art.className = 'bg-art art-' + bg;
  } catch (e) { /* first visit or storage blocked: the defaults in index.html apply */ }
})();
