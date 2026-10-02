// Minimal multi-canvas renderer: each Stage owns one canvas, renders only
// while on screen, and shares a single requestAnimationFrame loop.
import * as THREE from 'three';
// Product-photo look: a dark studio with large white softboxes for long, crisp
// highlights on metal and glass (instead of three's grey RoomEnvironment).
export function studioEnvironment(renderer) {
  const scene = new THREE.Scene();
  const room = new THREE.Mesh(
    new THREE.BoxGeometry(24, 16, 24),
    new THREE.MeshBasicMaterial({ color: 0x07191e, side: THREE.BackSide }),
  );
  scene.add(room);
  const panel = (w, h, intensity, pos, look, tint = 0xffffff) => {
    const m = new THREE.Mesh(
      new THREE.PlaneGeometry(w, h),
      new THREE.MeshBasicMaterial({ color: new THREE.Color(tint).multiplyScalar(intensity), side: THREE.DoubleSide }),
    );
    m.position.set(...pos);
    m.lookAt(...look);
    scene.add(m);
  };
  panel(10, 5, 2.6, [0, 7.5, 1], [0, 0, 0]); // overhead softbox
  panel(1.6, 10, 5.0, [-8, 0.5, 3], [0, 0, 0]); // key strip, left-front
  panel(1.2, 10, 3.6, [8, 0.5, -4], [0, 0, 0]); // rim strip, right-back
  panel(1.0, 8, 2.2, [-6, 0, -7], [0, 0, 0], 0xe4efe8); // faint sage kicker
  panel(9, 1.2, 1.0, [0, -5, 7], [0, 0, 0]); // low front bounce
  const pmrem = new THREE.PMREMGenerator(renderer);
  const env = pmrem.fromScene(scene, 0.02).texture;
  pmrem.dispose();
  scene.traverse((o) => { if (o.isMesh) { o.geometry.dispose(); o.material.dispose(); } });
  return env;
}

// Soft elliptical shadow billboard: grounds an object with no visible floor.
let shadowTex = null;
export function makeSoftShadow(width = 2.4, height = 0.42, opacity = 0.55) {
  if (!shadowTex) {
    const c = document.createElement('canvas');
    c.width = c.height = 256;
    const g = c.getContext('2d');
    const grd = g.createRadialGradient(128, 128, 0, 128, 128, 128);
    grd.addColorStop(0, 'rgba(0,0,0,1)');
    grd.addColorStop(0.45, 'rgba(0,0,0,0.55)');
    grd.addColorStop(1, 'rgba(0,0,0,0)');
    g.fillStyle = grd;
    g.fillRect(0, 0, 256, 256);
    shadowTex = new THREE.CanvasTexture(c);
  }
  const m = new THREE.Mesh(
    new THREE.PlaneGeometry(1, 1),
    new THREE.MeshBasicMaterial({ map: shadowTex, transparent: true, opacity, depthWrite: false, toneMapped: false }),
  );
  m.scale.set(width, height, 1);
  m.renderOrder = -1;
  return m;
}

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
  constructor(canvas, { fov = 30, z = 10, dpr = 1.75, exposure = 1.0, envIntensity = 1 } = {}) {
    this.canvas = canvas;
    this.renderer = new THREE.WebGLRenderer({ canvas, antialias: true, alpha: true, powerPreference: 'high-performance' });
    this.renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, dpr));
    this.renderer.outputColorSpace = THREE.SRGBColorSpace;
    this.renderer.toneMapping = THREE.NeutralToneMapping;
    this.renderer.toneMappingExposure = exposure;
    this.renderer.setClearColor(0x000000, 0);

    this.scene = new THREE.Scene();
    this.scene.environment = studioEnvironment(this.renderer);
    this.scene.environmentIntensity = envIntensity;

    // Near plane far from the lens: depth precision is what keeps the near-coplanar
    // screen/glass layers of the models from z-fighting.
    this.camera = new THREE.PerspectiveCamera(fov, 1, Math.max(0.5, z - 9), z + 12);
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
  constructor(canvas, { dpr = 1.5, exposure = 1.0 } = {}) {
    this.canvas = canvas;
    this.renderer = new THREE.WebGLRenderer({ canvas, antialias: true, alpha: true, powerPreference: 'high-performance' });
    this.renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, dpr));
    this.renderer.outputColorSpace = THREE.SRGBColorSpace;
    this.renderer.toneMapping = THREE.NeutralToneMapping;
    this.renderer.toneMappingExposure = exposure;
    this.renderer.setClearColor(0x000000, 0);
    this.renderer.autoClear = false;
    this.env = studioEnvironment(this.renderer);
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
  addView(el, { fov = 30, z = 10, envIntensity = 1 } = {}) {
    const scene = new THREE.Scene();
    scene.environment = this.env;
    scene.environmentIntensity = envIntensity;
    addLights(scene);
    const camera = new THREE.PerspectiveCamera(fov, 1, Math.max(0.5, z - 9), z + 12);
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
  // A single light source: the studio environment (softboxes). Punctual lights
  // were dropped — on glossy screens they read as blown-out white disks.
  scene.add(new THREE.HemisphereLight(0xffffff, 0x101010, 0.2));
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
