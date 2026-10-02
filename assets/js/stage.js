// Minimal multi-canvas renderer: each Stage owns one canvas, renders only
// while on screen, and shares a single requestAnimationFrame loop.
import * as THREE from 'three';
import { RoomEnvironment } from '../../vendor/three/RoomEnvironment.js';

const stages = new Set();
let last = performance.now();
let running = false;

export const pointer = { x: 0, y: 0, sx: 0, sy: 0 };
window.addEventListener('pointermove', (e) => {
  pointer.x = (e.clientX / window.innerWidth) * 2 - 1;
  pointer.y = (e.clientY / window.innerHeight) * 2 - 1;
}, { passive: true });

export const reducedMotion = window.matchMedia('(prefers-reduced-motion: reduce)').matches;

export class Stage {
  constructor(canvas, { fov = 30, z = 10, dpr = 1.75, exposure = 1.05, envIntensity = 0.55 } = {}) {
    this.canvas = canvas;
    this.renderer = new THREE.WebGLRenderer({ canvas, antialias: true, alpha: true, powerPreference: 'high-performance' });
    this.renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, dpr));
    this.renderer.outputColorSpace = THREE.SRGBColorSpace;
    this.renderer.toneMapping = THREE.ACESFilmicToneMapping;
    this.renderer.toneMappingExposure = exposure;
    this.renderer.setClearColor(0x000000, 0);

    this.scene = new THREE.Scene();
    const pmrem = new THREE.PMREMGenerator(this.renderer);
    this.scene.environment = pmrem.fromScene(new RoomEnvironment(), 0.04).texture;
    this.scene.environmentIntensity = envIntensity;
    pmrem.dispose();

    this.camera = new THREE.PerspectiveCamera(fov, 1, 0.1, 100);
    this.camera.position.set(0, 0, z);
    addLights(this.scene);

    this.visible = false;
    this.onFrame = null;
    this.width = 1;
    this.height = 1;

    new ResizeObserver(() => this.resize()).observe(canvas);
    new IntersectionObserver(([e]) => { this.visible = e.isIntersecting; }, { rootMargin: '120px' }).observe(canvas);
    this.resize();
    stages.add(this);
    start();
  }

  resize() {
    const w = Math.max(1, this.canvas.clientWidth);
    const h = Math.max(1, this.canvas.clientHeight);
    this.width = w;
    this.height = h;
    this.renderer.setSize(w, h, false);
    this.camera.aspect = w / h;
    this.camera.updateProjectionMatrix();
  }

  // Compile shaders ahead of time so the first on-screen frame doesn't hitch.
  warm() {
    const run = () => {
      try {
        this.renderer.compile(this.scene, this.camera);
      } catch { /* non-fatal */ }
    };
    (window.requestIdleCallback || ((f) => setTimeout(f, 200)))(run);
  }

  // Visible world-space size of the frustum at distance d from the camera.
  viewSize(d = this.camera.position.z) {
    const h = 2 * d * Math.tan(THREE.MathUtils.degToRad(this.camera.fov / 2));
    return { w: h * this.camera.aspect, h };
  }
}

