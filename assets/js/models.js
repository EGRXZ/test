// Loads the hand-made Blender models (assets/models/*.glb) and wraps them in
// the same small APIs the scenes use: setFold(t) for the phone,
// update()/setActive() for the exploded view.
import * as THREE from 'three';
import { GLTFLoader } from '../../vendor/three/loaders/GLTFLoader.js';
import { DRACOLoader } from '../../vendor/three/loaders/DRACOLoader.js';

const PEACH = new THREE.Color('#e3a081');

const draco = new DRACOLoader().setDecoderPath('vendor/three/draco/');
const loader = new GLTFLoader().setDRACOLoader(draco);
const cache = new Map();

// glTF textures default to REPEAT, so linear filtering at a screen's very edge
// blends in the opposite edge of the wallpaper (a red line from the bottom of
// the image along the top of the screen). Screens must clamp instead.
export function clampEdges(tex) {
  tex.wrapS = tex.wrapT = THREE.ClampToEdgeWrapping;
  tex.needsUpdate = true;
}

// A screen is glass over a lit panel: give it a mirror-like coat so the studio
// softboxes reflect across it, and pull the glow down a touch.
export function screenGlass(m) {
  if ('clearcoat' in m) {
    m.clearcoat = 0.3;
    m.clearcoatRoughness = 0.12;
    m.specularIntensity = 0; // only the thin glass coat reflects, not the panel
  }
  m.roughness = 0.6;
  m.metalness = 0;
  m.emissiveIntensity = 0.9;
  // The panel sits ~0.1 mm from the bezel glass in the models: make it win the depth test.
  m.polygonOffset = true;
  m.polygonOffsetFactor = -2;
  m.polygonOffsetUnits = -4;
}

export function loadModel(url) {
  if (!cache.has(url)) cache.set(url, loader.loadAsync(url));
  return cache.get(url);
}

// Target height (world units) the scenes were tuned for.
const TARGET_H = 2.96;

// Punch-hole cameras sit on the screen surface; they must out-rank the screen's
// own depth offset (see screenGlass) or the panel paints over them.
function liftPunchHoles(model) {
  model.traverse((o) => {
    // The hinge spine reaches the screen plane when the phone is open and shows
    // through the seam between the two display halves as streaks: push it back.
    // Same for the bezel glass and the body shell: both meet the display plane
    // at the fold seam and bled through it as a thin dark line.
    if (o.isMesh && /^(Hinge|InnerGlass|Body)/.test(o.name)) {
      o.material = o.material.clone();
      o.material.polygonOffset = true;
      o.material.polygonOffsetFactor = 6;
      o.material.polygonOffsetUnits = 24;
      return;
    }
    if (!o.isMesh || !/PunchHole/i.test(o.name)) return;
    o.material = o.material.clone();
    o.material.polygonOffset = true;
    o.material.polygonOffsetFactor = -4;
    o.material.polygonOffsetUnits = -12;
  });
}

/* ---------------- FoldPhone.glb ---------------- */
// Clip "Fold": flat until 0.667 s (the last key with both halves exactly
// coplanar — by 0.72 s it is already bent ~1°, which shows as a seam and a
// split highlight), folded by ~2.0 s, reopens by ~3.9 s.
const FOLD_START = 0.667;
const FOLD_END = 2.0;
const clipTime = (t) => FOLD_START + THREE.MathUtils.clamp(t, 0, 1) * (FOLD_END - FOLD_START);

