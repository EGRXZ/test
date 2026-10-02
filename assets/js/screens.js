// Live home screens for the Blender phones: the model's own wallpaper is the
// background, a small animated UI (real clock, widgets, app grid, pop-up
// notifications) is drawn on top in a canvas and streamed to the screen.
import * as THREE from 'three';

const FONT = '"Inter", system-ui, -apple-system, "Segoe UI", Roboto, sans-serif';
const C = {
  white: '#ffffff', fog: '#cccccc', ash: '#9e9e9e', graphite: '#191919',
  charcoal: '#3d3d3d', peach: '#e3a081', violet: '#5351f3',
};
const GRADS = [
  ['#0056ff', '#c28e01'], ['#855dff', '#fe7900'], ['#591010', '#ff3b3b'],
  ['#0657a1', '#051e22'], ['#5351f3', '#191919'], ['#3d3d3d', '#191919'],
  ['#e3a081', '#8a4b2e'], ['#1e53a1', '#5351f3'],
];
const DAYS = ['воскресенье', 'понедельник', 'вторник', 'среда', 'четверг', 'пятница', 'суббота'];
const MONTHS = ['января', 'февраля', 'марта', 'апреля', 'мая', 'июня', 'июля', 'августа', 'сентября', 'октября', 'ноября', 'декабря'];

const ease = (x) => 1 - Math.pow(1 - Math.min(1, Math.max(0, x)), 3);
const pad2 = (n) => String(n).padStart(2, '0');

function font(ctx, w, size, tr = 0) {
  ctx.font = `${w} ${size}px ${FONT}`;
  if ('letterSpacing' in ctx) ctx.letterSpacing = `${tr * size}px`;
}
function rr(ctx, x, y, w, h, r) {
  ctx.beginPath();
  if (ctx.roundRect) ctx.roundRect(x, y, w, h, r); else ctx.rect(x, y, w, h);
}
function now() {
  const d = new Date();
  return { hm: `${pad2(d.getHours())}:${pad2(d.getMinutes())}`, date: `${DAYS[d.getDay()]}, ${d.getDate()} ${MONTHS[d.getMonth()]}`, short: `${DAYS[d.getDay()].slice(0, 2)}, ${d.getDate()} ${MONTHS[d.getMonth()]}` };
}

