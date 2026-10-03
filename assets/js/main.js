import * as THREE from 'three';
import { Stage, MultiStage, makeSoftShadow, pointer, reducedMotion, webglAvailable } from './stage.js';
import { createFold, createFlip, createBar, createWatch, createExplodedFold, makeMaterials, planeGeo } from './devices.js';
import { ensureFonts, scratchedFilmTexture } from './textures.js';
import { createAurora } from './aurora.js';
import { createFoldPhone, createExplodedModel, createBarPhone, createFlipPhone, createWatchModel } from './models.js';

const { clamp, lerp, smoothstep, damp } = THREE.MathUtils;
const ease = (x) => (x < 0.5 ? 4 * x * x * x : 1 - Math.pow(-2 * x + 2, 3) / 2);
const mobileQuery = window.matchMedia('(max-width: 900px)');

// Organic idle drift (sum of incommensurate sines, roughly -1..1) — reads like a
// hand-held camera move rather than a metronome.
const drift = (t, seed = 0) => 0.6 * Math.sin(t + seed) + 0.3 * Math.sin(t * 2.13 + 1.3 + seed) + 0.1 * Math.sin(t * 4.7 + 0.5 + seed);

document.documentElement.classList.remove('no-js');
initUI();

if (!webglAvailable()) {
  document.documentElement.classList.add('no-webgl');
} else {
  // Aurora background (React Bits <Aurora />): palette stops, as specified.
  try {
    createAurora(document.querySelector('.aurora'), {
      colorStops: ['#ffffff', '#0B2B36', '#9DB8A6'],
      blend: 0.58,
      amplitude: 1.0,
      speed: 0.6,
      paused: reducedMotion,
    });
  } catch (err) {
    console.warn('Aurora failed', err);
  }
  ensureFonts().then(async () => {
    try {
      await Promise.all([initTiles(), initHero(), initIssues(), initFilm()]);
    } catch (err) {
      console.error(err);
      document.documentElement.classList.add('no-webgl');
    }
  });
}

/* ------------------------------------------------------------------ */
/* UI: reveal, nav, burger                                             */
/* ------------------------------------------------------------------ */
function initUI() {
  const io = new IntersectionObserver((entries) => {
    entries.forEach((e) => {
      if (e.isIntersecting) {
        e.target.classList.add('is-in');
        io.unobserve(e.target);
      }
    });
  }, { rootMargin: '0px 0px -8% 0px' });
  document.querySelectorAll('.reveal').forEach((el, i) => {
    el.style.transitionDelay = `${(i % 4) * 60}ms`;
    io.observe(el);
  });

  const links = [...document.querySelectorAll('.nav__links a, .nav__link')];
  const sections = links.map((a) => document.querySelector(a.getAttribute('href')));
  const navIO = new IntersectionObserver((entries) => {
    entries.forEach((e) => {
      if (!e.isIntersecting) return;
      links.forEach((a) => a.classList.toggle('is-active', a.getAttribute('href') === `#${e.target.id}`));
    });
  }, { rootMargin: '-45% 0px -50% 0px' });
  sections.forEach((s) => s && navIO.observe(s));

  const burger = document.querySelector('.nav__burger');
  const menu = document.getElementById('mobile-menu');
  const setMenu = (open) => {
    burger.setAttribute('aria-expanded', String(open));
    menu.hidden = !open;
  };
  burger.addEventListener('click', () => setMenu(menu.hidden));
  menu.addEventListener('click', (e) => { if (e.target.closest('a')) setMenu(false); });
  document.addEventListener('keydown', (e) => { if (e.key === 'Escape') setMenu(false); });

  const y = document.getElementById('year');
  if (y) y.textContent = String(new Date().getFullYear());
}

// Blender model first; fall back to the procedural one if it fails to load.
async function foldPhone(stage) {
  try {
    return await createFoldPhone();
  } catch (err) {
    console.warn('FoldPhone.glb failed, using procedural model', err);
    return createFold(stage.renderer);
  }
}

// 0 → 1 progress of a tall section scrolled through the viewport.
function sectionProgress(el) {
  const r = el.getBoundingClientRect();
  const span = r.height - window.innerHeight;
  return span > 0 ? clamp(-r.top / span, 0, 1) : clamp(1 - r.bottom / (r.height + window.innerHeight), 0, 1);
}