export async function createFoldPhone(url = 'assets/models/fold-phone.glb') {
  const gltf = await loadModel(url);
  const model = gltf.scene.clone(true);
  liftPunchHoles(model);
  const clip = gltf.animations.find((a) => a.name === 'Fold') || gltf.animations[0];

  const root = new THREE.Group();
  const inner = new THREE.Group();
  const holder = new THREE.Group();
  holder.add(model);
  inner.add(holder);
  root.add(inner);

  const mixer = new THREE.AnimationMixer(model);
  if (clip) mixer.clipAction(clip).play();

  // The two inner-display halves meet edge-to-edge at x = 0; rasterisation
  // leaves a hairline crack there that shows the body behind. Overlap them by
  // 0.4 mm. (Geometry is shared between clones, so do it once.)
  model.traverse((o) => {
    const m = o.isMesh && /^InnerDisplay_(L|R)$/.exec(o.name);
    if (!m || o.geometry.userData.seamClosed) return;
    const pos = o.geometry.attributes.position;
    // Only the left half reaches across, and sits 0.03 mm lower, so in the
    // overlap the right half always wins the depth test (no z-fighting dashes).
    // (Draco quantises positions, so find the actual inner edge instead of x = 0.)
    const left = m[1] === 'L';
    o.geometry.computeBoundingBox();
    const edge = o.geometry.boundingBox.max.x;
    for (let i = 0; i < left * pos.count; i++) {
      if (pos.getX(i) > edge - 2e-5) pos.setX(i, edge + 0.0004);
      pos.setY(i, pos.getY(i) - 0.00003);
    }
    pos.needsUpdate = true;
    // Both halves are flat panels facing +Y: identical normals make the studio
    // reflect across them as one sheet, with no brightness step at the fold.
    const nrm = o.geometry.attributes.normal;
    if (nrm) {
      for (let i = 0; i < nrm.count; i++) nrm.setXYZ(i, 0, 1, 0);
      nrm.needsUpdate = true;
    }
    o.geometry.computeBoundingBox();
    o.geometry.computeBoundingSphere();
    o.geometry.userData.seamClosed = true;
  });

  model.traverse((o) => {
    if (!o.isMesh) return;
    const mats = Array.isArray(o.material) ? o.material : [o.material];
    mats.forEach((m) => {
      // Screens carry their wallpaper in an emissive map; keep them out of tone mapping.
      if (m.emissiveMap) {
        m.emissiveMap.colorSpace = THREE.SRGBColorSpace;
        clampEdges(m.emissiveMap);
        screenGlass(m);
        m.toneMapped = false;
      }
      if (m.map) m.map.anisotropy = 8;
    });
  });

  const box = new THREE.Box3();
  const measure = (t) => {
    mixer.setTime(clipTime(t));
    root.updateMatrixWorld(true);
    return box.setFromObject(holder, true).clone();
  };

  // Normalise size to the open phone's height and remember both centres.
  const openBox = measure(0);
  const size = openBox.getSize(new THREE.Vector3());
  const scale = TARGET_H / size.y;
  holder.scale.setScalar(scale);
  const open = measure(0);
  const folded = measure(1);
  const cOpen = open.getCenter(new THREE.Vector3());
  const cFolded = folded.getCenter(new THREE.Vector3());

  // Inner-screen plane (open state) for overlays such as the protective film.
  const screenBox = new THREE.Box3();
  mixer.setTime(clipTime(0));
  root.updateMatrixWorld(true);
  model.traverse((o) => {
    if (o.isMesh && /^InnerDisplay/.test(o.name)) screenBox.expandByObject(o, true);
  });

  const W = open.getSize(new THREE.Vector3()).x / 2;
  const H = open.getSize(new THREE.Vector3()).y;
  const tmp = new THREE.Vector3();

  const api = {
    root,
    inner,
    W,
    H,
    screen: screenBox.isEmpty() ? null : {
      center: screenBox.getCenter(new THREE.Vector3()).sub(cOpen),
      size: screenBox.getSize(new THREE.Vector3()),
      front: screenBox.max.z - cOpen.z,
    },
  };
  // Fully open, the hinge spine sits right under the display seam and still
  // shows through as a dashed line on some GPUs; it's hidden from the front
  // anyway, so only draw it while the phone is actually bending.
  const hinges = [];
  model.traverse((o) => { if (o.isMesh && /^Hinge/.test(o.name)) hinges.push(o); });
  // t: 0 = open flat, 1 = folded shut. Keeps the phone centred while it folds.
  api.setFold = (t) => {
    hinges.forEach((h) => { h.visible = t > 0.01; });
    mixer.setTime(clipTime(t));
    tmp.lerpVectors(cOpen, cFolded, t);
    inner.position.set(-tmp.x, -tmp.y, -tmp.z);
  };
  api.setFold(1);
  return api;
}

/* ---------------- FoldProfi_Fold_exploded.glb ---------------- */

// depthRank 0..n by each mesh's front-most z inside the layer (used as renderOrder).
function rankByDepth(group) {
  const items = [];
  group.traverse((o) => {
    if (!o.isMesh) return;
    o.geometry.computeBoundingBox();
    items.push([o, o.geometry.boundingBox.max.z + o.position.z]);
  });
  items.sort((a, b) => a[1] - b[1]).forEach(([o], i) => { o.userData.depthRank = i; });
}
// Group z in the file is the exploded position; these are the assembled ones.
const ASSEMBLED_Z = {
  back: -0.07, battery: -0.03, board: -0.035, audio: -0.03,
  hinge: -0.035, frame: -0.008, display: 0, glass: 0.004,
};

