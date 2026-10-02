// Procedural 3D devices: Fold, Flip, slab phone, watch, exploded Fold.
// All geometry is built in code — no external models needed.
import * as THREE from 'three';
import {
  foldInnerTexture, foldCoverTexture, flipInnerTexture, flipCoverTexture,
  barTexture, watchTexture,
} from './textures.js';

const PEACH = new THREE.Color('#e3a081');

/* ---------------- geometry helpers ---------------- */

// Rounded rectangle with per-corner radii [tl, tr, br, bl].
function rrShape(x, y, w, h, r) {
  const [tl, tr, br, bl] = Array.isArray(r) ? r : [r, r, r, r];
  const s = new THREE.Shape();
  s.moveTo(x + bl, y);
  s.lineTo(x + w - br, y);
  s.quadraticCurveTo(x + w, y, x + w, y + br);
  s.lineTo(x + w, y + h - tr);
  s.quadraticCurveTo(x + w, y + h, x + w - tr, y + h);
  s.lineTo(x + tl, y + h);
  s.quadraticCurveTo(x, y + h, x, y + h - tl);
  s.lineTo(x, y + bl);
  s.quadraticCurveTo(x, y, x + bl, y);
  return s;
}

// Extruded slab spanning z ∈ [-d, 0]; outline is exactly (x, y, w, h).
function slabGeo(x, y, w, h, d, r, bevel = Math.min(0.02, d * 0.3)) {
  const radii = (Array.isArray(r) ? r : [r, r, r, r]).map((v) => Math.max(0.001, v - bevel));
  const shape = rrShape(x + bevel, y + bevel, w - bevel * 2, h - bevel * 2, radii);
  const g = new THREE.ExtrudeGeometry(shape, {
    depth: Math.max(0.001, d - bevel * 2),
    bevelEnabled: true,
    bevelThickness: bevel,
    bevelSize: bevel,
    bevelSegments: 5,
    curveSegments: 14,
  });
  g.translate(0, 0, -(d - bevel));
  g.computeVertexNormals();
  return g;
}

// Flat rounded plane with UVs remapped into [u0..u1] x [v0..v1].
function planeGeo(x, y, w, h, r, uv = [0, 0, 1, 1]) {
  const g = new THREE.ShapeGeometry(rrShape(x, y, w, h, r), 16);
  const pos = g.attributes.position;
  const uvs = g.attributes.uv;
  const [u0, v0, u1, v1] = uv;
  for (let i = 0; i < pos.count; i++) {
    const px = (pos.getX(i) - x) / w;
    const py = (pos.getY(i) - y) / h;
    uvs.setXY(i, u0 + px * (u1 - u0), v0 + py * (v1 - v0));
  }
  uvs.needsUpdate = true;
  return g;
}

/* ---------------- materials ---------------- */

export function makeMaterials() {
  return {
    frame: new THREE.MeshPhysicalMaterial({
      color: 0x2c2c2e, metalness: 0.95, roughness: 0.28, clearcoat: 0.4, clearcoatRoughness: 0.2,
    }),
    frameLight: new THREE.MeshPhysicalMaterial({
      color: 0x8a8a86, metalness: 1, roughness: 0.22,
    }),
    back: new THREE.MeshPhysicalMaterial({
      color: 0x171816, metalness: 0.25, roughness: 0.38, clearcoat: 1, clearcoatRoughness: 0.12,
    }),
    bezel: new THREE.MeshStandardMaterial({ color: 0x030303, roughness: 0.4, metalness: 0.1 }),
    glass: new THREE.MeshPhysicalMaterial({
      color: 0x000000, metalness: 0, roughness: 0.04, transparent: true, opacity: 0.18,
      clearcoat: 1, clearcoatRoughness: 0.02, depthWrite: false,
    }),
    lens: new THREE.MeshPhysicalMaterial({
      color: 0x05050a, metalness: 0.6, roughness: 0.05, clearcoat: 1, iridescence: 0.6,
    }),
    ring: new THREE.MeshPhysicalMaterial({ color: 0x9a9a96, metalness: 1, roughness: 0.18 }),
  };
}

