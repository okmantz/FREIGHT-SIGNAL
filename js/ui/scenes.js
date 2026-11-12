// Background motion: ONE fixed canvas (#bg-fx) behind the app that animates the chosen scene (stars, aurora, waves, rain,
// fireflies, gold dust, plankton, a node graph, snow, petals, leaves, sand). The static artwork underneath is pure CSS
// (see css/app.css, .art-*), so if the canvas is switched off the scene still looks right.
//
// Cost control: ~30 fps cap, device-pixel-ratio capped at 1.5, particle counts scale with screen area, paused while the
// tab is hidden, and drawn once (no loop) for "reduce motion" or when Animated scenes is switched off.

const rnd = (a, b) => a + Math.random() * (b - a);
const clamp = (v, a, b) => (v < a ? a : v > b ? b : v);
const rgba = (c, a) => 'rgba(' + c[0] + ',' + c[1] + ',' + c[2] + ',' + a + ')';

let canvas = null, ctx = null, W = 0, H = 0, dpr = 1;
let fx = null, st = null, opts = { motion: true, light: false, acc: [26, 176, 238] };
let raf = 0, last = 0, t = 0, kindNow = null;
let wired = false;
const reduced = typeof matchMedia === 'function' ? matchMedia('(prefers-reduced-motion: reduce)') : null;

/* soft round glow, painted once per colour and reused (cheaper than a gradient per particle per frame) */
const glowCache = new Map();
function glow(c) {
  const key = c.join(',');
  let g = glowCache.get(key);
  if (g) return g;
  g = document.createElement('canvas'); g.width = g.height = 64;
  const x = g.getContext('2d');
  const gr = x.createRadialGradient(32, 32, 0, 32, 32, 32);
  gr.addColorStop(0, rgba(c, 1)); gr.addColorStop(0.25, rgba(c, 0.55)); gr.addColorStop(1, rgba(c, 0));
  x.fillStyle = gr; x.fillRect(0, 0, 64, 64);
  glowCache.set(key, g);
  return g;
}
const stamp = (c, x, y, r, a) => { ctx.globalAlpha = clamp(a, 0, 1); ctx.drawImage(glow(c), x - r, y - r, r * 2, r * 2); ctx.globalAlpha = 1; };

/* ---------------------------------------------------------------------------------------------- effects */
const count = (per, lo, hi) => clamp(Math.round((W * H) / per), lo, hi);

function starField(n) { return Array.from({ length: n }, () => ({ x: rnd(0, W), y: rnd(0, H * 0.72), r: rnd(0.4, 1.5), ph: rnd(0, 6.28), sp: rnd(0.6, 2.4), a: rnd(0.35, 1) })); }
function drawStars(s, tt, light) {
  const c = light ? [70, 90, 120] : [225, 238, 255];
  for (const q of s) { const a = q.a * (0.55 + 0.45 * Math.sin(tt * q.sp + q.ph)) * (light ? 0.5 : 1); ctx.fillStyle = rgba(c, a); ctx.beginPath(); ctx.arc(q.x, q.y, q.r, 0, 6.2832); ctx.fill(); }
}