// Simple line glyphs so icons read without emoji fonts.
const GLYPHS = {
  phone(ctx, s) { ctx.beginPath(); ctx.moveTo(-0.22 * s, -0.26 * s); ctx.quadraticCurveTo(-0.3 * s, 0.1 * s, 0.2 * s, 0.28 * s); ctx.stroke(); },
  chat(ctx, s) { rr(ctx, -0.26 * s, -0.2 * s, 0.52 * s, 0.36 * s, 0.12 * s); ctx.stroke(); },
  camera(ctx, s) { rr(ctx, -0.27 * s, -0.17 * s, 0.54 * s, 0.38 * s, 0.08 * s); ctx.stroke(); ctx.beginPath(); ctx.arc(0, 0.02 * s, 0.1 * s, 0, 7); ctx.stroke(); },
  photo(ctx, s) { ctx.beginPath(); ctx.arc(0, 0, 0.22 * s, 0, 7); ctx.stroke(); ctx.beginPath(); ctx.arc(0, 0, 0.07 * s, 0, 7); ctx.fill(); },
  map(ctx, s) { ctx.beginPath(); ctx.arc(0, -0.06 * s, 0.14 * s, Math.PI, 0); ctx.lineTo(0, 0.26 * s); ctx.closePath(); ctx.stroke(); },
  music(ctx, s) { ctx.beginPath(); ctx.moveTo(-0.08 * s, 0.16 * s); ctx.lineTo(-0.08 * s, -0.22 * s); ctx.lineTo(0.2 * s, -0.27 * s); ctx.lineTo(0.2 * s, 0.1 * s); ctx.stroke(); ctx.beginPath(); ctx.arc(-0.14 * s, 0.17 * s, 0.07 * s, 0, 7); ctx.arc(0.14 * s, 0.11 * s, 0.07 * s, 0, 7); ctx.fill(); },
  mail(ctx, s) { rr(ctx, -0.26 * s, -0.17 * s, 0.52 * s, 0.34 * s, 0.05 * s); ctx.stroke(); ctx.beginPath(); ctx.moveTo(-0.24 * s, -0.14 * s); ctx.lineTo(0, 0.04 * s); ctx.lineTo(0.24 * s, -0.14 * s); ctx.stroke(); },
  gear(ctx, s) { ctx.beginPath(); ctx.arc(0, 0, 0.18 * s, 0, 7); ctx.stroke(); ctx.beginPath(); ctx.arc(0, 0, 0.06 * s, 0, 7); ctx.fill(); },
  fold(ctx, s) { rr(ctx, -0.22 * s, -0.24 * s, 0.2 * s, 0.48 * s, 0.05 * s); ctx.stroke(); ctx.beginPath(); ctx.moveTo(0.02 * s, -0.24 * s); ctx.lineTo(0.18 * s, -0.24 * s); ctx.quadraticCurveTo(0.24 * s, -0.24 * s, 0.24 * s, -0.18 * s); ctx.lineTo(0.24 * s, 0.18 * s); ctx.quadraticCurveTo(0.24 * s, 0.24 * s, 0.18 * s, 0.24 * s); ctx.lineTo(0.02 * s, 0.24 * s); ctx.stroke(); },
  clock(ctx, s) { ctx.beginPath(); ctx.arc(0, 0, 0.22 * s, 0, 7); ctx.moveTo(0, -0.12 * s); ctx.lineTo(0, 0); ctx.lineTo(0.1 * s, 0.06 * s); ctx.stroke(); },
};
const APPS = [
  ['Телефон', 'phone', 3], ['Сообщения', 'chat', 7], ['Камера', 'camera', 5], ['Фото', 'photo', 1],
  ['Карты', 'map', 0], ['Музыка', 'music', 2], ['Почта', 'mail', 4], ['Настройки', 'gear', 5],
];

function icon(ctx, x, y, s, gi, glyph, pressed = 0) {
  ctx.save();
  const k = 1 - pressed * 0.08;
  ctx.translate(x + s / 2, y + s / 2);
  ctx.scale(k, k);
  const [a, b] = GRADS[gi % GRADS.length];
  const g = ctx.createLinearGradient(s / 2, -s / 2, -s / 2, s / 2);
  g.addColorStop(0, a); g.addColorStop(1, b);
  ctx.fillStyle = g;
  rr(ctx, -s / 2, -s / 2, s, s, s * 0.26);
  ctx.fill();
  ctx.strokeStyle = ctx.fillStyle = 'rgba(255,255,255,0.95)';
  ctx.lineWidth = s * 0.06;
  ctx.lineCap = ctx.lineJoin = 'round';
  if (GLYPHS[glyph]) GLYPHS[glyph](ctx, s);
  ctx.restore();
}

function statusBar(ctx, w, y, size, t) {
  const { hm } = now();
  ctx.fillStyle = C.white;
  font(ctx, 600, size, -0.02);
  ctx.textAlign = 'left';
  ctx.textBaseline = 'middle';
  ctx.fillText(hm, w * 0.09, y);
  // signal + battery (charging pulse)
  const bx = w * 0.82, s = size;
  for (let i = 0; i < 4; i++) {
    const h = s * (0.3 + i * 0.17);
    ctx.fillRect(bx - s * 1.6 + i * s * 0.3, y + s * 0.35 - h, s * 0.2, h);
  }
  ctx.strokeStyle = 'rgba(255,255,255,0.9)';
  ctx.lineWidth = s * 0.09;
  rr(ctx, bx, y - s * 0.38, s * 1.7, s * 0.76, s * 0.22);
  ctx.stroke();
  const lvl = 0.62 + 0.3 * (0.5 + 0.5 * Math.sin(t * 0.6));
  ctx.fillStyle = C.white;
  rr(ctx, bx + s * 0.15, y - s * 0.23, s * 1.4 * lvl, s * 0.46, s * 0.1);
  ctx.fill();
}