function screenMat(tex) {
  return new THREE.MeshBasicMaterial({ map: tex, toneMapped: false });
}

function lensStack(mats, n, r, gap, axis = 'y') {
  const g = new THREE.Group();
  const ringGeo = new THREE.CylinderGeometry(r * 1.18, r * 1.22, 0.03, 48);
  const lensGeo = new THREE.CylinderGeometry(r, r, 0.034, 48);
  for (let i = 0; i < n; i++) {
    const ring = new THREE.Mesh(ringGeo, mats.ring);
    const lens = new THREE.Mesh(lensGeo, mats.lens);
    ring.rotation.x = lens.rotation.x = Math.PI / 2;
    const o = (i - (n - 1) / 2) * gap;
    if (axis === 'y') { ring.position.y = lens.position.y = -o; } else { ring.position.x = lens.position.x = o; }
    g.add(ring, lens);
  }
  return g;
}

/* ---------------- Fold ---------------- */

export function createFold(renderer, mats = makeMaterials()) {
  const W = 1.32, H = 2.96, D = 0.068, bez = 0.055, R = 0.18, Rh = 0.015, gap = 0.012;
  const root = new THREE.Group();
  const inner = new THREE.Group();
  root.add(inner);

  const innerAspect = (2 * (W - bez)) / (H - 2 * bez);
  const innerTex = foldInnerTexture(innerAspect, renderer);
  const coverW = W - bez * 2 - 0.04, coverH = H - bez * 2 - 0.1;
  const coverTex = foldCoverTexture(coverW / coverH, renderer);
  const innerMat = screenMat(innerTex);
  const coverMat = screenMat(coverTex);

  // Right (main) half
  const right = new THREE.Group();
  right.add(new THREE.Mesh(slabGeo(0, -H / 2, W, H, D, [Rh, R, R, Rh]), [mats.back, mats.frame]));
  const rBez = new THREE.Mesh(planeGeo(0, -H / 2 + 0.005, W - 0.005, H - 0.01, [Rh, R - 0.01, R - 0.01, Rh]), mats.bezel);
  rBez.position.z = 0.0008;
  const rScr = new THREE.Mesh(planeGeo(0, -H / 2 + bez, W - bez, H - bez * 2, [0, R - bez, R - bez, 0], [0.5, 0, 1, 1]), innerMat);
  rScr.position.z = 0.0016;
  right.add(rBez, rScr);
  // Camera bump on the back
  const bump = new THREE.Mesh(slabGeo(-0.24, -0.58, 0.48, 1.16, 0.03, 0.22, 0.012), mats.frame);
  bump.position.set(W - 0.36, H / 2 - 0.8, -D);
  const lenses = lensStack(mats, 3, 0.115, 0.34);
  lenses.position.set(W - 0.36, H / 2 - 0.8, -D - 0.045);
  right.add(bump, lenses);
  inner.add(right);

  // Left half on a hinge pivot
  const pivot = new THREE.Group();
  const left = new THREE.Group();
  left.add(new THREE.Mesh(slabGeo(-W, -H / 2, W, H, D, [R, Rh, Rh, R]), [mats.back, mats.frame]));
  const lBez = new THREE.Mesh(planeGeo(-W + 0.005, -H / 2 + 0.005, W - 0.005, H - 0.01, [R - 0.01, Rh, Rh, R - 0.01]), mats.bezel);
  lBez.position.z = 0.0008;
  const lScr = new THREE.Mesh(planeGeo(-W + bez, -H / 2 + bez, W - bez, H - bez * 2, [R - bez, 0, 0, R - bez], [0, 0, 0.5, 1]), innerMat);
  lScr.position.z = 0.0016;
  left.add(lBez, lScr);
  // Cover screen on the back of the left half
  const coverBez = new THREE.Mesh(planeGeo(-W / 2 + 0.01, -H / 2 + 0.01, W - 0.02, H - 0.02, R - 0.02), mats.bezel);
  coverBez.rotation.y = Math.PI;
  coverBez.position.set(-W / 2, 0, -D - 0.0008);
  const cover = new THREE.Mesh(planeGeo(-coverW / 2, -coverH / 2, coverW, coverH, 0.12), coverMat);
  cover.rotation.y = Math.PI;
  cover.position.set(-W / 2, 0, -D - 0.0016);
  const coverGlass = new THREE.Mesh(planeGeo(-W / 2 + 0.01, -H / 2 + 0.01, W - 0.02, H - 0.02, R - 0.02), mats.glass);
  coverGlass.rotation.y = Math.PI;
  coverGlass.position.set(-W / 2, 0, -D - 0.003);
  left.add(coverBez, cover, coverGlass);
  pivot.add(left);
  inner.add(pivot);

  // Hinge spine
  const hinge = new THREE.Mesh(new THREE.CylinderGeometry(1, 1, H * 0.97, 40, 1, false), mats.frame);
  inner.add(hinge);

  // Front glass sheen over the inner screen (fades in when open)
  const sheen = new THREE.Mesh(planeGeo(-W + bez, -H / 2 + bez, 2 * (W - bez), H - bez * 2, R - bez), mats.glass.clone());
  sheen.position.z = 0.003;
  inner.add(sheen);

  const api = {
    root, inner, W, H, D, innerMat, coverMat, pivot,
    // t: 0 = fully open (flat), 1 = folded shut
    setFold(t) {
      const a = t * Math.PI;
      pivot.rotation.y = a;
      pivot.position.z = gap * t;
      const r = (D / 2) * (1 + t) + gap * t * 0.5;
      hinge.scale.set(r, 1, r);
      hinge.position.set(0, 0, -D / 2 * (1 - t) + gap * t * 0.5);
      inner.position.set(-(W / 2) * t, 0, (D / 2) * (1 - t));
      sheen.visible = t < 0.02;
      const on = THREE.MathUtils.clamp(1 - t * 1.6, 0, 1);
      innerMat.color.setScalar(0.08 + 0.92 * on);
    },
  };
  api.setFold(1);
  return api;
}