export async function createExplodedModel(url = 'assets/models/fold-exploded.glb') {
  const gltf = await loadModel(url);
  const scene = gltf.scene.clone(true);
  const top = scene.getObjectByName('FoldProfi_Fold_exploded') || scene;
  const root = new THREE.Group();
  root.add(scene);

  // In the source model the display flex cables wrap round the bottom edge and
  // end up 3 mm in FRONT of the screen, poking through it. Push every vertex of
  // the display layer's extra parts that lies inside the panel's footprint back
  // behind the panel (the panel is display_0, the screen is display_1).
  const displayGroup = top.getObjectByName('display');
  if (displayGroup) {
    const panel = displayGroup.getObjectByName('display_0');
    const pb = panel ? new THREE.Box3().setFromBufferAttribute(panel.geometry.attributes.position) : null;
    if (pb) {
      const behind = pb.min.z - 0.001;
      displayGroup.traverse((o) => {
        if (!o.isMesh || o === panel || o.name === 'display_1') return;
        o.geometry = o.geometry.clone();
        const pos = o.geometry.attributes.position;
        let moved = 0;
        for (let i = 0; i < pos.count; i++) {
          const x = pos.getX(i), y = pos.getY(i), z = pos.getZ(i);
          if (z > behind && x > pb.min.x && x < pb.max.x && y > pb.min.y - 0.05 && y < pb.max.y + 0.05) {
            pos.setZ(i, behind);
            moved++;
          }
        }
        if (moved) { pos.needsUpdate = true; o.geometry.computeVertexNormals(); o.geometry.computeBoundingSphere(); }
      });
    }
  }

  const layers = {};
  for (const g of [...top.children]) {
    const key = g.name;
    if (!(key in ASSEMBLED_Z)) continue;
    // Each layer gets its own material copies so it can dim/glow independently.
    const clones = new Map();
    g.traverse((o) => {
      if (!o.isMesh) return;
      const swap = (m) => {
        if (!clones.has(m)) {
          const c = m.clone();
          c.userData.base = m.transparent ? m.opacity : 1;
          c.transparent = true;
          if (c.map) { c.map.anisotropy = 8; clampEdges(c.map); }
          clones.set(m, c);
        }
        return clones.get(m);
      };
      o.material = Array.isArray(o.material) ? o.material.map(swap) : swap(o.material);
    });
    rankByDepth(g);
    layers[key] = { group: g, z0: ASSEMBLED_Z[key], z1: g.position.z, mats: [...clones.values()] };
  }

  let active = null;
  return {
    root,
    layers,
    setActive(key) { active = key; },
    update(explode, dt, time) {
      const pulse = 0.5 + 0.5 * Math.sin(time * 4);
      const k = 1 - Math.exp(-dt * 10);
      for (const [key, l] of Object.entries(layers)) {
        const isOn = active === key;
        const dim = active && !isOn;
        // The selected part lifts out of the stack towards the viewer.
        l.lift = (l.lift || 0) + ((isOn ? 0.22 : 0) - (l.lift || 0)) * k;
        l.group.position.z = THREE.MathUtils.lerp(l.z0, l.z1, explode) + l.lift;
        for (const m of l.mats) {
          const base = m.userData.base ?? 1;
          // Everything else turns into a faint ghost so the part's location reads.
          const target = dim ? base * 0.05 : (isOn ? Math.max(base, key === 'glass' ? 0.35 : 1) : base);
          m.opacity += (target - m.opacity) * k;
          if (Math.abs(target - m.opacity) < 0.002) m.opacity = target;
          // Solid parts render in the opaque pass so they always hide what's behind
          // them; only fading or genuinely see-through parts go transparent.
          const see = m.opacity < 0.999;
          if (m.transparent !== see) { m.transparent = see; m.needsUpdate = true; }
          // The selected layer keeps writing depth while it fades in, so its own
          // back parts can't show through its front (e.g. copper through the screen).
          m.depthWrite = !see || isOn;
          if (m.emissive && !m.emissiveMap) {
            m.emissive.copy(PEACH).multiplyScalar(isOn ? 0.45 + 0.45 * pulse : 0);
          }
        }
        // Draw the selected part last so ghosts never cover it.
        // Within it, back-most parts first and the front-most (screen) last.
        l.group.traverse((o) => { if (o.isMesh) o.renderOrder = isOn ? 10 + (o.userData.depthRank || 0) : 0; });
      }
    },
  };
}

/* ---------------- BarPhone.glb / FlipPhone.glb (service tiles) ---------------- */
// Both are modelled in metres; one world unit ≈ 5 cm keeps them in scale with each other.
const TILE_SCALE = 20;

