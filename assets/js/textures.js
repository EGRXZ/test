// Canvas-drawn screen contents for the 3D devices. Everything stays in the
// Umbrel palette: black canvas, white type, peach for the "emotional" bits,
// app-store gradients for icon tiles.
import * as THREE from 'three';

const C = {
  black: '#000000',
  graphite: '#0b2b36',
  charcoal: '#304040',
  smoke: '#5b7065',
  white: '#ffffff',
  fog: '#c9d1c8',
  ash: '#93a39a',
  lilac: '#7f9389',
  peach: '#9db8a6',
  violet: '#5b7065',
};

const FONT = '"Inter", system-ui, -apple-system, "Segoe UI", Roboto, sans-serif';

function canvas(w, h) {
  const c = document.createElement('canvas');
  c.width = w;
  c.height = h;
  const ctx = c.getContext('2d');
  return { c, ctx };
}

function font(ctx, weight, size, tracking = 0) {
  ctx.font = `${weight} ${size}px ${FONT}`;
  if ('letterSpacing' in ctx) ctx.letterSpacing = `${tracking * size}px`;
}

function rr(ctx, x, y, w, h, r) {
  ctx.beginPath();
  ctx.roundRect ? ctx.roundRect(x, y, w, h, r) : ctx.rect(x, y, w, h);
}

function glow(ctx, x, y, r, color, alpha) {
  const g = ctx.createRadialGradient(x, y, 0, x, y, r);
  g.addColorStop(0, color);
  g.addColorStop(1, 'rgba(0,0,0,0)');
  ctx.globalAlpha = alpha;
  ctx.fillStyle = g;
  ctx.fillRect(x - r, y - r, r * 2, r * 2);
  ctx.globalAlpha = 1;
}

function wallpaper(ctx, w, h, seed = 0) {
  ctx.fillStyle = C.black;
  ctx.fillRect(0, 0, w, h);
  glow(ctx, w * (0.18 + seed * 0.1), h * 0.12, w * 0.9, 'rgba(157,184,166,0.55)', 0.9);
  glow(ctx, w * 0.95, h * 0.95, w * 0.8, 'rgba(91,112,101,0.55)', 0.7);
  glow(ctx, w * 0.5, h * 0.55, w * 0.5, 'rgba(48,64,64,0.4)', 0.5);
}

const GRADS = [
  ['#9db8a6', '#304040'],
  ['#c9d1c8', '#5b7065'],
  ['#5b7065', '#04202c'],
  ['#7f9c8a', '#0b2b36'],
  ['#304040', '#0b2b36'],
  ['#5b7065', '#0b2b36'],
];

function appIcon(ctx, x, y, s, i, glyph) {
  ctx.save();
  const [a, b] = GRADS[i % GRADS.length];
  const g = ctx.createLinearGradient(x + s, y, x, y + s);
  g.addColorStop(0, a);
  g.addColorStop(1, b);
  ctx.fillStyle = g;
  rr(ctx, x, y, s, s, s * 0.26);
  ctx.fill();
  if (glyph) {
    ctx.fillStyle = 'rgba(255,255,255,0.92)';
    font(ctx, 600, s * 0.42, -0.03);
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    ctx.fillText(glyph, x + s / 2, y + s / 2 + s * 0.02);
  }
  ctx.restore();
}

function statusBar(ctx, w, pad, size) {
  ctx.fillStyle = C.white;
  font(ctx, 600, size, -0.02);
  ctx.textAlign = 'left';
  ctx.textBaseline = 'top';
  ctx.fillText('10:24', pad, pad * 0.7);
  // battery + signal
  const bx = w - pad - size * 1.9;
  const by = pad * 0.7 + size * 0.12;
  ctx.strokeStyle = 'rgba(255,255,255,0.9)';
  ctx.lineWidth = size * 0.08;
  rr(ctx, bx, by, size * 1.6, size * 0.8, size * 0.2);
  ctx.stroke();
  ctx.fillStyle = C.white;
  rr(ctx, bx + size * 0.14, by + size * 0.14, size * 1.2, size * 0.52, size * 0.1);
  ctx.fill();
  for (let i = 0; i < 4; i++) {
    const hh = size * (0.25 + i * 0.17);
    ctx.fillRect(bx - size * 1.5 + i * size * 0.28, by + size * 0.8 - hh, size * 0.18, hh);
  }
}