/* ---------------- Flip ---------------- */

export function createFlip(renderer, mats = makeMaterials()) {
  const W = 1.42, H = 1.6, D = 0.072, bez = 0.06, R = 0.22, Rh = 0.02, gap = 0.012;
  const root = new THREE.Group();
  const inner = new THREE.Group();
  root.add(inner);

  const innerTex = flipInnerTexture((W - bez * 2) / (2 * (H - bez)), renderer);
  const innerMat = screenMat(innerTex);
  const cw = W - 0.14, ch = H - 0.22;
  const coverMat = screenMat(flipCoverTexture(cw / ch, renderer));

  // Bottom half (static)
  const bottom = new THREE.Group();
  bottom.add(new THREE.Mesh(slabGeo(-W / 2, -H, W, H, D, [Rh, Rh, R, R]), [mats.back, mats.frame]));
  const bBez = new THREE.Mesh(planeGeo(-W / 2 + 0.005, -H + 0.005, W - 0.01, H - 0.005, [Rh, Rh, R - 0.01, R - 0.01]), mats.bezel);
  bBez.position.z = 0.0008;
  const bScr = new THREE.Mesh(planeGeo(-W / 2 + bez, -H + bez, W - bez * 2, H - bez, [0, 0, R - bez, R - bez], [0, 0, 1, 0.5]), innerMat);
  bScr.position.z = 0.0016;
  bottom.add(bBez, bScr);
  inner.add(bottom);

  // Top half on a hinge pivot (rotates about X)
  const pivot = new THREE.Group();
  const top = new THREE.Group();
  top.add(new THREE.Mesh(slabGeo(-W / 2, 0, W, H, D, [R, R, Rh, Rh]), [mats.back, mats.frame]));
  const tBez = new THREE.Mesh(planeGeo(-W / 2 + 0.005, 0, W - 0.01, H - 0.005, [R - 0.01, R - 0.01, Rh, Rh]), mats.bezel);
  tBez.position.z = 0.0008;
  const tScr = new THREE.Mesh(planeGeo(-W / 2 + bez, 0, W - bez * 2, H - bez, [R - bez, R - bez, 0, 0], [0, 0.5, 1, 1]), innerMat);
  tScr.position.z = 0.0016;
  top.add(tBez, tScr);
  // Big cover screen + cameras on the back of the top half
  const cBez = new THREE.Mesh(planeGeo(-W / 2 + 0.01, 0.01, W - 0.02, H - 0.02, [R - 0.02, R - 0.02, Rh, Rh]), mats.bezel);
  cBez.rotation.x = Math.PI;
  cBez.position.set(0, H, -D - 0.0008);
  const cover = new THREE.Mesh(planeGeo(-cw / 2, -ch / 2, cw, ch, 0.14), coverMat);
  cover.rotation.x = Math.PI;
  cover.position.set(0, H / 2 + 0.02, -D - 0.0016);
  const cams = lensStack(mats, 2, 0.12, 0.34, 'x');
  cams.rotation.z = Math.PI / 2;
  cams.position.set(-W / 2 + 0.3, 0.38, -D - 0.012);
  const cGlass = new THREE.Mesh(planeGeo(-W / 2 + 0.01, 0.01, W - 0.02, H - 0.02, [R - 0.02, R - 0.02, Rh, Rh]), mats.glass);
  cGlass.rotation.x = Math.PI;
  cGlass.position.set(0, H, -D - 0.003);
  top.add(cBez, cover, cams, cGlass);
  pivot.add(top);
  inner.add(pivot);

  const hinge = new THREE.Mesh(new THREE.CylinderGeometry(1, 1, W * 0.96, 40), mats.frame);
  hinge.rotation.z = Math.PI / 2;
  inner.add(hinge);

  const api = {
    root, inner, innerMat,
    setFold(t) {
      pivot.rotation.x = t * Math.PI;
      pivot.position.z = gap * t;
      const r = (D / 2) * (1 + t) + gap * t * 0.5;
      hinge.scale.set(r, 1, r);
      hinge.position.set(0, 0, -D / 2 * (1 - t) + gap * t * 0.5);
      inner.position.set(0, (H / 2) * t, (D / 2) * (1 - t));
      innerMat.color.setScalar(0.08 + 0.92 * THREE.MathUtils.clamp(1 - t * 1.6, 0, 1));
    },
  };
  api.setFold(1);
  return api;
}