const FX = {
  stars: {
    init: () => ({ stars: starField(count(8500, 70, 260)), shoot: null, next: rnd(4, 9) }),
    draw(s, dt) {
      drawStars(s.stars, t, opts.light);
      s.next -= dt;
      if (!s.shoot && s.next <= 0 && !opts.light) { s.shoot = { x: rnd(W * 0.2, W * 0.9), y: rnd(0, H * 0.3), vx: -rnd(380, 560), vy: rnd(140, 230), life: 0 }; s.next = rnd(8, 16); }
      if (s.shoot) {
        const q = s.shoot; q.life += dt; q.x += q.vx * dt; q.y += q.vy * dt;
        const a = Math.max(0, 1 - q.life / 0.9);
        const g = ctx.createLinearGradient(q.x, q.y, q.x - q.vx * 0.12, q.y - q.vy * 0.12);
        g.addColorStop(0, 'rgba(255,255,255,' + a + ')'); g.addColorStop(1, 'rgba(255,255,255,0)');
        ctx.strokeStyle = g; ctx.lineWidth = 1.4; ctx.beginPath(); ctx.moveTo(q.x, q.y); ctx.lineTo(q.x - q.vx * 0.12, q.y - q.vy * 0.12); ctx.stroke();
        if (q.life > 0.9) s.shoot = null;
      }
    },
  },

  aurora: {
    init: () => ({
      stars: starField(count(16000, 40, 140)),
      ribbons: [
        { c: [53, 224, 176], y: 0.26, amp: 46, f: 0.0042, sp: 0.18, ph: 0, h: 170 },
        { c: [120, 100, 255], y: 0.34, amp: 58, f: 0.0031, sp: -0.13, ph: 2, h: 190 },
        { c: [77, 160, 255], y: 0.20, amp: 38, f: 0.0052, sp: 0.1, ph: 4, h: 150 },
      ],
    }),
    draw(s) {
      drawStars(s.stars, t, opts.light);
      ctx.globalCompositeOperation = opts.light ? 'source-over' : 'lighter';
      for (const r of s.ribbons) {
        const base = H * r.y, step = 10, top = [], bot = [];
        for (let x = -step; x <= W + step; x += step) {
          const y = base + Math.sin(x * r.f + t * r.sp + r.ph) * r.amp + Math.sin(x * r.f * 2.3 - t * r.sp * 1.7) * r.amp * 0.3;
          const hh = r.h * (0.75 + 0.35 * Math.sin(x * 0.004 + t * 0.2 + r.ph));
          top.push([x, y]); bot.push([x, y + hh]);
        }
        const g = ctx.createLinearGradient(0, base - r.amp, 0, base + r.h + r.amp);
        const a = opts.light ? 0.16 : 0.3;
        g.addColorStop(0, rgba(r.c, 0)); g.addColorStop(0.35, rgba(r.c, a)); g.addColorStop(1, rgba(r.c, 0));
        ctx.fillStyle = g; ctx.beginPath(); ctx.moveTo(top[0][0], top[0][1]);
        for (const p of top) ctx.lineTo(p[0], p[1]);
        for (let i = bot.length - 1; i >= 0; i--) ctx.lineTo(bot[i][0], bot[i][1]);
        ctx.closePath(); ctx.fill();
      }
      ctx.globalCompositeOperation = 'source-over';
    },
  },

  waves: {
    init: () => ({ stars: starField(count(26000, 30, 90)) }),
    draw(s) {
      drawStars(s.stars.map(q => ({ ...q, y: q.y * 0.6 })), t, opts.light);
      const mx = W * 0.72, my = H * 0.2;
      stamp(opts.light ? [120, 150, 190] : [214, 232, 255], mx, my, Math.max(90, H * 0.2), opts.light ? 0.22 : 0.5);
      for (let i = 0; i < 8; i++) {
        const yb = H * (0.56 + i * 0.058), amp = 2.5 + i * 2.3, wl = 150 + i * 70, sp = 0.35 + i * 0.07;
        ctx.beginPath();
        for (let x = 0; x <= W + 8; x += 8) { const y = yb + Math.sin(x / wl * 6.2832 + t * sp + i) * amp + Math.sin(x / (wl * 0.43) - t * sp * 1.4) * amp * 0.35; if (x === 0) ctx.moveTo(x, y); else ctx.lineTo(x, y); }
        ctx.strokeStyle = opts.light ? 'rgba(40,90,150,' + (0.1 + i * 0.02) + ')' : 'rgba(120,175,235,' + (0.08 + i * 0.03) + ')';
        ctx.lineWidth = 1 + i * 0.22; ctx.stroke();
        // the moon's path on the water: short bright dashes near the moon's x
        ctx.fillStyle = opts.light ? 'rgba(255,255,255,.35)' : 'rgba(214,232,255,' + (0.1 + 0.03 * i) + ')';
        for (let k = -2; k <= 2; k++) { const x = mx + k * (14 + i * 7) + Math.sin(t * sp + k + i) * 8; ctx.fillRect(x, yb + Math.sin(x / wl * 6.2832 + t * sp + i) * amp, 16 + i * 4, 1.2); }
      }
    },
  },

  rain: {
    init: () => ({ drops: Array.from({ length: count(7000, 90, 300) }, () => ({ x: rnd(-40, W + 40), y: rnd(0, H), len: rnd(10, 26), sp: rnd(520, 900), a: rnd(0.25, 0.7) })), rip: [] }),
    draw(s, dt) {
      const c = opts.light ? [60, 90, 130] : [170, 205, 240];
      ctx.lineWidth = 1;
      for (const d of s.drops) {
        d.y += d.sp * dt; d.x -= d.sp * dt * 0.16;
        if (d.y > H + 30) { if (Math.random() < 0.05 && s.rip.length < 14) s.rip.push({ x: d.x, y: H - rnd(0, 40), r: 1, a: 0.35 }); d.y = rnd(-60, -10); d.x = rnd(-40, W + 40); }
        ctx.strokeStyle = rgba(c, d.a * (opts.light ? 0.4 : 0.45)); ctx.beginPath(); ctx.moveTo(d.x, d.y); ctx.lineTo(d.x + d.len * 0.16, d.y - d.len); ctx.stroke();
      }
      s.rip = s.rip.filter(r => { r.r += 28 * dt; r.a -= 0.5 * dt; if (r.a <= 0) return false; ctx.strokeStyle = rgba(c, r.a); ctx.beginPath(); ctx.ellipse(r.x, r.y, r.r, r.r * 0.32, 0, 0, 6.2832); ctx.stroke(); return true; });
    },
  },

  fireflies: {
    init: () => ({ f: Array.from({ length: count(30000, 24, 60) }, () => ({ x: rnd(0, W), y: rnd(H * 0.3, H), ph: rnd(0, 6.28), sp: rnd(0.4, 1.3), r: rnd(6, 14), vx: rnd(-8, 8), vy: rnd(-6, 6) })) }),
    draw(s, dt) {
      const c = opts.light ? [150, 170, 40] : [200, 255, 140];
      for (const q of s.f) {
        q.x += (q.vx + Math.sin(t * q.sp + q.ph) * 14) * dt; q.y += (q.vy + Math.cos(t * q.sp * 0.8 + q.ph) * 10) * dt;
        if (q.x < -20) q.x = W + 20; if (q.x > W + 20) q.x = -20; if (q.y < H * 0.2) q.y = H; if (q.y > H + 20) q.y = H * 0.3;
        stamp(c, q.x, q.y, q.r, (0.25 + 0.75 * Math.max(0, Math.sin(t * q.sp * 1.6 + q.ph))) * (opts.light ? 0.55 : 0.85));
      }
    },
  },

  gold: {
    init: () => ({ m: Array.from({ length: count(14000, 50, 130) }, () => ({ x: rnd(0, W), y: rnd(0, H), r: rnd(2, 8), sp: rnd(6, 22), ph: rnd(0, 6.28), fl: rnd(0.6, 2.2) })) }),
    draw(s, dt) {
      const c = opts.light ? [176, 128, 20] : [240, 200, 110];
      for (const q of s.m) {
        q.y -= q.sp * dt; q.x += Math.sin(t * 0.5 + q.ph) * 8 * dt;
        if (q.y < -20) { q.y = H + 20; q.x = rnd(0, W); }
        stamp(c, q.x, q.y, q.r * 2.2, (0.3 + 0.7 * Math.abs(Math.sin(t * q.fl + q.ph))) * (opts.light ? 0.55 : 0.8));
      }
    },
  },

  biolum: {
    init: () => ({ o: Array.from({ length: count(14000, 50, 120) }, () => ({ x: rnd(0, W), y: rnd(0, H), r: rnd(3, 11), sp: rnd(4, 16), ph: rnd(0, 6.28), k: Math.floor(rnd(0, 3)) })), blobs: Array.from({ length: 5 }, () => ({ x: rnd(0, W), y: rnd(H * 0.3, H), r: rnd(120, 260), ph: rnd(0, 6.28), k: Math.floor(rnd(0, 3)) })) }),
    draw(s, dt) {
      const P = opts.light ? [[10, 140, 130], [20, 110, 190], [30, 150, 90]] : [[60, 240, 220], [70, 160, 255], [110, 255, 170]];
      for (const b of s.blobs) stamp(P[b.k], b.x + Math.sin(t * 0.12 + b.ph) * 60, b.y + Math.cos(t * 0.1 + b.ph) * 30, b.r, (opts.light ? 0.1 : 0.14) * (0.7 + 0.3 * Math.sin(t * 0.3 + b.ph)));
      for (const q of s.o) {
        q.y -= q.sp * dt; q.x += Math.sin(t * 0.6 + q.ph) * 10 * dt;
        if (q.y < -20) { q.y = H + 20; q.x = rnd(0, W); }
        stamp(P[q.k], q.x, q.y, q.r * 2, (0.25 + 0.75 * Math.max(0, Math.sin(t * 0.9 + q.ph))) * (opts.light ? 0.5 : 0.85));
      }
    },
  },

  neural: {
    init: () => {
      const n = count(22000, 28, 80);
      return { n: Array.from({ length: n }, () => ({ x: rnd(0, W), y: rnd(0, H), vx: rnd(-9, 9), vy: rnd(-9, 9), r: rnd(1.2, 2.6), hub: Math.random() < 0.18, k: Math.floor(rnd(0, 3)) })) };
    },
    draw(s, dt) {
      const pal = opts.light ? [opts.acc.map(v => Math.round(v * 0.8)), [30, 110, 170], [100, 70, 190]] : [opts.acc, [0, 212, 255], [160, 110, 255]];
      const L = 150;
      for (const q of s.n) { q.x += q.vx * dt; q.y += q.vy * dt; if (q.x < -10) q.x = W + 10; if (q.x > W + 10) q.x = -10; if (q.y < -10) q.y = H + 10; if (q.y > H + 10) q.y = -10; }
      ctx.lineWidth = 1;
      for (let i = 0; i < s.n.length; i++) for (let j = i + 1; j < s.n.length; j++) {
        const a = s.n[i], b = s.n[j], d = Math.hypot(a.x - b.x, a.y - b.y);
        if (d < L) { ctx.strokeStyle = rgba(pal[a.k], (1 - d / L) * (opts.light ? 0.28 : 0.34)); ctx.beginPath(); ctx.moveTo(a.x, a.y); ctx.lineTo(b.x, b.y); ctx.stroke(); }
      }
      for (const q of s.n) { if (q.hub) stamp(pal[q.k], q.x, q.y, 14, 0.55); ctx.fillStyle = rgba(pal[q.k], 0.8); ctx.beginPath(); ctx.arc(q.x, q.y, q.r, 0, 6.2832); ctx.fill(); }
    },
  },

  snow: {
    init: () => ({ f: Array.from({ length: count(9000, 70, 190) }, () => ({ x: rnd(0, W), y: rnd(0, H), r: rnd(0.8, 3), sp: rnd(18, 60), sw: rnd(8, 30), ph: rnd(0, 6.28), a: rnd(0.4, 0.95) })) }),
    draw(s, dt) {
      const c = opts.light ? [120, 150, 185] : [255, 255, 255];
      for (const q of s.f) {
        q.y += q.sp * dt; q.x += Math.sin(t * 0.7 + q.ph) * q.sw * dt;
        if (q.y > H + 6) { q.y = -6; q.x = rnd(0, W); }
        ctx.fillStyle = rgba(c, q.a * (opts.light ? 0.7 : 0.85)); ctx.beginPath(); ctx.arc(q.x, q.y, q.r, 0, 6.2832); ctx.fill();
      }
    },
  },

  petals: {
    init: () => ({ p: Array.from({ length: count(40000, 22, 46) }, () => ({ x: rnd(0, W), y: rnd(-H * 0.2, H), s: rnd(5, 11), rot: rnd(0, 6.28), vr: rnd(-1.4, 1.4), sp: rnd(24, 58), sw: rnd(18, 50), ph: rnd(0, 6.28), a: rnd(0.55, 0.9) })) }),
    draw(s, dt) {
      for (const q of s.p) {
        q.y += q.sp * dt; q.x += (Math.sin(t * 0.6 + q.ph) * q.sw + 12) * dt; q.rot += q.vr * dt;
        if (q.y > H + 20 || q.x > W + 30) { q.y = rnd(-40, -10); q.x = rnd(-30, W); }
        ctx.save(); ctx.translate(q.x, q.y); ctx.rotate(q.rot); ctx.scale(1, 0.55 + 0.45 * Math.abs(Math.sin(t * 0.8 + q.ph)));
        ctx.fillStyle = opts.light ? 'rgba(214,92,140,' + q.a * 0.7 + ')' : 'rgba(255,186,212,' + q.a + ')';
        ctx.beginPath(); ctx.moveTo(0, -q.s); ctx.quadraticCurveTo(q.s * 0.9, -q.s * 0.2, 0, q.s); ctx.quadraticCurveTo(-q.s * 0.9, -q.s * 0.2, 0, -q.s); ctx.fill(); ctx.restore();
      }
    },
  },

  leaves: {
    init: () => ({ p: Array.from({ length: count(42000, 20, 44) }, () => ({ x: rnd(0, W), y: rnd(-H * 0.2, H), s: rnd(7, 14), rot: rnd(0, 6.28), vr: rnd(-1.6, 1.6), sp: rnd(30, 70), sw: rnd(24, 60), ph: rnd(0, 6.28), c: [[210, 96, 44], [236, 156, 52], [176, 62, 42], [214, 176, 64]][Math.floor(rnd(0, 4))] })) }),
    draw(s, dt) {
      for (const q of s.p) {
        q.y += q.sp * dt; q.x += (Math.sin(t * 0.5 + q.ph) * q.sw) * dt; q.rot += q.vr * dt;
        if (q.y > H + 20) { q.y = rnd(-40, -10); q.x = rnd(0, W); }
        ctx.save(); ctx.translate(q.x, q.y); ctx.rotate(q.rot); ctx.scale(0.55 + 0.45 * Math.abs(Math.sin(t * 0.9 + q.ph)), 1);
        ctx.fillStyle = rgba(q.c, opts.light ? 0.7 : 0.85);
        ctx.beginPath(); ctx.moveTo(0, -q.s); ctx.quadraticCurveTo(q.s * 0.85, 0, 0, q.s); ctx.quadraticCurveTo(-q.s * 0.85, 0, 0, -q.s); ctx.fill();
        ctx.strokeStyle = 'rgba(60,20,10,.35)'; ctx.lineWidth = 0.8; ctx.beginPath(); ctx.moveTo(0, -q.s); ctx.lineTo(0, q.s); ctx.stroke(); ctx.restore();
      }
    },
  },

  sand: {
    init: () => ({ g: Array.from({ length: count(7500, 90, 260) }, () => ({ x: rnd(0, W), y: rnd(H * 0.35, H), len: rnd(8, 34), sp: rnd(60, 220), ph: rnd(0, 6.28), a: rnd(0.12, 0.4) })) }),
    draw(s, dt) {
      const c = opts.light ? [150, 110, 60] : [236, 204, 150];
      ctx.lineWidth = 1;
      for (const q of s.g) {
        q.x += q.sp * dt; const y = q.y + Math.sin(t * 0.8 + q.ph) * 4;
        if (q.x > W + 40) { q.x = -40; q.y = rnd(H * 0.35, H); }
        ctx.strokeStyle = rgba(c, q.a * (opts.light ? 0.9 : 1)); ctx.beginPath(); ctx.moveTo(q.x, y); ctx.lineTo(q.x - q.len, y + Math.sin(q.x * 0.02 + t) * 1.4); ctx.stroke();
      }
    },
  },
};