function toTexture(c, renderer) {
  const t = new THREE.CanvasTexture(c);
  t.colorSpace = THREE.SRGBColorSpace;
  t.anisotropy = renderer ? Math.min(8, renderer.capabilities.getMaxAnisotropy()) : 4;
  t.needsUpdate = true;
  return t;
}

// Unfolded inner screen of a Fold (nearly square). aspect = width / height.
export function foldInnerTexture(aspect, renderer) {
  const h = 1400;
  const w = Math.round(h * aspect);
  const { c, ctx } = canvas(w, h);
  wallpaper(ctx, w, h);
  const pad = w * 0.06;
  statusBar(ctx, w, pad, h * 0.026);

  // Clock
  ctx.fillStyle = C.white;
  ctx.textAlign = 'left';
  ctx.textBaseline = 'alphabetic';
  font(ctx, 600, h * 0.13, -0.05);
  ctx.fillText('10:24', pad, h * 0.25);
  font(ctx, 500, h * 0.03, -0.02);
  ctx.fillStyle = C.fog;
  ctx.fillText('пятница, 2 октября', pad + h * 0.006, h * 0.32);

  // Repair status widget (right half)
  const wx = w * 0.53, wy = h * 0.1, ww = w * 0.41, wh = h * 0.25;
  ctx.fillStyle = 'rgba(8,36,46,0.82)';
  rr(ctx, wx, wy, ww, wh, h * 0.03);
  ctx.fill();
  ctx.fillStyle = C.peach;
  font(ctx, 600, h * 0.022, -0.01);
  ctx.fillText('FOLDPROFI', wx + h * 0.03, wy + h * 0.06);
  ctx.fillStyle = C.white;
  font(ctx, 600, h * 0.036, -0.03);
  ctx.fillText('Ремонт завершён', wx + h * 0.03, wy + h * 0.115);
  ctx.fillStyle = C.ash;
  font(ctx, 500, h * 0.021, -0.01);
  ctx.fillText('Гибкий экран · гарантия 1 год', wx + h * 0.03, wy + h * 0.155);
  ctx.fillStyle = C.charcoal;
  rr(ctx, wx + h * 0.03, wy + h * 0.19, ww - h * 0.06, h * 0.014, h * 0.007);
  ctx.fill();
  ctx.fillStyle = C.peach;
  rr(ctx, wx + h * 0.03, wy + h * 0.19, ww - h * 0.06, h * 0.014, h * 0.007);
  ctx.fill();

  // App grid
  const glyphs = ['F', '', '', 'M', '', '', '', '♪', '', '', '', ''];
  const cols = 6, rows = 2;
  const gap = w * 0.035;
  const s = (w - pad * 2 - gap * (cols - 1)) / cols;
  const gy = h * 0.58;
  for (let r = 0; r < rows; r++) {
    for (let i = 0; i < cols; i++) {
      appIcon(ctx, pad + i * (s + gap), gy + r * (s + gap * 1.4), s, i + r * 3, glyphs[i + r * cols]);
    }
  }
  // Dock
  ctx.fillStyle = 'rgba(255,255,255,0.08)';
  rr(ctx, pad * 0.6, h * 0.86, w - pad * 1.2, s + gap * 0.9, h * 0.04);
  ctx.fill();
  for (let i = 0; i < cols; i++) {
    appIcon(ctx, pad + i * (s + gap), h * 0.86 + gap * 0.45, s, (i + 4) % GRADS.length, '');
  }
  // Crease hint
  const cg = ctx.createLinearGradient(w / 2 - w * 0.02, 0, w / 2 + w * 0.02, 0);
  cg.addColorStop(0, 'rgba(255,255,255,0)');
  cg.addColorStop(0.5, 'rgba(255,255,255,0.05)');
  cg.addColorStop(1, 'rgba(255,255,255,0)');
  ctx.fillStyle = cg;
  ctx.fillRect(w / 2 - w * 0.02, 0, w * 0.04, h);
  return toTexture(c, renderer);
}