/* ------------------------------------------------------------------ */
/* HERO: folded phone spins, then unfolds as you scroll                */
/* ------------------------------------------------------------------ */
async function initHero() {
  const hero = document.getElementById('hero');
  const stage = new Stage(document.getElementById('hero-canvas'), { fov: 18, z: 17 });
  const fold = await foldPhone(stage);
  // In the Blender model the cover screen faces away when folded: turn it round.
  const coverYaw = fold.screen ? Math.PI : 0;
  const rig = new THREE.Group();
  rig.add(fold.root);
  stage.scene.add(rig);
  stage.warm();

  const stats = [...hero.querySelectorAll('.stat')];
  let sp = 0;

  stage.onFrame = (dt, t) => {
    const p = sectionProgress(hero);
    sp = reducedMotion ? p : damp(sp, p, 6, dt);

    const spin = ease(smoothstep(sp, 0.02, 0.26));
    const open = ease(smoothstep(sp, 0.26, 0.62));
    const outro = smoothstep(sp, 0.62, 0.82);
    fold.setFold(1 - open);

    const mobile = mobileQuery.matches;
    const view = stage.viewSize(stage.camera.position.z);
    const phoneW = lerp(fold.W, fold.W * 2, open);
    const maxW = mobile ? view.w * 0.82 : view.w * 0.42;
    const maxH = mobile ? view.h * 0.46 : view.h * 0.62;
    const scale = Math.min(1.15, maxW / phoneW, maxH / fold.H);
    rig.scale.setScalar(scale);

    const idle = reducedMotion ? 0 : 1;
    const yawIdle = drift(t * 0.22) * 0.2 * (1 - open) * idle;
    rig.rotation.y = (coverYaw - 0.5) * (1 - open) - spin * Math.PI * 2 + yawIdle - 0.16 * open + pointer.sx * 0.22;
    rig.rotation.x = 0.14 * (1 - open) + 0.06 + pointer.sy * 0.12;
    rig.rotation.z = -0.06 * (1 - open);

    if (mobile) {
      rig.position.x = 0;
      rig.position.y = lerp(-view.h * 0.19, view.h * 0.12, outro) + drift(t * 0.35, 2) * 0.025 * idle;
    } else {
      rig.position.x = lerp(view.w * 0.22, view.w * 0.2, open) + lerp(0, view.w * 0.04, outro);
      rig.position.y = drift(t * 0.35, 2) * 0.03 * idle;
    }

    hero.style.setProperty('--hero-text', String(1 - smoothstep(sp, 0.5, 0.64)));
    hero.style.setProperty('--hero-lift', `${smoothstep(sp, 0.45, 0.66) * 60}px`);
    stats.forEach((el, i) => el.style.setProperty('--s', String(smoothstep(sp, 0.66 + i * 0.05, 0.78 + i * 0.05))));
  };
}

