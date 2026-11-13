// Background motion: ONE fixed canvas (#bg-fx) over the chosen background photo that animates its scene: falling leaves on
// Autumn, snow on Winter, petals on Spring and Sakura, rain on Rainfall District, bubbles under Abyssal Blue, glitter on the
// water, fireflies, mist, gold dust and more (see BACKGROUNDS in appearance.js for which scene gets which effect). The photo
// underneath is plain CSS (css/app.css, .art-*), so if the canvas is switched off the scene still looks right.
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

/* Building blocks. Each part is { init(), draw(state, dt) }; compose() layers several of them into one scene. */
const compose = (...parts) => ({ init: () => parts.map(p => p.init()), draw(s, dt) { parts.forEach((p, i) => p.draw(s[i], dt)); } });

/** Twinkling stars over the top `area` of the screen, optionally with an occasional shooting star. */
const starsPart = ({ area = 0.72, per = 8500, lo = 70, hi = 260, shoot = true } = {}) => ({
  init: () => ({ stars: starField(count(per, lo, hi)).map(q => ({ ...q, y: q.y / 0.72 * area })), shoot: null, next: rnd(4, 9) }),
  draw(s, dt) {
    drawStars(s.stars, t, opts.light);
    if (!shoot) return;
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
});

/** Glowing drifting fireflies between `top` and the bottom of the screen. */
const firefliesPart = ({ top = 0.3, dark = [200, 255, 140], light = [150, 170, 40], per = 30000, lo = 24, hi = 60 } = {}) => ({
  init: () => ({ f: Array.from({ length: count(per, lo, hi) }, () => ({ x: rnd(0, W), y: rnd(H * top, H), ph: rnd(0, 6.28), sp: rnd(0.4, 1.3), r: rnd(6, 14), vx: rnd(-8, 8), vy: rnd(-6, 6) })) }),
  draw(s, dt) {
    const c = opts.light ? light : dark;
    for (const q of s.f) {
      q.x += (q.vx + Math.sin(t * q.sp + q.ph) * 14) * dt; q.y += (q.vy + Math.cos(t * q.sp * 0.8 + q.ph) * 10) * dt;
      if (q.x < -20) q.x = W + 20; if (q.x > W + 20) q.x = -20; if (q.y < H * top * 0.7) q.y = H; if (q.y > H + 20) q.y = H * top;
      stamp(c, q.x, q.y, q.r, (0.25 + 0.75 * Math.max(0, Math.sin(t * q.sp * 1.6 + q.ph))) * (opts.light ? 0.55 : 0.85));
    }
  },
});

/** Snow. wind > 0 slants it and speeds it up (flurries). */
const snowPart = ({ per = 9000, lo = 70, hi = 190, wind = 0, fall = 1 } = {}) => ({
  init: () => ({ f: Array.from({ length: count(per, lo, hi) }, () => ({ x: rnd(-60, W), y: rnd(0, H), r: rnd(0.8, 3), sp: rnd(18, 60) * fall, sw: rnd(8, 30), ph: rnd(0, 6.28), a: rnd(0.4, 0.95) })) }),
  draw(s, dt) {
    const c = opts.light ? [120, 150, 185] : [255, 255, 255];
    for (const q of s.f) {
      q.y += q.sp * dt; q.x += (Math.sin(t * 0.7 + q.ph) * q.sw + wind * (0.6 + q.r * 0.25)) * dt;
      if (q.y > H + 6 || q.x > W + 20) { q.y = -6; q.x = rnd(-40, W); }
      ctx.fillStyle = rgba(c, q.a * (opts.light ? 0.7 : 0.85)); ctx.beginPath(); ctx.arc(q.x, q.y, q.r, 0, 6.2832); ctx.fill();
    }
  },
});

/** Tumbling petals. */
const petalsPart = ({ per = 40000, lo = 22, hi = 46, dark = [255, 186, 212], light = [214, 92, 140] } = {}) => ({
  init: () => ({ p: Array.from({ length: count(per, lo, hi) }, () => ({ x: rnd(0, W), y: rnd(-H * 0.2, H), s: rnd(5, 11), rot: rnd(0, 6.28), vr: rnd(-1.4, 1.4), sp: rnd(24, 58), sw: rnd(18, 50), ph: rnd(0, 6.28), a: rnd(0.55, 0.9) })) }),
  draw(s, dt) {
    for (const q of s.p) {
      q.y += q.sp * dt; q.x += (Math.sin(t * 0.6 + q.ph) * q.sw + 12) * dt; q.rot += q.vr * dt;
      if (q.y > H + 20 || q.x > W + 30) { q.y = rnd(-40, -10); q.x = rnd(-30, W); }
      ctx.save(); ctx.translate(q.x, q.y); ctx.rotate(q.rot); ctx.scale(1, 0.55 + 0.45 * Math.abs(Math.sin(t * 0.8 + q.ph)));
      ctx.fillStyle = rgba(opts.light ? light : dark, opts.light ? q.a * 0.7 : q.a);
      ctx.beginPath(); ctx.moveTo(0, -q.s); ctx.quadraticCurveTo(q.s * 0.9, -q.s * 0.2, 0, q.s); ctx.quadraticCurveTo(-q.s * 0.9, -q.s * 0.2, 0, -q.s); ctx.fill(); ctx.restore();
    }
  },
});

/** Sunlit sparkles on water: short twinkles inside the lower `[x0..1] x [y0..y1]` part of the screen. */
const glintsPart = ({ x0 = 0.2, x1 = 1, y0 = 0.5, y1 = 0.95, per = 9000, lo = 40, hi = 140, dark = [255, 255, 255], light = [255, 255, 255] } = {}) => ({
  init: () => ({ g: Array.from({ length: count(per, lo, hi) }, () => ({ x: rnd(W * x0, W * x1), y: rnd(H * y0, H * y1), ph: rnd(0, 6.28), sp: rnd(0.7, 2.2), r: rnd(3, 9) })) }),
  draw(s) {
    const c = opts.light ? light : dark;
    for (const q of s.g) {
      const k = Math.max(0, Math.sin(t * q.sp + q.ph)); const a = Math.pow(k, 7);
      if (a < 0.03) continue;
      stamp(c, q.x, q.y, q.r * 1.4, a * (opts.light ? 0.7 : 0.9));
      ctx.strokeStyle = rgba(c, a * 0.85); ctx.lineWidth = 1; ctx.beginPath(); ctx.moveTo(q.x - q.r * 1.3, q.y); ctx.lineTo(q.x + q.r * 1.3, q.y); ctx.moveTo(q.x, q.y - q.r * 0.8); ctx.lineTo(q.x, q.y + q.r * 0.8); ctx.stroke();
    }
  },
});

/** Slow fog banks drifting sideways. */
const mistPart = ({ dark = [200, 220, 215], light = [255, 255, 255], n = 6, top = 0.35 } = {}) => ({
  init: () => ({ b: Array.from({ length: n }, (_, i) => ({ x: rnd(0, W), y: rnd(H * top, H * 0.95), r: rnd(180, 340) * Math.max(0.7, W / 1500), sp: rnd(5, 14) * (i % 2 ? 1 : -1), ph: rnd(0, 6.28) })) }),
  draw(s, dt) {
    const c = opts.light ? light : dark;
    for (const q of s.b) {
      q.x += q.sp * dt; if (q.x > W + q.r) q.x = -q.r; if (q.x < -q.r) q.x = W + q.r;
      stamp(c, q.x, q.y + Math.sin(t * 0.07 + q.ph) * 18, q.r, (opts.light ? 0.2 : 0.13) * (0.75 + 0.25 * Math.sin(t * 0.15 + q.ph)));
    }
  },
});

const FX = {
  /* kept from the earlier scene set */
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

  /* seasons */
  blossom: petalsPart({ per: 52000, lo: 16, hi: 34, dark: [255, 224, 232], light: [226, 120, 160] }),            // Spring: a light fall of pale blossom
  sakura: petalsPart({ per: 30000, lo: 30, hi: 60 }),                                                              // Sakura Reverie: a heavy pink fall
  snow: snowPart(),                                                                                                  // Winter: gentle snowfall
  flurry: snowPart({ per: 11000, lo: 60, hi: 160, wind: 70, fall: 1.35 }),                                           // Nordic Kingdom: wind-driven flurries
  summernight: compose(starsPart({ area: 0.5, per: 14000, lo: 40, hi: 150, shoot: false }), firefliesPart({ top: 0.55, per: 36000, lo: 18, hi: 44 })),

  /* landscapes */
  seaglint: glintsPart({ x0: 0.3, x1: 1, y0: 0.48, y1: 0.92, per: 8000, lo: 50, hi: 170 }),
  mist: compose(mistPart({ n: 6 }), firefliesPart({ top: 0.5, dark: [235, 245, 210], light: [180, 190, 120], per: 70000, lo: 8, hi: 20 })),
  lanternfly: compose(mistPart({ n: 5, dark: [190, 215, 205] }), firefliesPart({ top: 0.35, dark: [255, 214, 130], light: [200, 140, 40], per: 26000, lo: 26, hi: 64 })),

  /* night and water */
  moonwater: compose(starsPart({ area: 0.46, per: 11000, lo: 50, hi: 190 }), glintsPart({ x0: 0.52, x1: 0.96, y0: 0.52, y1: 0.95, per: 14000, lo: 36, hi: 110, dark: [214, 232, 255], light: [255, 255, 255] })),
  biolumsky: compose(starsPart({ area: 0.45, per: 12000, lo: 40, hi: 160, shoot: false }), {
    init: () => ({ o: Array.from({ length: count(14000, 50, 120) }, () => ({ x: rnd(0, W), y: rnd(H * 0.45, H), r: rnd(3, 11), sp: rnd(4, 16), ph: rnd(0, 6.28), k: Math.floor(rnd(0, 3)) })), blobs: Array.from({ length: 5 }, () => ({ x: rnd(W * 0.3, W), y: rnd(H * 0.6, H), r: rnd(120, 260), ph: rnd(0, 6.28), k: Math.floor(rnd(0, 3)) })) }),
    draw(s, dt) {
      const P = opts.light ? [[10, 140, 130], [20, 110, 190], [30, 150, 90]] : [[60, 240, 220], [70, 160, 255], [110, 255, 170]];
      for (const b of s.blobs) stamp(P[b.k], b.x + Math.sin(t * 0.12 + b.ph) * 60, b.y + Math.cos(t * 0.1 + b.ph) * 30, b.r, (opts.light ? 0.1 : 0.14) * (0.7 + 0.3 * Math.sin(t * 0.3 + b.ph)));
      for (const q of s.o) {
        q.y -= q.sp * dt; q.x += Math.sin(t * 0.6 + q.ph) * 10 * dt;
        if (q.y < H * 0.4) { q.y = H + 20; q.x = rnd(0, W); }
        stamp(P[q.k], q.x, q.y, q.r * 2, (0.25 + 0.75 * Math.max(0, Math.sin(t * 0.9 + q.ph))) * (opts.light ? 0.5 : 0.85));
      }
    },
  }),
  cosmos: compose(starsPart({ area: 1, per: 7000, lo: 90, hi: 320 }), {
    init: () => ({ b: Array.from({ length: 5 }, () => ({ x: rnd(0, W), y: rnd(0, H), r: rnd(220, 420), sp: rnd(-6, 6), ph: rnd(0, 6.28), k: Math.floor(rnd(0, 3)) })) }),
    draw(s, dt) {
      const P = opts.light ? [[120, 90, 200], [40, 140, 170], [90, 110, 210]] : [[140, 100, 255], [60, 220, 200], [100, 140, 255]];
      for (const b of s.b) { b.x += b.sp * dt; if (b.x > W + b.r) b.x = -b.r; if (b.x < -b.r) b.x = W + b.r; stamp(P[b.k], b.x, b.y, b.r, (opts.light ? 0.07 : 0.1) * (0.7 + 0.3 * Math.sin(t * 0.2 + b.ph))); }
    },
  }),
  bubbles: {
    init: () => ({
      b: Array.from({ length: count(16000, 24, 70) }, () => ({ x: rnd(0, W), y: rnd(0, H), r: rnd(1.5, 6), sp: rnd(16, 52), sw: rnd(6, 20), ph: rnd(0, 6.28) })),
      d: Array.from({ length: count(6000, 60, 200) }, () => ({ x: rnd(0, W), y: rnd(0, H), r: rnd(0.5, 1.6), sp: rnd(2, 9), ph: rnd(0, 6.28), a: rnd(0.15, 0.5) })),
    }),
    draw(s, dt) {
      // slow light shafts from the surface
      ctx.globalCompositeOperation = opts.light ? 'source-over' : 'lighter';
      for (let i = 0; i < 4; i++) {
        const x0 = W * (0.1 + 0.2 * i) + Math.sin(t * 0.12 + i * 1.7) * 36, wd = W * 0.07;
        const g = ctx.createLinearGradient(x0, 0, x0 + W * 0.2, H * 0.85);
        g.addColorStop(0, rgba([170, 240, 255], (opts.light ? 0.07 : 0.1) * (0.6 + 0.4 * Math.sin(t * 0.25 + i * 2)))); g.addColorStop(1, rgba([170, 240, 255], 0));
        ctx.fillStyle = g; ctx.beginPath(); ctx.moveTo(x0, 0); ctx.lineTo(x0 + wd, 0); ctx.lineTo(x0 + W * 0.3, H * 0.85); ctx.lineTo(x0 + W * 0.18, H * 0.85); ctx.closePath(); ctx.fill();
      }
      ctx.globalCompositeOperation = 'source-over';
      for (const q of s.d) { q.y -= q.sp * dt; q.x += Math.sin(t * 0.3 + q.ph) * 4 * dt; if (q.y < -4) { q.y = H + 4; q.x = rnd(0, W); } ctx.fillStyle = rgba([220, 245, 255], q.a * (opts.light ? 0.6 : 1)); ctx.beginPath(); ctx.arc(q.x, q.y, q.r, 0, 6.2832); ctx.fill(); }
      ctx.lineWidth = 1;
      for (const q of s.b) {
        q.y -= q.sp * dt; q.x += Math.sin(t * 0.9 + q.ph) * q.sw * dt;
        if (q.y < -10) { q.y = H + 10; q.x = rnd(0, W); }
        ctx.strokeStyle = rgba(opts.light ? [40, 110, 130] : [200, 240, 255], opts.light ? 0.5 : 0.42); ctx.beginPath(); ctx.arc(q.x, q.y, q.r, 0, 6.2832); ctx.stroke();
        ctx.fillStyle = rgba([255, 255, 255], 0.5); ctx.beginPath(); ctx.arc(q.x - q.r * 0.35, q.y - q.r * 0.35, Math.max(0.5, q.r * 0.22), 0, 6.2832); ctx.fill();
      }
    },
  },

  /* abstract */
  sheen: {
    init: () => ({ sp: [...Array(26)].map(() => ({ x: rnd(0, W), y: rnd(0, H), r: rnd(1, 2.4), ph: rnd(0, 6.28), sp: rnd(0.4, 1.4) })) }),
    draw(s) {
      const c = opts.light ? [60, 100, 130] : opts.acc;
      const p = ((t * 0.045) % 1.7) - 0.35;
      ctx.save(); ctx.translate(W * p, 0); ctx.rotate(0.38);
      const g = ctx.createLinearGradient(-170, 0, 170, 0);
      g.addColorStop(0, rgba(c, 0)); g.addColorStop(0.5, rgba(c, opts.light ? 0.1 : 0.13)); g.addColorStop(1, rgba(c, 0));
      ctx.fillStyle = g; ctx.fillRect(-170, -H, 340, H * 3); ctx.restore();
      for (const q of s.sp) { const a = Math.pow(Math.max(0, Math.sin(t * q.sp + q.ph)), 6); if (a > 0.03) stamp(c, q.x, q.y, q.r * 5, a * (opts.light ? 0.5 : 0.7)); }
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
