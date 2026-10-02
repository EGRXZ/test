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

export function loadModel(url) {
  if (!cache.has(url)) cache.set(url, loader.loadAsync(url));
  return cache.get(url);
}

// Target height (world units) the scenes were tuned for.
const TARGET_H = 2.96;

/* ---------------- FoldPhone.glb ---------------- */
// Clip "Fold": open until ~0.72 s, folds by ~2.0 s, reopens by ~3.9 s.
const FOLD_START = 0.72;
const FOLD_END = 2.0;
const clipTime = (t) => FOLD_START + THREE.MathUtils.clamp(t, 0, 1) * (FOLD_END - FOLD_START);

export async function createFoldPhone(url = 'assets/models/fold-phone.glb') {
  const gltf = await loadModel(url);
  const model = gltf.scene.clone(true);
  const clip = gltf.animations.find((a) => a.name === 'Fold') || gltf.animations[0];

  const root = new THREE.Group();
  const inner = new THREE.Group();
  const holder = new THREE.Group();
  holder.add(model);
  inner.add(holder);
  root.add(inner);

  const mixer = new THREE.AnimationMixer(model);
  if (clip) mixer.clipAction(clip).play();

  model.traverse((o) => {
    if (!o.isMesh) return;
    const mats = Array.isArray(o.material) ? o.material : [o.material];
    mats.forEach((m) => {
      // Screens carry their wallpaper in an emissive map; keep them out of tone mapping.
      if (m.emissiveMap) {
        m.emissiveMap.colorSpace = THREE.SRGBColorSpace;
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
  // t: 0 = open flat, 1 = folded shut. Keeps the phone centred while it folds.
  api.setFold = (t) => {
    mixer.setTime(clipTime(t));
    tmp.lerpVectors(cOpen, cFolded, t);
    inner.position.set(-tmp.x, -tmp.y, -tmp.z);
  };
  api.setFold(1);
  return api;
}

/* ---------------- FoldProfi_Fold_exploded.glb ---------------- */
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
          if (c.map) c.map.anisotropy = 8;
          clones.set(m, c);
        }
        return clones.get(m);
      };
      o.material = Array.isArray(o.material) ? o.material.map(swap) : swap(o.material);
    });
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
          m.depthWrite = m.opacity > 0.95;
          if (m.emissive && !m.emissiveMap) {
            m.emissive.copy(PEACH).multiplyScalar(isOn ? 0.45 + 0.45 * pulse : 0);
          }
        }
        // Draw the selected part last so ghosts never cover it.
        l.group.traverse((o) => { if (o.isMesh) o.renderOrder = isOn ? 10 : 0; });
      }
    },
  };
}