/* ------------------------------------------------------------------ */
/* SERVICE TILES: bar phone / flip / watch, draggable                  */
/* ------------------------------------------------------------------ */
function initTiles() {
  const mats = makeMaterials();
  const multi = new MultiStage(document.querySelector('.tiles__gl'), { dpr: 1.5 });
  return Promise.all([...document.querySelectorAll('.tile__canvas')].map(async (canvas) => {
    const stage = multi.addView(canvas, { fov: 16, z: 16.3 });
    const type = canvas.dataset.model;
    const tile = canvas.closest('.tile');
    let device;
    let fitH = 3.2;
    // Blender models with live home screens; procedural ones if loading fails.
    const glb = async (make, fallback) => {
      try { return await make(); } catch (err) { console.warn(`${type} GLB failed, using procedural model`, err); return fallback(); }
    };
    if (type === 'flip') { device = await glb(createFlipPhone, () => createFlip(stage.renderer, mats)); fitH = 3.6; }
    else if (type === 'watch') { device = await glb(createWatchModel, () => createWatch(stage.renderer, mats)); fitH = 3.4; }
    else { device = await glb(createBarPhone, () => createBar(stage.renderer, mats)); fitH = 3.3; }

    const rig = new THREE.Group();
    rig.add(device.root);
    stage.scene.add(rig);
    const shadow = makeSoftShadow(2, 0.36, 0.5);
    const bounds = new THREE.Box3();
    stage.scene.add(shadow);
    stage.warm();

    let hover = false;
    let dragYaw = 0, vel = 0, dragging = false, lastX = 0;
    tile.addEventListener('pointerenter', () => { hover = true; });
    tile.addEventListener('pointerleave', () => { hover = false; });
    canvas.addEventListener('pointerdown', (e) => { dragging = true; lastX = e.clientX; canvas.setPointerCapture(e.pointerId); });
    canvas.addEventListener('pointermove', (e) => {
      if (!dragging) return;
      const dx = (e.clientX - lastX) / canvas.clientWidth;
      lastX = e.clientX;
      dragYaw += dx * 5;
      vel = dx * 5 / 0.016;
    });
    const end = () => { dragging = false; };
    canvas.addEventListener('pointerup', end);
    canvas.addEventListener('pointercancel', end);

    let foldT = 1;
    let hoverMix = 0;
    const seed = type.length * 1.7;
    stage.onFrame = (dt, t) => {
      const view = stage.viewSize();
      const k = Math.min(1, (view.h * 0.86) / fitH, (view.w * 0.8) / 2);
      rig.scale.setScalar(k);
      if (!dragging) { dragYaw += vel * dt; vel *= Math.exp(-dt * 3); }
      // Slow, inertial easing towards hover state — no snapping.
      hoverMix = damp(hoverMix, hover ? 1 : 0, 2.2, dt);
      const m = reducedMotion ? 0 : 1;
      const d = drift(t * 0.18, seed) * m;

      if (type === 'flip') {
        // 10 s loop with holds: shut → opens → stays open → shuts. Hover keeps it open.
        const c = (t % 10) / 10;
        const auto = smoothstep(c, 0.25, 0.4) * (1 - smoothstep(c, 0.78, 0.93));
        foldT = damp(foldT, hover ? 0 : 1 - auto * m, 2.6, dt);
        device.setFold(foldT);
        rig.rotation.y = -0.4 + d * 0.25 + dragYaw;
        rig.rotation.x = 0.14 + (1 - foldT) * 0.1;
        rig.rotation.z = device.coverRoll ? Math.PI * ease(foldT) : 0;
        rig.position.y = -0.1 * (1 - foldT);
      } else if (type === 'watch') {
        rig.position.y = 0;
        rig.rotation.y = -0.2 + d * 0.35 + dragYaw + hoverMix * 0.45;
        rig.rotation.x = 0.2 + drift(t * 0.13, seed + 3) * 0.05 * m;
        rig.rotation.z = -0.06;
      } else {
        // Mostly face the viewer so the live home screen reads; hover turns it to show the cameras.
        rig.position.y = 0;
        rig.rotation.y = -0.3 + d * 0.3 + dragYaw + hoverMix * Math.PI;
        rig.rotation.x = 0.1;
        rig.rotation.z = -0.08;
      }
      rig.position.y += drift(t * 0.3, seed + 5) * 0.02 * m; // base y is reset above every frame
      // Soft shadow just under the object's current footprint, behind it (no visible floor).
      bounds.setFromObject(rig);
      const w = Math.max(0.6, bounds.max.x - bounds.min.x);
      shadow.position.set((bounds.max.x + bounds.min.x) / 2, bounds.min.y - 0.04, -1.5);
      shadow.scale.set(w * 1.25, w * 0.2, 1);
      if (device.tick) device.tick(t);
    };
  }));
}