/* ---------------- Classic slab phone ---------------- */

export function createBar(renderer, mats = makeMaterials()) {
  const W = 1.46, H = 3.02, D = 0.085, R = 0.24, bez = 0.05;
  const root = new THREE.Group();
  root.add(new THREE.Mesh(slabGeo(-W / 2, -H / 2, W, H, D, R, 0.03), [mats.back, mats.frameLight]));
  const bezel = new THREE.Mesh(planeGeo(-W / 2 + 0.01, -H / 2 + 0.01, W - 0.02, H - 0.02, R - 0.01), mats.bezel);
  bezel.position.z = 0.0008;
  const sw = W - bez * 2, sh = H - bez * 2;
  const scr = new THREE.Mesh(planeGeo(-sw / 2, -sh / 2, sw, sh, R - bez), screenMat(barTexture(sw / sh, renderer)));
  scr.position.z = 0.0016;
  const glass = new THREE.Mesh(planeGeo(-W / 2 + 0.01, -H / 2 + 0.01, W - 0.02, H - 0.02, R - 0.01), mats.glass);
  glass.position.z = 0.003;
  // Camera island
  const bump = new THREE.Mesh(slabGeo(-0.42, -0.42, 0.84, 0.84, 0.035, 0.24, 0.014), mats.frame);
  bump.position.set(-W / 2 + 0.56, H / 2 - 0.56, -D);
  const l1 = lensStack(mats, 2, 0.12, 0.38);
  l1.position.set(-W / 2 + 0.44, H / 2 - 0.56, -D - 0.05);
  const l2 = lensStack(mats, 1, 0.1, 0);
  l2.position.set(-W / 2 + 0.78, H / 2 - 0.4, -D - 0.05);
  root.add(bezel, scr, glass, bump, l1, l2);
  return { root };
}