// Narrow cover screen of a folded Fold.
export function foldCoverTexture(aspect, renderer) {
  const h = 1400;
  const w = Math.round(h * aspect);
  const { c, ctx } = canvas(w, h);
  wallpaper(ctx, w, h, 0.4);
  const pad = w * 0.09;
  statusBar(ctx, w, pad, h * 0.024);
  ctx.fillStyle = C.white;
  ctx.textAlign = 'left';
  ctx.textBaseline = 'alphabetic';
  font(ctx, 600, w * 0.3, -0.05);
  ctx.fillText('10:24', pad, h * 0.26);
  ctx.fillStyle = C.fog;
  font(ctx, 500, w * 0.065, -0.02);
  ctx.fillText('пт, 2 октября', pad + 4, h * 0.31);

  // Notification
  const nx = pad * 0.6, ny = h * 0.7, nw = w - pad * 1.2, nh = h * 0.16;
  ctx.fillStyle = 'rgba(8,36,46,0.88)';
  rr(ctx, nx, ny, nw, nh, w * 0.07);
  ctx.fill();
  appIcon(ctx, nx + w * 0.05, ny + nh / 2 - w * 0.09, w * 0.18, 1, 'F');
  ctx.fillStyle = C.peach;
  font(ctx, 600, w * 0.052, 0);
  ctx.fillText('FoldProfi', nx + w * 0.28, ny + nh * 0.36);
  ctx.fillStyle = C.white;
  font(ctx, 600, w * 0.066, -0.03);
  ctx.fillText('Телефон готов', nx + w * 0.28, ny + nh * 0.6);
  ctx.fillStyle = C.ash;
  font(ctx, 500, w * 0.05, -0.01);
  ctx.fillText('Можно забирать ✓', nx + w * 0.28, ny + nh * 0.82);
  return toTexture(c, renderer);
}

// Inner screen of a Flip (tall).
export function flipInnerTexture(aspect, renderer) {
  const h = 1600;
  const w = Math.round(h * aspect);
  const { c, ctx } = canvas(w, h);
  wallpaper(ctx, w, h, 0.8);
  const pad = w * 0.08;
  statusBar(ctx, w, pad, h * 0.02);
  ctx.fillStyle = C.white;
  ctx.textAlign = 'center';
  ctx.textBaseline = 'alphabetic';
  font(ctx, 600, w * 0.3, -0.05);
  ctx.fillText('10:24', w / 2, h * 0.2);
  ctx.fillStyle = C.fog;
  font(ctx, 500, w * 0.05, -0.02);
  ctx.fillText('пятница, 2 октября', w / 2, h * 0.245);
  const cols = 4;
  const gap = w * 0.06;
  const s = (w - pad * 2 - gap * (cols - 1)) / cols;
  for (let r = 0; r < 3; r++) {
    for (let i = 0; i < cols; i++) {
      appIcon(ctx, pad + i * (s + gap), h * 0.52 + r * (s + gap * 1.3), s, i + r * 2, '');
    }
  }
  return toTexture(c, renderer);
}

// Square-ish outer screen of a folded Flip.
export function flipCoverTexture(aspect, renderer) {
  const h = 800;
  const w = Math.round(h * aspect);
  const { c, ctx } = canvas(w, h);
  ctx.fillStyle = C.black;
  ctx.fillRect(0, 0, w, h);
  glow(ctx, w * 0.2, h * 0.1, w * 0.9, 'rgba(157,184,166,0.6)', 0.9);
  ctx.fillStyle = C.white;
  ctx.textAlign = 'left';
  ctx.textBaseline = 'alphabetic';
  font(ctx, 600, h * 0.2, -0.05);
  ctx.fillText('10:24', w * 0.4, h * 0.4);
  ctx.fillStyle = C.fog;
  font(ctx, 500, h * 0.06, -0.02);
  ctx.fillText('Ремонт готов ✓', w * 0.405, h * 0.53);
  return toTexture(c, renderer);
}