function scrim(ctx, w, h, a = 0.28) {
  const g = ctx.createLinearGradient(0, 0, 0, h);
  g.addColorStop(0, `rgba(0,0,0,${a + 0.1})`);
  g.addColorStop(0.45, `rgba(0,0,0,${a * 0.4})`);
  g.addColorStop(1, `rgba(0,0,0,${a + 0.15})`);
  ctx.fillStyle = g;
  ctx.fillRect(0, 0, w, h);
}

function bg(ctx, img, w, h) {
  ctx.fillStyle = '#000';
  ctx.fillRect(0, 0, w, h);
  if (img) ctx.drawImage(img, 0, 0, w, h);
}

// Card that cycles through repair stages with a filling bar.
const STAGES = ['Диагностика', 'Замена экрана', 'Проверка', 'Готово ✓'];
function repairWidget(ctx, x, y, w, h, t, r) {
  ctx.fillStyle = 'rgba(25,25,25,0.78)';
  rr(ctx, x, y, w, h, r);
  ctx.fill();
  const cyc = (t % 12) / 12;
  const stage = Math.min(3, Math.floor(cyc * 4.4));
  const p = stage === 3 ? 1 : ease(cyc * 4.4 - stage) * 0.33 + stage * 0.33;
  const pad = h * 0.16;
  ctx.textAlign = 'left';
  ctx.textBaseline = 'alphabetic';
  ctx.fillStyle = C.peach;
  font(ctx, 600, h * 0.15, 0.02);
  ctx.fillText('FOLDPROFI', x + pad, y + pad + h * 0.12);
  ctx.fillStyle = C.white;
  font(ctx, 600, h * 0.22, -0.03);
  ctx.fillText(STAGES[stage], x + pad, y + h * 0.58);
  ctx.fillStyle = C.ash;
  font(ctx, 500, h * 0.13, -0.01);
  ctx.fillText(stage === 3 ? 'Гарантия 1 год' : `${Math.round(p * 100)}%`, x + pad, y + h * 0.76);
  ctx.fillStyle = 'rgba(255,255,255,0.15)';
  rr(ctx, x + pad, y + h - pad * 0.95, w - pad * 2, h * 0.06, h * 0.03);
  ctx.fill();
  ctx.fillStyle = C.peach;
  rr(ctx, x + pad, y + h - pad * 0.95, Math.max(h * 0.06, (w - pad * 2) * p), h * 0.06, h * 0.03);
  ctx.fill();
}

// Banner that drops in from the top every few seconds.
const NOTES = [
  ['FoldProfi', 'Телефон готов — можно забирать', 1],
  ['Сообщения', 'Мастер: стекло заменили, всё ок', 7],
  ['FoldProfi', 'Гарантия 1 год активирована', 1],
];
function notification(ctx, x, y, w, h, t, period = 9) {
  const i = Math.floor(t / period) % NOTES.length;
  const c = t % period;
  const show = c < 0.6 ? ease(c / 0.6) : c < 4 ? 1 : c < 4.6 ? 1 - ease((c - 4) / 0.6) : 0;
  if (show <= 0) return;
  const [app, text, gi] = NOTES[i];
  const yy = y - (1 - show) * (h + y);
  ctx.save();
  ctx.globalAlpha = Math.min(1, show * 1.4);
  ctx.fillStyle = 'rgba(28,28,28,0.92)';
  rr(ctx, x, yy, w, h, h * 0.28);
  ctx.fill();
  const s = h * 0.56;
  icon(ctx, x + h * 0.22, yy + (h - s) / 2, s, gi, i === 1 ? 'chat' : 'fold');
  ctx.textAlign = 'left';
  ctx.textBaseline = 'alphabetic';
  ctx.fillStyle = C.ash;
  font(ctx, 600, h * 0.2, 0);
  ctx.fillText(app, x + h * 0.22 + s + h * 0.18, yy + h * 0.4);
  ctx.fillStyle = C.white;
  font(ctx, 500, h * 0.22, -0.02);
  ctx.fillText(text, x + h * 0.22 + s + h * 0.18, yy + h * 0.72, w - s - h * 0.7);
  ctx.restore();
}