/* ---------------------------------------------------------------------------------------------- loop */
function resize() {
  dpr = Math.min(window.devicePixelRatio || 1, 1.5);
  W = Math.max(1, window.innerWidth); H = Math.max(1, window.innerHeight);
  canvas.width = Math.round(W * dpr); canvas.height = Math.round(H * dpr);
  ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
}

function frame(now) {
  raf = 0;
  if (!fx || document.hidden) return;
  const dt = Math.min(0.05, (now - last) / 1000 || 0.033);
  if (now - last >= 32) { last = now; t += dt; ctx.clearRect(0, 0, W, H); fx.draw(st, dt); }
  raf = requestAnimationFrame(frame);
}

const animating = () => opts.motion && !(reduced && reduced.matches);

function paintOnce() { t = 14; ctx.clearRect(0, 0, W, H); fx.draw(st, 0); }

function run() {
  if (raf) cancelAnimationFrame(raf);
  raf = 0;
  if (!fx) return;
  if (animating()) { last = performance.now(); raf = requestAnimationFrame(frame); } else paintOnce();
}

function wire() {
  if (wired) return; wired = true;
  let rz = 0;
  window.addEventListener('resize', () => { clearTimeout(rz); rz = setTimeout(() => { if (!fx) return; resize(); st = fx.init(); run(); }, 180); });
  document.addEventListener('visibilitychange', () => { if (!document.hidden) run(); });
  if (reduced) { const f = () => run(); if (reduced.addEventListener) reduced.addEventListener('change', f); }
}

/** kind: key of FX or null. Safe to call repeatedly; does nothing when the canvas is missing. */
export function setScene({ kind, motion = true, light = false, accentRgb = [26, 176, 238] } = {}) {
  canvas = canvas || document.getElementById('bg-fx');
  if (!canvas) return;
  if (raf) { cancelAnimationFrame(raf); raf = 0; }
  opts = { motion, light, acc: accentRgb.map(v => Math.round(v)) };
  if (!kind || !FX[kind]) { fx = null; st = null; kindNow = null; canvas.hidden = true; return; }
  try {
    ctx = ctx || canvas.getContext('2d');
    if (!ctx) { canvas.hidden = true; return; }
    canvas.hidden = false; wire(); resize();
    fx = FX[kind]; st = fx.init(); if (kindNow !== kind) t = 0; kindNow = kind;
    run();
  } catch (e) { console.warn('Scene effect disabled:', e); fx = null; canvas.hidden = true; }
}

/** Preview helper for the settings page: is any effect running? */
export const sceneKind = () => kindNow;