function centreOn(holder, inner, root) {
  root.updateMatrixWorld(true);
  return new THREE.Box3().setFromObject(holder, true).getCenter(new THREE.Vector3());
}

export async function createBarPhone(url = 'assets/models/bar-phone.glb') {
  const { liveScreen } = await import('./screens.js');
  const gltf = await loadModel(url);
  const model = gltf.scene.clone(true);
  liftPunchHoles(model);
  const root = new THREE.Group();
  const inner = new THREE.Group();
  const holder = new THREE.Group();
  holder.add(model);
  holder.scale.setScalar(TILE_SCALE);
  inner.add(holder);
  root.add(inner);

  let screen = null;
  model.traverse((o) => {
    if (o.isMesh && o.material && o.material.name === 'Bar_Display' && !screen) {
      o.material = o.material.clone();
      screen = liveScreen(o.material, 'bar');
    }
  });
  const c = centreOn(holder, inner, root);
  inner.position.set(-c.x, -c.y, -c.z);
  return { root, tick: (t) => screen && screen.tick(t) };
}

// Clip "Fold": open until ~0.8 s, shut by ~2.1 s.
const FLIP_START = 0.8;
const FLIP_END = 2.1;

export async function createFlipPhone(url = 'assets/models/flip-phone.glb') {
  const { liveScreen } = await import('./screens.js');
  const gltf = await loadModel(url);
  const model = gltf.scene.clone(true);
  liftPunchHoles(model);
  const clip = gltf.animations.find((a) => a.name === 'Fold') || gltf.animations[0];
  const root = new THREE.Group();
  const inner = new THREE.Group();
  const holder = new THREE.Group();
  holder.add(model);
  holder.scale.setScalar(TILE_SCALE);
  inner.add(holder);
  root.add(inner);

  const mixer = new THREE.AnimationMixer(model);
  if (clip) mixer.clipAction(clip).play();
  const at = (t) => FLIP_START + THREE.MathUtils.clamp(t, 0, 1) * (FLIP_END - FLIP_START);

  const screens = [];
  const done = new Map();
  model.traverse((o) => {
    if (!o.isMesh || !o.material) return;
    const name = o.material.name;
    const layout = name === 'Flip_Display_Inner' ? 'flipInner' : name === 'Flip_Display_Cover' ? 'flipCover' : null;
    if (!layout) return;
    // Both inner halves share one material, so one live canvas drives both.
    if (!done.has(name)) {
      const m = o.material.clone();
      done.set(name, m);
      screens.push(liveScreen(m, layout, { maxW: layout === 'flipCover' ? 320 : 480 }));
    }
    o.material = done.get(name);
  });

  const flipHinges = [];
  model.traverse((o) => { if (o.isMesh && /^Hinge/.test(o.name)) flipHinges.push(o); });
  mixer.setTime(at(0));
  const cOpen = centreOn(holder, inner, root);
  mixer.setTime(at(1));
  const cShut = centreOn(holder, inner, root);
  const tmp = new THREE.Vector3();

  return {
    root,
    // Shut, the cover screen reads upright only with the hinge on top.
    coverRoll: true,
    // t: 0 = open, 1 = shut
    setFold(t) {
      flipHinges.forEach((h) => { h.visible = t > 0.01; });
      mixer.setTime(at(t));
      tmp.lerpVectors(cOpen, cShut, t);
      inner.position.set(-tmp.x, -tmp.y, -tmp.z);
    },
    tick(t) { screens.forEach((s) => s.tick(t)); },
  };
}

/* ---------------- Watch.glb (smart-watch tile) ---------------- */
export async function createWatchModel(url = 'assets/models/watch.glb') {
  const { liveScreen } = await import('./screens.js');
  const gltf = await loadModel(url);
  const model = gltf.scene.clone(true);
  const root = new THREE.Group();
  const inner = new THREE.Group();
  const holder = new THREE.Group();
  holder.add(model);
  inner.add(holder);
  root.add(inner);

  let screen = null;
  model.traverse((o) => {
    if (o.isMesh && o.material && o.material.name === 'Watch_Display' && !screen) {
      o.material = o.material.clone();
      screen = liveScreen(o.material, 'watch', { maxW: 420, fps: 20 });
    }
  });
  // Fit the whole watch (strap included) to ~3 units tall, like the phones.
  root.updateMatrixWorld(true);
  const box = new THREE.Box3().setFromObject(holder, true);
  holder.scale.setScalar(3 / box.getSize(new THREE.Vector3()).y);
  const c = centreOn(holder, inner, root);
  inner.position.set(-c.x, -c.y, -c.z);
  return { root, tick: (t) => screen && screen.tick(t) };
}