/* ---------------- Watch ---------------- */

export function createWatch(renderer, mats = makeMaterials()) {
  const W = 1.3, H = 1.56, D = 0.36, R = 0.36;
  const root = new THREE.Group();
  const body = new THREE.Mesh(slabGeo(-W / 2, -H / 2, W, H, D, R, 0.1), [mats.frameLight, mats.frameLight]);
  body.position.z = D / 2;
  const bezel = new THREE.Mesh(planeGeo(-W / 2 + 0.05, -H / 2 + 0.05, W - 0.1, H - 0.1, R - 0.05), mats.bezel);
  bezel.position.z = D / 2 + 0.001;
  const sw = W - 0.22, sh = H - 0.22;
  const scr = new THREE.Mesh(planeGeo(-sw / 2, -sh / 2, sw, sh, R - 0.12), screenMat(watchTexture(sw / sh, renderer)));
  scr.position.z = D / 2 + 0.002;
  const glass = new THREE.Mesh(planeGeo(-W / 2 + 0.05, -H / 2 + 0.05, W - 0.1, H - 0.1, R - 0.05), mats.glass);
  glass.position.z = D / 2 + 0.004;
  const crown = new THREE.Mesh(new THREE.CylinderGeometry(0.1, 0.1, 0.12, 32), mats.ring);
  crown.rotation.z = Math.PI / 2;
  crown.position.set(W / 2 + 0.04, 0.22, 0);
  const crownCap = new THREE.Mesh(new THREE.CylinderGeometry(0.06, 0.06, 0.02, 32), new THREE.MeshStandardMaterial({ color: PEACH, roughness: 0.4 }));
  crownCap.rotation.z = Math.PI / 2;
  crownCap.position.set(W / 2 + 0.105, 0.22, 0);
  const btn = new THREE.Mesh(slabGeo(-0.03, -0.17, 0.06, 0.34, 0.05, 0.03, 0.01), mats.ring);
  btn.rotation.y = Math.PI / 2;
  btn.position.set(W / 2 - 0.005, -0.2, 0);
  root.add(body, bezel, scr, glass, crown, crownCap, btn);

  const strapMat = new THREE.MeshPhysicalMaterial({ color: 0x1d1d1b, roughness: 0.75, metalness: 0, sheen: 1, sheenColor: 0x3d3d3d });
  const seg = (y, dir) => {
    const g = new THREE.Group();
    let px = 0, py = 0, pz = 0, ang = 0;
    for (let i = 0; i < 5; i++) {
      const m = new THREE.Mesh(slabGeo(-0.48, 0, 0.96, 0.42, 0.1, 0.06, 0.03), strapMat);
      m.position.set(px, py, pz);
      m.rotation.x = -ang * dir;
      g.add(m);
      py += Math.cos(ang) * 0.4 * dir;
      pz -= Math.sin(ang) * 0.4;
      ang += 0.32;
    }
    if (dir < 0) g.children.forEach((m) => { m.rotation.x += Math.PI; m.position.z -= 0.1; });
    g.position.set(0, y, 0.02);
    return g;
  };
  root.add(seg(H / 2 - 0.12, 1), seg(-H / 2 + 0.12, -1));
  return { root };
}