// Classic slab smartphone lock screen.
export function barTexture(aspect, renderer) {
  const h = 1600;
  const w = Math.round(h * aspect);
  const { c, ctx } = canvas(w, h);
  wallpaper(ctx, w, h, 0.2);
  const pad = w * 0.08;
  statusBar(ctx, w, pad, h * 0.02);
  ctx.fillStyle = C.white;
  ctx.textAlign = 'center';
  ctx.textBaseline = 'alphabetic';
  font(ctx, 500, w * 0.055, -0.02);
  ctx.fillStyle = C.fog;
  ctx.fillText('пятница, 2 октября', w / 2, h * 0.13);
  ctx.fillStyle = C.white;
  font(ctx, 600, w * 0.32, -0.05);
  ctx.fillText('10:24', w / 2, h * 0.27);

  const nx = pad * 0.6, ny = h * 0.72, nw = w - pad * 1.2, nh = h * 0.1;
  ctx.fillStyle = 'rgba(8,36,46,0.85)';
  rr(ctx, nx, ny, nw, nh, w * 0.06);
  ctx.fill();
  appIcon(ctx, nx + w * 0.04, ny + nh / 2 - w * 0.07, w * 0.14, 0, 'F');
  ctx.textAlign = 'left';
  ctx.fillStyle = C.white;
  font(ctx, 600, w * 0.05, -0.03);
  ctx.fillText('Стекло заменено', nx + w * 0.22, ny + nh * 0.45);
  ctx.fillStyle = C.ash;
  font(ctx, 500, w * 0.04, -0.01);
  ctx.fillText('FoldProfi · гарантия 1 год', nx + w * 0.22, ny + nh * 0.75);
  return toTexture(c, renderer);
}

// Watch face.
export function watchTexture(aspect, renderer) {
  const h = 900;
  const w = Math.round(h * aspect);
  const { c, ctx } = canvas(w, h);
  ctx.fillStyle = C.black;
  ctx.fillRect(0, 0, w, h);
  const cx = w / 2, cy = h / 2, R = Math.min(w, h) * 0.42;
  ctx.lineCap = 'round';
  for (let i = 0; i < 60; i++) {
    const a = (i / 60) * Math.PI * 2;
    const big = i % 5 === 0;
    ctx.strokeStyle = big ? C.white : C.smoke;
    ctx.lineWidth = big ? 6 : 3;
    const r1 = R * (big ? 0.86 : 0.92);
    ctx.beginPath();
    ctx.moveTo(cx + Math.sin(a) * r1, cy - Math.cos(a) * r1);
    ctx.lineTo(cx + Math.sin(a) * R, cy - Math.cos(a) * R);
    ctx.stroke();
  }
  // Activity ring
  ctx.strokeStyle = 'rgba(157,184,166,0.22)';
  ctx.lineWidth = 18;
  ctx.beginPath();
  ctx.arc(cx, cy, R * 0.66, 0, Math.PI * 2);
  ctx.stroke();
  ctx.strokeStyle = C.peach;
  ctx.beginPath();
  ctx.arc(cx, cy, R * 0.66, -Math.PI / 2, -Math.PI / 2 + Math.PI * 1.55);
  ctx.stroke();
  ctx.fillStyle = C.white;
  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';
  font(ctx, 600, R * 0.5, -0.05);
  ctx.fillText('10:24', cx, cy - R * 0.04);
  ctx.fillStyle = C.ash;
  font(ctx, 500, R * 0.13, 0);
  ctx.fillText('100% · как новые', cx, cy + R * 0.32);
  return toTexture(c, renderer);
}

// Scratched old protective film (used as alpha/colour on the film mesh).
export function scratchedFilmTexture(renderer) {
  const s = 1024;
  const { c, ctx } = canvas(s, s);
  ctx.fillStyle = 'rgb(110,110,110)';
  ctx.fillRect(0, 0, s, s);
  let seed = 7;
  const rnd = () => ((seed = (seed * 16807) % 2147483647) / 2147483647);
  ctx.lineCap = 'round';
  for (let i = 0; i < 140; i++) {
    const x = rnd() * s, y = rnd() * s, l = 30 + rnd() * 260, a = rnd() * Math.PI;
    ctx.strokeStyle = `rgba(255,255,255,${0.25 + rnd() * 0.6})`;
    ctx.lineWidth = 0.6 + rnd() * 2.2;
    ctx.beginPath();
    ctx.moveTo(x, y);
    ctx.lineTo(x + Math.cos(a) * l, y + Math.sin(a) * l);
    ctx.stroke();
  }
  for (let i = 0; i < 12; i++) {
    glow(ctx, rnd() * s, rnd() * s, 40 + rnd() * 120, 'rgba(255,255,255,0.35)', 0.5);
  }
  return toTexture(c, renderer);
}

export function ensureFonts() {
  if (!document.fonts || !document.fonts.load) return Promise.resolve();
  const loads = ['500 40px Inter', '600 40px Inter'].map((f) => document.fonts.load(f, 'Ремонт 10:24'));
  const timeout = new Promise((r) => setTimeout(r, 2500));
  return Promise.race([Promise.all(loads), timeout]).catch(() => {});
}