function appGrid(ctx, x, y, w, cols, rows, t, labels = true) {
  const gap = w * 0.07;
  const s = (w - gap * (cols - 1)) / cols;
  const tapAt = Math.floor(t / 2.5) % (cols * rows);
  const tapP = (t % 2.5) / 2.5;
  for (let r = 0; r < rows; r++) {
    for (let c = 0; c < cols; c++) {
      const k = r * cols + c;
      const [name, glyph, gi] = APPS[k % APPS.length];
      const ix = x + c * (s + gap);
      const iy = y + r * (s + s * (labels ? 0.62 : 0.3));
      const pressed = k === tapAt && tapP < 0.25 ? Math.sin((tapP / 0.25) * Math.PI) : 0;
      icon(ctx, ix, iy, s, gi, glyph, pressed);
      if (labels) {
        ctx.fillStyle = C.white;
        font(ctx, 500, s * 0.19, -0.01);
        ctx.textAlign = 'center';
        ctx.textBaseline = 'top';
        ctx.fillText(name, ix + s / 2, iy + s + s * 0.1, s * 1.3);
      }
    }
  }
}

function dock(ctx, x, y, w, h, t) {
  ctx.fillStyle = 'rgba(255,255,255,0.12)';
  rr(ctx, x, y, w, h, h * 0.36);
  ctx.fill();
  const n = 4, s = h * 0.68, gap = (w - n * s) / (n + 1);
  const dockApps = [APPS[0], APPS[1], APPS[2], APPS[5]];
  dockApps.forEach(([, glyph, gi], i) => icon(ctx, x + gap + i * (s + gap), y + (h - s) / 2, s, gi, glyph));
}

/* ---------------- screen layouts ---------------- */

// Classic smartphone home screen.
function drawBar(ctx, w, h, t, img) {
  bg(ctx, img, w, h);
  scrim(ctx, w, h);
  const { hm, date } = now();
  statusBar(ctx, w, h * 0.035, h * 0.018, t);
  ctx.textAlign = 'center';
  ctx.textBaseline = 'alphabetic';
  ctx.fillStyle = C.fog;
  font(ctx, 500, h * 0.02, -0.01);
  ctx.fillText(date, w / 2, h * 0.115);
  ctx.fillStyle = C.white;
  font(ctx, 600, h * 0.105, -0.05);
  ctx.fillText(hm, w / 2, h * 0.215);
  repairWidget(ctx, w * 0.08, h * 0.26, w * 0.84, h * 0.13, t, h * 0.025);
  appGrid(ctx, w * 0.1, h * 0.46, w * 0.8, 4, 2, t);
  dock(ctx, w * 0.05, h * 0.86, w * 0.9, h * 0.085, t);
  notification(ctx, w * 0.04, h * 0.05, w * 0.92, h * 0.065, t);
}