/* ---------------- Exploded Fold (issues section) ---------------- */

export function createExplodedFold(renderer, mats = makeMaterials()) {
  const W = 1.32, H = 2.96, R = 0.18;
  const root = new THREE.Group();
  const layers = {};
  const add = (key, mesh, zAssembled, zExploded) => {
    if (!layers[key]) {
      layers[key] = { group: new THREE.Group(), z0: zAssembled, z1: zExploded, mats: [] };
      root.add(layers[key].group);
    }
    layers[key].group.add(mesh);
  };
  const own = (m) => {
    const c = m.clone();
    c.transparent = true;
    c.userData.base = m.opacity ?? 1;
    return c;
  };

  // Back covers + camera
  const backMat = own(mats.back);
  const frameMat = own(mats.frame);
  add('back', new THREE.Mesh(slabGeo(0, -H / 2, W, H, 0.03, [0.015, R, R, 0.015], 0.01), [backMat, frameMat]), -0.07, -1.25);
  add('back', new THREE.Mesh(slabGeo(-W, -H / 2, W, H, 0.03, [R, 0.015, 0.015, R], 0.01), [backMat, frameMat]), -0.07, -1.25);
  const bump = new THREE.Mesh(slabGeo(-0.24, -0.58, 0.48, 1.16, 0.03, 0.22, 0.012), frameMat);
  bump.position.set(W - 0.36, H / 2 - 0.8, -0.03);
  add('back', bump, -0.07, -1.25);

  // Batteries
  const batMat = own(new THREE.MeshPhysicalMaterial({ color: 0x2a2a28, metalness: 0.5, roughness: 0.45, clearcoat: 0.5 }));
  const b1 = new THREE.Mesh(slabGeo(-W + 0.16, -H / 2 + 0.3, W - 0.32, H - 0.9, 0.05, 0.06, 0.01), batMat);
  const b2 = new THREE.Mesh(slabGeo(0.16, -H / 2 + 0.3, W - 0.32, 1.3, 0.05, 0.06, 0.01), batMat);
  add('battery', b1, -0.03, -0.82);
  add('battery', b2, -0.03, -0.82);

  // Logic board, chips, flex cable
  const pcbMat = own(new THREE.MeshPhysicalMaterial({ color: 0x0b2a2c, metalness: 0.3, roughness: 0.5, clearcoat: 0.6 }));
  const chipMat = own(new THREE.MeshPhysicalMaterial({ color: 0x0a0a0a, metalness: 0.4, roughness: 0.3 }));
  const goldMat = own(new THREE.MeshPhysicalMaterial({ color: 0xc28e01, metalness: 1, roughness: 0.3 }));
  add('board', new THREE.Mesh(slabGeo(0.12, H / 2 - 1.2, W - 0.24, 1.05, 0.025, 0.05, 0.008), pcbMat), -0.035, -0.62);
  [[0.3, H / 2 - 0.55, 0.32, 0.32], [0.72, H / 2 - 0.5, 0.22, 0.22], [0.32, H / 2 - 1.02, 0.5, 0.2], [0.85, H / 2 - 0.95, 0.24, 0.3]].forEach(([x, y, w, h], i) => {
    const m = new THREE.Mesh(slabGeo(x, y, w, h, 0.03, 0.02, 0.006), i === 0 ? goldMat : chipMat);
    m.position.z = 0.028;
    add('board', m, -0.035, -0.62);
  });
  const flex = new THREE.Mesh(slabGeo(-0.7, H / 2 - 0.85, 1.0, 0.12, 0.01, 0.02, 0.003), goldMat);
  add('board', flex, -0.035, -0.62);

  // Speakers & microphones
  const spkMat = own(new THREE.MeshPhysicalMaterial({ color: 0x3d3d3d, metalness: 0.6, roughness: 0.4 }));
  [[0.35, H / 2 - 0.2, 0.6, 0.12], [-W + 0.35, H / 2 - 0.2, 0.6, 0.12], [0.35, -H / 2 + 0.1, 0.6, 0.12], [-0.5, -H / 2 + 0.1, 0.18, 0.1]].forEach(([x, y, w, h]) => {
    add('audio', new THREE.Mesh(slabGeo(x, y, w, h, 0.06, 0.04, 0.01), spkMat), -0.03, -0.42);
  });

  // Hinge
  const hingeMat = own(mats.frameLight);
  const spine = new THREE.Mesh(new THREE.CylinderGeometry(0.07, 0.07, H * 0.94, 32), hingeMat);
  add('hinge', spine, -0.035, -0.28);
  [-1.05, 0, 1.05].forEach((y) => {
    const m = new THREE.Mesh(slabGeo(-0.22, y - 0.17, 0.44, 0.34, 0.06, 0.04, 0.01), hingeMat);
    m.position.z = 0.03;
    add('hinge', m, -0.035, -0.28);
  });

  // Mid-frame
  const midMat = own(mats.frame);
  add('frame', new THREE.Mesh(slabGeo(-W, -H / 2, 2 * W, H, 0.012, R, 0.004), midMat), -0.008, -0.05);

  // Flexible display
  const dispPanel = own(mats.bezel);
  const innerTex = foldInnerTexture((2 * W - 0.1) / (H - 0.1), renderer);
  const dispMat = new THREE.MeshBasicMaterial({ map: innerTex, toneMapped: false, transparent: true });
  dispMat.userData.base = 1;
  add('display', new THREE.Mesh(slabGeo(-W, -H / 2, 2 * W, H, 0.008, R, 0.003), dispPanel), 0, 0.42);
  const scr = new THREE.Mesh(planeGeo(-W + 0.05, -H / 2 + 0.05, 2 * W - 0.1, H - 0.1, R - 0.05), dispMat);
  scr.position.z = 0.001;
  add('display', scr, 0, 0.42);

  // Protective glass / film
  const filmMat = new THREE.MeshPhysicalMaterial({
    color: 0xffffff, metalness: 0, roughness: 0.08, transparent: true, opacity: 0.16,
    iridescence: 1, iridescenceIOR: 1.35, clearcoat: 1, side: THREE.DoubleSide, depthWrite: false,
    emissive: 0x000000,
  });
  filmMat.userData.base = 0.16;
  add('glass', new THREE.Mesh(planeGeo(-W + 0.02, -H / 2 + 0.02, 2 * W - 0.04, H - 0.04, R - 0.02), filmMat), 0.004, 0.85);

  // Collect materials per layer for highlight / dim
  Object.values(layers).forEach((l) => {
    const set = new Set();
    l.group.traverse((o) => {
      if (o.isMesh) (Array.isArray(o.material) ? o.material : [o.material]).forEach((m) => set.add(m));
    });
    l.mats = [...set];
  });

  let active = null;
  let pulse = 0;
  return {
    root,
    layers,
    setActive(key) { active = key; },
    update(explode, dt, time) {
      pulse = 0.5 + 0.5 * Math.sin(time * 4);
      for (const [key, l] of Object.entries(layers)) {
        l.group.position.z = THREE.MathUtils.lerp(l.z0, l.z1, explode);
        const isOn = active === key;
        const dim = active && !isOn;
        const k = 1 - Math.exp(-dt * 10);
        for (const m of l.mats) {
          const base = m.userData.base ?? 1;
          const target = dim ? base * 0.14 : (isOn && key === 'glass' ? 0.55 : base);
          m.opacity += (target - m.opacity) * k;
          m.depthWrite = m.opacity > 0.95;
          if (m.emissive) {
            const e = isOn ? 0.25 + 0.35 * pulse : 0;
            m.emissive.copy(PEACH).multiplyScalar(e);
          }
        }
      }
    },
  };
}

export { planeGeo, slabGeo };
