// The weekly-goal celebration: a short, restrained burst of confetti across the whole app plus a small banner, played once when the
// week's cover count reaches the weekly floor (50 by default). Drawn on one canvas that sits above the app and ignores the mouse, so
// nothing underneath is blocked. It uses the app's own accent colour (plus white / gold), so it matches every theme.
// Honours "reduce motion" (the OS setting and the Motion switch in Account Settings): then only the banner shows.

import { h } from './dom.js';
import { icon } from './icons.js';
import { getAppearance, resolvedMode } from './appearance.js';

const DURATION = 3600;            // ms from first spawn until the last piece has faded
let live = null;                  // the running animation, so a second celebration replaces the first instead of stacking

const rgbOf = (s) => String(s || '').split(',').map((x) => Number(x.trim()) || 0);
const mix = (c, to, t) => c.map((v, i) => Math.round(v + (to[i] - v) * t));
const css = (c, a = 1) => `rgba(${c[0]}, ${c[1]}, ${c[2]}, ${a})`;
const rand = (a, b) => a + Math.random() * (b - a);

function palette() {
  let acc = [26, 176, 238];
  try { const v = getComputedStyle(document.documentElement).getPropertyValue('--accent-rgb'); if (v.trim()) acc = rgbOf(v); } catch { /* keep default */ }
  const light = resolvedMode() === 'light';
  return light
    ? [acc, mix(acc, [0, 0, 0], 0.32), mix(acc, [255, 255, 255], 0.4), [201, 154, 46], [58, 74, 99]]
    : [acc, mix(acc, [255, 255, 255], 0.45), mix(acc, [0, 0, 0], 0.2), [255, 255, 255], [230, 195, 106]];
}

const reduced = () => {
  try { if (window.matchMedia && window.matchMedia('(prefers-reduced-motion: reduce)').matches) return true; } catch { /* ignore */ }
  try { return getAppearance().motion === false; } catch { return false; }
};

function banner({ week, floor }) {
  document.querySelectorAll('.goal-banner').forEach((n) => n.remove());
  const el = h('div', { class: 'goal-banner', role: 'status', 'aria-live': 'polite' },
    h('span', { class: 'gb-ico' }, icon('check', 20)),
    h('div', { class: 'gb-text' }, h('b', null, `${week} covers this week`), h('small', null, `You hit your weekly floor of ${floor}. Nice work.`)),
    h('button', { class: 'gb-x', type: 'button', 'aria-label': 'Dismiss', onclick: () => el.remove() }, icon('close', 14)));
  document.body.appendChild(el);
  requestAnimationFrame(() => el.classList.add('in'));
  setTimeout(() => { el.classList.remove('in'); setTimeout(() => el.remove(), 500); }, 6000);
}

function pulsePace() {
  const pace = document.getElementById('pace');
  if (!pace) return;
  pace.classList.add('milestone');
  setTimeout(() => pace.classList.remove('milestone'), 7000);
}

function confetti() {
  if (live) live.stop();
  const dpr = Math.min(2, window.devicePixelRatio || 1);
  const canvas = h('canvas', { id: 'confetti', 'aria-hidden': 'true' });
  document.body.appendChild(canvas);
  const ctx = canvas.getContext('2d');
  let W = 0, H = 0;
  const fit = () => { W = window.innerWidth; H = window.innerHeight; canvas.width = Math.round(W * dpr); canvas.height = Math.round(H * dpr); ctx.setTransform(dpr, 0, 0, dpr, 0, 0); };
  fit();
  window.addEventListener('resize', fit);

  const colors = palette();
  const scale = Math.max(0.7, Math.min(1.25, (W * H) / (1400 * 800)));      // smaller screens get a lighter burst
  const k = H / 900;                                                       // speeds scale with the screen height so the burst reaches the middle everywhere
  const pieces = [];
  const spawn = (x, y, angle, speed, delay) => {
    const kind = Math.random() < 0.8 ? 'rect' : 'dot';
    pieces.push({
      x, y, vx: Math.cos(angle) * speed, vy: Math.sin(angle) * speed, delay,
      w: kind === 'rect' ? rand(6, 11) : rand(2.2, 3.4), h: kind === 'rect' ? rand(3, 5.5) : 0, kind,
      rot: rand(0, Math.PI * 2), vr: rand(-0.22, 0.22), tilt: rand(0, Math.PI * 2), vt: rand(0.1, 0.28),
      life: rand(2300, 3500), age: 0, color: colors[Math.floor(Math.random() * colors.length)], sway: rand(0.6, 1.6), ph: rand(0, 6.28),
    });
  };
  // two cannons low in the corners, firing up and in toward the middle
  const shots = Math.round(52 * scale);
  for (let i = 0; i < shots; i++) {
    spawn(W * 0.04, H * 1.02, -Math.PI / 2 + rand(0.35, 0.95), rand(15, 27) * k, rand(0, 160));
    spawn(W * 0.96, H * 1.02, -Math.PI / 2 - rand(0.35, 0.95), rand(15, 27) * k, rand(0, 160));
  }
  // a light shower from the top, a moment later, so it reads as "across the app"
  const rain = Math.round(70 * scale);
  for (let i = 0; i < rain; i++) spawn(rand(0, W), -14, Math.PI / 2 + rand(-0.25, 0.25), rand(1.5, 4.5) * k, rand(350, 1500));

  let last = performance.now(); const t0 = last; let raf = 0; let done = false;
  const stop = () => { if (done) return; done = true; cancelAnimationFrame(raf); window.removeEventListener('resize', fit); canvas.remove(); if (live && live.stop === stop) live = null; };
  const frame = (now) => {
    if (done) return;
    const dt = Math.min(48, now - last); last = now;
    const f = dt / 16.667;                                                  // frames at 60 fps, so speed does not depend on the display's refresh rate
    ctx.clearRect(0, 0, W, H);
    let alive = 0;
    for (const p of pieces) {
      if (now - t0 < p.delay) { alive++; continue; }
      p.age += dt;
      if (p.age >= p.life) continue;
      alive++;
      p.vx *= Math.pow(0.987, f); p.vy = p.vy * Math.pow(0.987, f) + 0.34 * k * f;
      p.x += (p.vx + Math.sin(p.ph + p.age / 340) * p.sway) * f; p.y += p.vy * f;
      p.rot += p.vr * f; p.tilt += p.vt * f;
      const fade = p.age > p.life * 0.68 ? 1 - (p.age - p.life * 0.68) / (p.life * 0.32) : 1;
      ctx.save();
      ctx.globalAlpha = Math.max(0, fade) * 0.95;
      ctx.translate(p.x, p.y); ctx.rotate(p.rot);
      ctx.fillStyle = css(p.color);
      if (p.kind === 'rect') { ctx.scale(1, Math.cos(p.tilt)); ctx.fillRect(-p.w / 2, -p.h / 2, p.w, p.h); }
      else { ctx.beginPath(); ctx.arc(0, 0, p.w, 0, Math.PI * 2); ctx.fill(); }
      ctx.restore();
    }
    if (alive && now - t0 < DURATION + 1600) raf = requestAnimationFrame(frame); else stop();
  };
  raf = requestAnimationFrame(frame);
  live = { stop };
}

/** Play the celebration. info = { week, floor }. */
export function celebrate(info = {}) {
  const week = info.week || info.floor || 50; const floor = info.floor || week;
  banner({ week, floor });
  pulsePace();
  if (!reduced()) confetti();
}