// Flip inner screen: tall, with a crease in the middle (v = 0.5).
function drawFlipInner(ctx, w, h, t, img) {
  bg(ctx, img, w, h);
  scrim(ctx, w, h);
  const { hm, date } = now();
  statusBar(ctx, w, h * 0.032, h * 0.016, t);
  ctx.textAlign = 'left';
  ctx.textBaseline = 'alphabetic';
  ctx.fillStyle = C.white;
  font(ctx, 600, h * 0.085, -0.05);
  ctx.fillText(hm, w * 0.08, h * 0.15);
  ctx.fillStyle = C.fog;
  font(ctx, 500, h * 0.018, -0.01);
  ctx.fillText(date, w * 0.085, h * 0.18);
  repairWidget(ctx, w * 0.08, h * 0.22, w * 0.84, h * 0.115, t, h * 0.022);
  appGrid(ctx, w * 0.1, h * 0.56, w * 0.8, 4, 2, t);
  dock(ctx, w * 0.05, h * 0.87, w * 0.9, h * 0.075, t);
  notification(ctx, w * 0.04, h * 0.045, w * 0.92, h * 0.058, t, 11);
}

// Flip cover screen: small square-ish, glanceable.
function drawFlipCover(ctx, w, h, t, img) {
  bg(ctx, img, w, h);
  scrim(ctx, w, h, 0.35);
  const { hm, short } = now();
  ctx.textAlign = 'right';
  ctx.textBaseline = 'alphabetic';
  ctx.fillStyle = C.white;
  font(ctx, 600, h * 0.24, -0.05);
  ctx.fillText(hm, w * 0.9, h * 0.42);
  ctx.fillStyle = C.fog;
  font(ctx, 500, h * 0.065, -0.01);
  ctx.fillText(short, w * 0.9, h * 0.53);
  // pulsing "ready" chip
  const pulse = 0.5 + 0.5 * Math.sin(t * 3);
  const cw = w * 0.5, ch = h * 0.13, cx = w * 0.9 - cw, cy = h * 0.66;
  ctx.fillStyle = 'rgba(25,25,25,0.85)';
  rr(ctx, cx, cy, cw, ch, ch / 2);
  ctx.fill();
  ctx.fillStyle = C.peach;
  ctx.globalAlpha = 0.5 + 0.5 * pulse;
  ctx.beginPath();
  ctx.arc(cx + ch * 0.5, cy + ch / 2, ch * 0.18, 0, 7);
  ctx.fill();
  ctx.globalAlpha = 1;
  ctx.fillStyle = C.white;
  ctx.textAlign = 'left';
  font(ctx, 600, ch * 0.42, -0.02);
  ctx.textBaseline = 'middle';
  ctx.fillText('Ремонт готов', cx + ch * 0.9, cy + ch / 2);
}

export const LAYOUTS = { bar: drawBar, flipInner: drawFlipInner, flipCover: drawFlipCover };

/**
 * Replace a glTF material's emissive wallpaper with a live canvas screen.
 * Returns { tick(t) } — call each frame; it redraws at ~fps.
 */
export function liveScreen(material, layout, { maxW = 640, fps = 15 } = {}) {
  const src = material.emissiveMap;
  const img = src && src.image;
  const iw = (img && (img.width || img.naturalWidth)) || 720;
  const ih = (img && (img.height || img.naturalHeight)) || 1560;
  const k = Math.min(1, maxW / iw);
  const canvas = document.createElement('canvas');
  canvas.width = Math.round(iw * k);
  canvas.height = Math.round(ih * k);
  const ctx = canvas.getContext('2d');
  const tex = new THREE.CanvasTexture(canvas);
  tex.colorSpace = THREE.SRGBColorSpace;
  tex.flipY = false; // glTF UV convention
  tex.anisotropy = 8;
  if (src) { tex.wrapS = src.wrapS; tex.wrapT = src.wrapT; }
  material.emissiveMap = tex;
  material.emissive.setRGB(1, 1, 1);
  material.toneMapped = false;
  material.needsUpdate = true;

  let last = -1;
  const draw = LAYOUTS[layout];
  const tick = (t) => {
    if (t - last < 1 / fps) return;
    last = t;
    draw(ctx, canvas.width, canvas.height, t, img);
    tex.needsUpdate = true;
  };
  tick(0);
  return { tick, canvas };
}