// One renderer drawing several small scenes into one overlay canvas (scissor per
// view). Cheaper than a WebGL context per view: one context, one environment
// map, one composited layer. Views expose the same fields scenes use on Stage.
export class MultiStage {
  constructor(canvas, { dpr = 1.5, exposure = 1.05 } = {}) {
    this.canvas = canvas;
    this.renderer = new THREE.WebGLRenderer({ canvas, antialias: true, alpha: true, powerPreference: 'high-performance' });
    this.renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, dpr));
    this.renderer.outputColorSpace = THREE.SRGBColorSpace;
    this.renderer.toneMapping = THREE.ACESFilmicToneMapping;
    this.renderer.toneMappingExposure = exposure;
    this.renderer.setClearColor(0x000000, 0);
    this.renderer.autoClear = false;
    const pmrem = new THREE.PMREMGenerator(this.renderer);
    this.env = pmrem.fromScene(new RoomEnvironment(), 0.04).texture;
    pmrem.dispose();
    this.views = [];
    this.visible = false;
    new ResizeObserver(() => this.resize()).observe(canvas);
    new IntersectionObserver(([e]) => { this.visible = e.isIntersecting; }, { rootMargin: '120px' }).observe(canvas);
    this.resize();
    stages.add(this);
    start();
  }

  resize() {
    this.renderer.setSize(Math.max(1, this.canvas.clientWidth), Math.max(1, this.canvas.clientHeight), false);
  }

  // el: element whose box the view occupies (inside the overlay canvas' area).
  addView(el, { fov = 30, z = 10, envIntensity = 0.55 } = {}) {
    const scene = new THREE.Scene();
    scene.environment = this.env;
    scene.environmentIntensity = envIntensity;
    addLights(scene);
    const camera = new THREE.PerspectiveCamera(fov, 1, 0.1, 100);
    camera.position.set(0, 0, z);
    const view = {
      el, scene, camera, renderer: this.renderer, onFrame: null, visible: false,
      viewSize(d = camera.position.z) {
        const h = 2 * d * Math.tan(THREE.MathUtils.degToRad(camera.fov / 2));
        return { w: h * camera.aspect, h };
      },
      warm: () => (window.requestIdleCallback || ((f) => setTimeout(f, 200)))(() => {
        try { this.renderer.compile(scene, camera); } catch { /* non-fatal */ }
      }),
    };
    new IntersectionObserver(([e]) => { view.visible = e.isIntersecting; }, { rootMargin: '60px' }).observe(el);
    this.views.push(view);
    return view;
  }

  frame(dt, t) {
    const r = this.renderer;
    const box = this.canvas.getBoundingClientRect();
    r.setScissorTest(false);
    r.clear();
    r.setScissorTest(true);
    for (const v of this.views) {
      if (!v.visible) continue;
      const b = v.el.getBoundingClientRect();
      const w = b.width, h = b.height;
      if (w < 1 || h < 1) continue;
      const x = b.left - box.left;
      const y = box.bottom - b.bottom; // WebGL origin is bottom-left
      if (Math.abs(v.camera.aspect - w / h) > 1e-3) {
        v.camera.aspect = w / h;
        v.camera.updateProjectionMatrix();
      }
      if (v.onFrame) v.onFrame(dt, t);
      r.setViewport(x, y, w, h);
      r.setScissor(x, y, w, h);
      r.render(v.scene, v.camera);
    }
  }
}

function addLights(scene) {
  scene.add(new THREE.HemisphereLight(0xffffff, 0x0a0a0a, 0.35));
  const key = new THREE.DirectionalLight(0xfff1e8, 2.2);
  key.position.set(3, 5, 7);
  const ember = new THREE.DirectionalLight(0xe3a081, 3.2);
  ember.position.set(-6, 2, -2);
  const violet = new THREE.DirectionalLight(0x5351f3, 4);
  violet.position.set(6, -3, -4);
  const under = new THREE.PointLight(0xe3a081, 6, 12, 2);
  under.position.set(0, -3.5, 2.5);
  scene.add(key, ember, violet, under);
}

function start() {
  if (running) return;
  running = true;
  requestAnimationFrame(loop);
}

function loop(now) {
  const dt = Math.min(0.05, (now - last) / 1000);
  last = now;
  const k = 1 - Math.exp(-dt * 4);
  pointer.sx += (pointer.x - pointer.sx) * k;
  pointer.sy += (pointer.y - pointer.sy) * k;
  const t = now / 1000;
  for (const s of stages) {
    if (!s.visible) continue;
    if (s.frame) { s.frame(dt, t); continue; }
    if (s.onFrame) s.onFrame(dt, t);
    s.renderer.render(s.scene, s.camera);
  }
  requestAnimationFrame(loop);
}

export function webglAvailable() {
  try {
    const c = document.createElement('canvas');
    return !!(window.WebGLRenderingContext && (c.getContext('webgl2') || c.getContext('webgl')));
  } catch {
    return false;
  }
}