/* ------------------------------------------------------------------ */
/* ISSUES: exploded Fold; hovering a problem lights up the part        */
/* ------------------------------------------------------------------ */
async function initIssues() {
  const section = document.getElementById('issues');
  const canvas = document.getElementById('issues-canvas');
  const caption = document.getElementById('issues-caption');
  const cards = [...section.querySelectorAll('.issue')];
  const stage = new Stage(canvas, { fov: 20, z: 18.2, dpr: 1.5 });
  let model;
  try {
    model = await createExplodedModel();
  } catch (err) {
    console.warn('fold-exploded.glb failed, using procedural model', err);
    model = createExplodedFold(stage.renderer);
  }
  const rig = new THREE.Group();
  rig.add(model.root);
  stage.scene.add(rig);
  stage.warm();

  const names = {
    display: 'Гибкий дисплей', glass: 'Защитное стекло и плёнка', audio: 'Динамики и микрофоны',
    battery: 'Аккумуляторы', hinge: 'Шарнирный механизм', board: 'Системная плата',
  };

  let hovered = null;
  let clicked = null;
  let current = undefined;
  // While the mouse is over the list, the last hovered card stays selected —
  // crossing the gap between cards must not fall back to scroll selection.
  const list = section.querySelector('.issues__list');
  let pointerInList = false;
  list.addEventListener('pointerenter', (e) => { if (e.pointerType === 'mouse') pointerInList = true; });
  list.addEventListener('pointerleave', (e) => {
    if (e.pointerType !== 'mouse') return;
    pointerInList = false;
    hovered = null;
  });
  cards.forEach((card) => {
    const key = card.dataset.part;
    card.addEventListener('pointerenter', (e) => { if (e.pointerType === 'mouse') hovered = key; });
    card.addEventListener('focus', () => { hovered = key; });
    card.addEventListener('blur', () => { if (hovered === key && !pointerInList) hovered = null; });
    card.addEventListener('click', () => { clicked = clicked === key ? null : key; });
  });

  // When nothing is hovered, follow the card nearest to the viewport centre.
  function scrollActive() {
    const r = section.getBoundingClientRect();
    if (r.bottom < 0 || r.top > window.innerHeight) return null;
    const mobile = mobileQuery.matches;
    const target = mobile ? window.innerHeight * 0.72 : window.innerHeight * 0.5;
    let best = null, bestD = Infinity;
    for (const c of cards) {
      const cr = c.getBoundingClientRect();
      const d = Math.abs(cr.top + cr.height / 2 - target);
      if (d < bestD) { bestD = d; best = c.dataset.part; }
    }
    return bestD < (mobile ? window.innerHeight * 0.2 : window.innerHeight * 0.35) ? best : null;
  }

  let ex = 0;
  stage.onFrame = (dt, t) => {
    const key = hovered || clicked || (pointerInList ? current : scrollActive());
    if (key !== current) {
      current = key;
      model.setActive(key);
      cards.forEach((c) => c.classList.toggle('is-active', c.dataset.part === key));
      caption.textContent = key ? names[key] : 'Наведите на неисправность';
      caption.classList.toggle('is-on', !!key);
    }
    const r = section.getBoundingClientRect();
    const enter = clamp(1 - r.top / (window.innerHeight * 0.8), 0, 1);
    const target = Math.max(smoothstep(enter, 0.1, 0.9), key ? 1 : 0);
    ex = reducedMotion ? target : damp(ex, target, 3, dt);
    model.update(ease(ex), dt, t);

    const view = stage.viewSize();
    rig.scale.setScalar(Math.min(1, (view.w * 0.72) / 2.64, (view.h * 0.6) / 2.96));
    const m = reducedMotion ? 0 : 1;
    rig.rotation.x = -0.95 + pointer.sy * 0.1;
    rig.rotation.y = 0.38 + Math.sin(t * 0.4) * 0.06 * m + pointer.sx * 0.15;
    rig.rotation.z = 0.32;
    rig.position.y = -0.15;
  };
}

/* ------------------------------------------------------------------ */
/* FILM: old film peels off, new one drops into place                  */
/* ------------------------------------------------------------------ */
async function initFilm() {
  const card = document.querySelector('.film-card');
  const label = document.getElementById('film-label');
  const stage = new Stage(document.getElementById('film-canvas'), { fov: 16, z: 18, dpr: 1.5 });
  const fold = await foldPhone(stage);
  fold.setFold(0);
  const rig = new THREE.Group();
  rig.add(fold.root);
  stage.scene.add(rig);

  // Film sits on the inner screen: measured from the GLB, or the procedural layout.
  const anchor = new THREE.Group();
  let fw, fh;
  if (fold.screen) {
    const { center, size, front } = fold.screen;
    anchor.position.set(center.x, center.y, front);
    fold.root.add(anchor);
    fw = size.x + 0.02;
    fh = size.y + 0.02;
  } else {
    fold.inner.add(anchor);
    fw = 2 * fold.W - 0.08;
    fh = fold.H - 0.08;
  }
  const seg = 48;
  const oldGeo = new THREE.PlaneGeometry(fw, fh, seg, seg);
  const base = Float32Array.from(oldGeo.attributes.position.array);
  const oldMat = new THREE.MeshPhysicalMaterial({
    color: 0xffffff, map: scratchedFilmTexture(stage.renderer), transparent: true, opacity: 0.42,
    roughness: 0.55, metalness: 0, specularIntensity: 0.4, side: THREE.DoubleSide, depthWrite: false,
  });
  const oldFilm = new THREE.Mesh(oldGeo, oldMat);
  oldFilm.position.z = 0.006;
  anchor.add(oldFilm);

  // Satin, not mirror: a mirror coat turned the key light into a blown white disk.
  const newMat = new THREE.MeshPhysicalMaterial({
    color: 0xffffff, transparent: true, opacity: 0, roughness: 0.35, metalness: 0,
    iridescence: 1, iridescenceIOR: 1.3, clearcoat: 0.35, clearcoatRoughness: 0.3,
    specularIntensity: 0.5, side: THREE.DoubleSide, depthWrite: false,
  });
  const newFilm = new THREE.Mesh(planeGeo(-fw / 2, -fh / 2, fw, fh, 0.14), newMat);
  anchor.add(newFilm);

  // Light sweep across the fresh film
  const band = document.createElement('canvas');
  band.width = 512; band.height = 8;
  const bctx = band.getContext('2d');
  const g = bctx.createLinearGradient(0, 0, 512, 0);
  g.addColorStop(0, 'rgba(255,255,255,0)');
  g.addColorStop(0.45, 'rgba(255,255,255,0)');
  g.addColorStop(0.5, 'rgba(228,240,232,0.55)');
  g.addColorStop(0.55, 'rgba(255,255,255,0)');
  g.addColorStop(1, 'rgba(255,255,255,0)');
  bctx.fillStyle = g;
  bctx.fillRect(0, 0, 512, 8);
  const bandTex = new THREE.CanvasTexture(band);
  bandTex.wrapS = THREE.ClampToEdgeWrapping;
  const shine = new THREE.Mesh(
    planeGeo(-fw / 2, -fh / 2, fw, fh, 0.14),
    new THREE.MeshBasicMaterial({ map: bandTex, transparent: true, blending: THREE.AdditiveBlending, depthWrite: false, toneMapped: false }),
  );
  shine.position.z = 0.012;
  anchor.add(shine);
  stage.warm();

  // Peel along a diagonal from the bottom-right corner.
  const n = new THREE.Vector2(-0.62, 0.78).normalize();
  const cx = fw / 2, cy = -fh / 2;
  let sMax = 0;
  for (let i = 0; i < base.length; i += 3) sMax = Math.max(sMax, (base[i] - cx) * n.x + (base[i + 1] - cy) * n.y);
  const rad = 0.16;
  const pos = oldGeo.attributes.position;

  function peel(L) {
    for (let i = 0; i < pos.count; i++) {
      const x = base[i * 3], y = base[i * 3 + 1];
      const s = (x - cx) * n.x + (y - cy) * n.y;
      let s2 = s, z = 0;
      if (s < L) {
        const u = L - s;
        const phi = u / rad;
        if (phi < Math.PI) {
          s2 = L - rad * Math.sin(phi);
          z = rad * (1 - Math.cos(phi));
        } else {
          const over = u - Math.PI * rad;
          s2 = L + over * 0.94;
          z = 2 * rad + over * 0.34;
        }
      }
      pos.setXYZ(i, x + (s2 - s) * n.x, y + (s2 - s) * n.y, z);
    }
    pos.needsUpdate = true;
    oldGeo.computeVertexNormals();
  }

  let lastState = '';
  const CYCLE = 9;
  stage.onFrame = (dt, t) => {
    const c = reducedMotion ? 0.85 : (t % CYCLE) / CYCLE;
    const peelT = ease(smoothstep(c, 0.08, 0.48));
    peel(peelT * (sMax + Math.PI * rad + 1.2));
    oldMat.opacity = 0.42 * (1 - smoothstep(c, 0.42, 0.52)) + 0.42 * smoothstep(c, 0.96, 1);
    oldFilm.visible = oldMat.opacity > 0.01;

    const drop = ease(smoothstep(c, 0.5, 0.64));
    newFilm.position.z = lerp(0.9, 0.006, drop);
    newFilm.rotation.z = lerp(0.12, 0, drop);
    newMat.opacity = 0.2 * smoothstep(c, 0.5, 0.58) * (1 - smoothstep(c, 0.95, 1));
    const sweep = smoothstep(c, 0.64, 0.82);
    bandTex.offset.x = lerp(0.6, -0.6, sweep);
    shine.visible = sweep > 0 && sweep < 1;

    const state = c > 0.55 && c < 0.97 ? 'new' : 'old';
    if (state !== lastState) {
      lastState = state;
      label.textContent = state === 'new' ? 'Новая оригинальная плёнка' : 'Старая плёнка';
      card.classList.toggle('is-new', state === 'new');
    }

    const view = stage.viewSize();
    rig.scale.setScalar(Math.min(1.35, (view.w * 0.84) / (2 * fold.W), (view.h * 0.74) / fold.H));
    const m = reducedMotion ? 0 : 1;
    rig.rotation.x = -0.42 + pointer.sy * 0.08;
    rig.rotation.y = -0.28 + Math.sin(t * 0.35) * 0.06 * m + pointer.sx * 0.12;
    rig.rotation.z = 0.08;
    rig.position.y = -0.05;
  };
}
