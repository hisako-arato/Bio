// 村の地図：地面・家・柵・木・広場・教会。当たり判定（箱と円柱）と、ゾンビの道案内の網目もここで作る
// 座標：x が東、z が南（プレイヤーは南の小道から北へ進む）。1 = 1m
import { THREE, scene, M, TEX, tiled, mat, rand, fireLight } from './engine.js';
import { mergeGeometries } from '../vendor/BufferGeometryUtils.js';

// 当たり判定
// boxes：{ x1, z1, x2, z2, h, id }（地面から高さ h までの箱）
// circles：{ x, z, r, h, id }（円柱）
export const boxes = [];
export const circles = [];
const removed = new Set();   // 開いた門・壊れた木箱
export const isGone = id => id && removed.has(id);
export function removeCollider(id) { removed.add(id); rebuildNav(); }
export function restoreCollider(id) { removed.delete(id); rebuildNav(); }

// ---- 動かない物はまとめて描く（材質ごとに1つの形に結合し、描く回数を減らす） ----
const batches = new Map();   // material → [geometry]
function addStatic(geo, material, matrix) {
  const g = geo.index ? geo.toNonIndexed() : geo.clone();
  g.applyMatrix4(matrix);
  for (const k of Object.keys(g.attributes)) if (!['position', 'normal', 'uv'].includes(k)) g.deleteAttribute(k);
  if (!batches.has(material)) batches.set(material, []);
  batches.get(material).push(g);
}
function flushStatic() {
  for (const [material, list] of batches) {
    const merged = mergeGeometries(list, false);
    const m = new THREE.Mesh(merged, material);
    m.castShadow = true; m.receiveShadow = true;
    m.matrixAutoUpdate = false;
    scene.add(m);
    list.forEach(g => g.dispose());
  }
  batches.clear();
}
const tmpM = new THREE.Matrix4(), tmpQ = new THREE.Quaternion(), tmpE = new THREE.Euler(), ONE = new THREE.Vector3(1, 1, 1);
function place(geo, material, x, y, z, ry = 0, rx = 0, rz = 0) {
  tmpE.set(rx, ry, rz); tmpQ.setFromEuler(tmpE);
  tmpM.compose(new THREE.Vector3(x, y, z), tmpQ, ONE);
  addStatic(geo, material, tmpM);
}
// 面ごとの画像の繰り返しを、箱の大きさに合わせる（tile：画像1枚が何 m か。0 なら面に1枚）
function boxGeo(w, h, d, tile = 0) {
  const g = new THREE.BoxGeometry(w, h, d);
  if (tile) {
    const uv = g.attributes.uv;
    // 面の順：+x, -x, +y, -y, +z, -z（各4頂点）
    const size = [[d, h], [d, h], [w, d], [w, d], [w, h], [w, h]];
    for (let f = 0; f < 6; f++) for (let k = 0; k < 4; k++) {
      const i = f * 4 + k;
      uv.setXY(i, uv.getX(i) * size[f][0] / tile, uv.getY(i) * size[f][1] / tile);
    }
  }
  return g;
}
// 箱を置く（y は底面の高さ）。solid：当たり判定を付ける
function box(w, h, d, material, x, y, z, { tile = 0, solid = true, ry = 0, id } = {}) {
  place(boxGeo(w, h, d, tile), material, x, y + h / 2, z, ry);
  if (solid) {
    const sw = Math.abs(ry % Math.PI) > 0.7 && Math.abs(ry % Math.PI) < 2.4 ? d : w;
    const sd = sw === w ? d : w;
    boxes.push({ x1: x - sw / 2, x2: x + sw / 2, z1: z - sd / 2, z2: z + sd / 2, h: y + h, id });
  }
}
function cylinder(r1, r2, h, material, x, y, z, seg = 8, solid = true) {
  place(new THREE.CylinderGeometry(r1, r2, h, seg), material, x, y + h / 2, z);
  if (solid) circles.push({ x, z, r: Math.max(r1, r2), h: y + h });
}
// 切妻屋根（棟が x 方向）。w：x の長さ、d：z の奥行き、rh：屋根の高さ
function roofGeo(w, d, rh) {
  const hw = w / 2, hd = d / 2;
  const p = [
    // 南の斜面
    -hw, 0, hd, hw, 0, hd, hw, rh, 0, -hw, 0, hd, hw, rh, 0, -hw, rh, 0,
    // 北の斜面
    hw, 0, -hd, -hw, 0, -hd, -hw, rh, 0, hw, 0, -hd, -hw, rh, 0, hw, rh, 0,
    // 妻（東西の三角）
    hw, 0, hd, hw, 0, -hd, hw, rh, 0, -hw, 0, -hd, -hw, 0, hd, -hw, rh, 0,
  ];
  const slope = Math.hypot(hd, rh);
  const uv = [
    0, 0, w / 3, 0, w / 3, slope / 3, 0, 0, w / 3, slope / 3, 0, slope / 3,
    0, 0, w / 3, 0, w / 3, slope / 3, 0, 0, w / 3, slope / 3, 0, slope / 3,
    0, 0, d / 3, 0, d / 6, rh / 3, 0, 0, d / 3, 0, d / 6, rh / 3,
  ];
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.Float32BufferAttribute(p, 3));
  g.setAttribute('uv', new THREE.Float32BufferAttribute(uv, 2));
  g.computeVertexNormals();
  return g;
}

// 家：壁・屋根・扉・窓。ridgeZ：棟を z 方向にする。door：扉の向き（'n' 'e' 's' 'w'）
function house(x1, z1, x2, z2, { h = 3.4, ridgeZ = false, door = 's', lit = false, rh = 2.2 } = {}) {
  const w = x2 - x1, d = z2 - z1, cx = (x1 + x2) / 2, cz = (z1 + z2) / 2;
  box(w, h, d, M.plaster, cx, 0, cz, { solid: false });
  // 石の土台
  box(w + 0.2, 0.5, d + 0.2, M.stone, cx, 0, cz, { tile: 2, solid: false });
  const g = ridgeZ ? roofGeo(d + 0.8, w + 0.8, rh) : roofGeo(w + 0.8, d + 0.8, rh);
  place(g, M.roof, cx, h, cz, ridgeZ ? Math.PI / 2 : 0);
  boxes.push({ x1, x2, z1, z2, h: h + rh * 0.8 });
  // 扉と窓（壁の少し外に貼る）
  const face = (side, along, y, ww, hh, material) => {
    const t = 0.08;
    if (side === 's') place(new THREE.BoxGeometry(ww, hh, t), material, cx + along, y + hh / 2, z2 + t / 2);
    if (side === 'n') place(new THREE.BoxGeometry(ww, hh, t), material, cx + along, y + hh / 2, z1 - t / 2);
    if (side === 'e') place(new THREE.BoxGeometry(t, hh, ww), material, x2 + t / 2, y + hh / 2, cz + along);
    if (side === 'w') place(new THREE.BoxGeometry(t, hh, ww), material, x1 - t / 2, y + hh / 2, cz + along);
  };
  face(door, 0, 0.3, 1.2, 2.1, M.darkWood);
  const span = door === 'n' || door === 's' ? w : d;
  for (const side of ['n', 's', 'e', 'w']) {
    const len = side === 'n' || side === 's' ? w : d;
    for (const k of [-0.3, 0.3]) {
      if (side === door && Math.abs(k * len) < 1.2) continue;
      face(side, k * len, 1.5, 0.8, 0.9, lit && rand() < 0.5 ? M.windowLit : M.window);
    }
  }
  return { cx, cz, w, d, span };
}

// 柵（x1,z1 から x2,z2 へ、まっすぐ）
function fence(x1, z1, x2, z2, { h = 1.2, id } = {}) {
  const len = Math.hypot(x2 - x1, z2 - z1), ang = Math.atan2(x2 - x1, z2 - z1);
  const n = Math.max(1, Math.round(len / 1.6));
  for (let i = 0; i <= n; i++) {
    const t = i / n;
    place(new THREE.BoxGeometry(0.16, h + 0.15, 0.16), M.darkWood, x1 + (x2 - x1) * t, (h + 0.15) / 2, z1 + (z2 - z1) * t);
  }
  for (const y of [h * 0.35, h * 0.85]) place(new THREE.BoxGeometry(0.08, 0.14, len), M.wood, (x1 + x2) / 2, y, (z1 + z2) / 2, ang);
  boxes.push({ x1: Math.min(x1, x2) - 0.15, x2: Math.max(x1, x2) + 0.15, z1: Math.min(z1, z2) - 0.15, z2: Math.max(z1, z2) + 0.15, h, id });
}

// 石垣
function wall(x1, z1, x2, z2, h = 1.6) {
  const w = Math.abs(x2 - x1) || 0.7, d = Math.abs(z2 - z1) || 0.7;
  box(w, h, d, M.stone, (x1 + x2) / 2, 0, (z1 + z2) / 2, { tile: 2 });
}

// ---- 木（同じ形をまとめて描く） ----
const trees = [];
function tree(x, z, s = 1, solid = true) { trees.push({ x, z, s: s * (0.8 + rand() * 0.5), ry: rand() * 6 }); if (solid) circles.push({ x, z, r: 0.35 * s, h: 8 }); }
function treeLine(x1, z1, x2, z2, step = 2.6, jitter = 1.2) {
  const len = Math.hypot(x2 - x1, z2 - z1), n = Math.ceil(len / step);
  for (let i = 0; i <= n; i++) {
    const t = i / n;
    tree(x1 + (x2 - x1) * t + (rand() - 0.5) * jitter, z1 + (z2 - z1) * t + (rand() - 0.5) * jitter, 1, false);
  }
}
function flushTrees() {
  const trunk = new THREE.CylinderGeometry(0.18, 0.3, 4, 6).translate(0, 2, 0);
  const crown1 = new THREE.ConeGeometry(2.2, 4.5, 7).translate(0, 4.6, 0);
  const crown2 = new THREE.ConeGeometry(1.6, 3.6, 7).translate(0, 6.6, 0);
  const crown = mergeGeometries([crown1, crown2], false);
  const t = new THREE.InstancedMesh(trunk, M.bark, trees.length);
  const c = new THREE.InstancedMesh(crown, M.leaves, trees.length);
  const m4 = new THREE.Matrix4();
  trees.forEach((tr, i) => {
    tmpE.set(0, tr.ry, 0); tmpQ.setFromEuler(tmpE);
    m4.compose(new THREE.Vector3(tr.x, 0, tr.z), tmpQ, new THREE.Vector3(tr.s, tr.s * (0.9 + rand() * 0.3), tr.s));
    t.setMatrixAt(i, m4); c.setMatrixAt(i, m4);
  });
  for (const m of [t, c]) { m.castShadow = true; m.receiveShadow = true; scene.add(m); }
}

// 地面の模様（土の道・草地）
function ground() {
  const g = new THREE.PlaneGeometry(260, 260).rotateX(-Math.PI / 2);
  const m = new THREE.Mesh(g, mat('#ffffff', { map: tiled(TEX.grass, 70, 70) }));
  m.receiveShadow = true; scene.add(m);
  const patch = (x1, z1, x2, z2, material, y = 0.015) => {
    const w = x2 - x1, d = z2 - z1;
    const p = new THREE.Mesh(new THREE.PlaneGeometry(w, d).rotateX(-Math.PI / 2), material);
    p.position.set((x1 + x2) / 2, y, (z1 + z2) / 2); p.receiveShadow = true; scene.add(p);
  };
  patch(-5, 22, 5, 82, mat('#ffffff', { map: tiled(TEX.dirt, 2.5, 15) }));
  patch(-22, -22, 22, 24, mat('#ffffff', { map: tiled(TEX.dirt, 11, 11.5) }), 0.02);
  patch(-5, -42, 9, -21, mat('#ffffff', { map: tiled(TEX.dirt, 3.5, 5) }), 0.016);
  patch(-18, -76, 18, -40, mat('#b8b0a8', { map: tiled(TEX.dirt, 9, 9) }), 0.017);
  patch(-1.6, -76, 1.6, -40, mat('#ffffff', { map: tiled(TEX.stone, 1, 12) }), 0.022);
}

// ---- 小物 ----
function cart(x, z, ry = 0) {
  place(new THREE.BoxGeometry(1.6, 0.15, 2.6), M.wood, x, 0.75, z, ry);
  place(new THREE.BoxGeometry(1.6, 0.5, 0.08), M.wood, x, 1.05, z, ry, 0, 0);
  for (const s of [-1, 1]) place(new THREE.CylinderGeometry(0.55, 0.55, 0.12, 12), M.darkWood, x + Math.cos(ry) * 0.85 * s, 0.55, z - Math.sin(ry) * 0.85 * s, ry, 0, Math.PI / 2);
  boxes.push({ x1: x - 1.1, x2: x + 1.1, z1: z - 1.4, z2: z + 1.4, h: 1.3 });
}
function hay(x, z) {
  place(new THREE.CylinderGeometry(0.7, 0.7, 1.1, 12), M.hay, x, 0.7, z, rand() * 3, Math.PI / 2, 0);
  circles.push({ x, z, r: 0.75, h: 1.4 });
}
function well(x, z) {
  cylinder(1.0, 1.05, 0.9, M.stone, x, 0, z, 12);
  for (const s of [-1, 1]) place(new THREE.BoxGeometry(0.12, 2.0, 0.12), M.darkWood, x + s * 0.85, 1.0, z);
  place(new THREE.BoxGeometry(2.0, 0.1, 0.12), M.darkWood, x, 2.0, z);
  place(roofGeo(2.2, 1.6, 0.6), M.roof, x, 2.0, z);
}
function grave(x, z) {
  const s = 0.8 + rand() * 0.4;
  place(new THREE.BoxGeometry(0.6 * s, 0.9 * s, 0.18), M.stone, x, 0.45 * s, z, (rand() - 0.5) * 0.3, (rand() - 0.5) * 0.15);
  circles.push({ x, z, r: 0.35, h: 0.9 });
}
function cross(x, y, z, s = 1) {
  place(new THREE.BoxGeometry(0.12 * s, 1.2 * s, 0.12 * s), M.iron, x, y + 0.6 * s, z);
  place(new THREE.BoxGeometry(0.7 * s, 0.12 * s, 0.12 * s), M.iron, x, y + 0.85 * s, z);
}

// 壊せる物（木箱・樽）。撃つかナイフで壊すと中身が出る
export const breakables = [];
function crate(x, z, drop) {
  const g = new THREE.Mesh(new THREE.BoxGeometry(0.8, 0.8, 0.8), mat('#ffffff', { map: TEX.planks }));
  g.position.set(x, 0.4, z); g.rotation.y = rand(); g.castShadow = true; g.receiveShadow = true; scene.add(g);
  const id = 'crate' + breakables.length;
  boxes.push({ x1: x - 0.45, x2: x + 0.45, z1: z - 0.45, z2: z + 0.45, h: 0.8, id });
  breakables.push({ id, mesh: g, x, z, y: 0.4, r: 0.5, hp: 1, drop });
}
function barrel(x, z, drop) {
  const g = new THREE.Mesh(new THREE.CylinderGeometry(0.4, 0.4, 1.0, 10), mat('#5a3e26', { map: TEX.planks }));
  g.position.set(x, 0.5, z); g.castShadow = true; g.receiveShadow = true; scene.add(g);
  const id = 'barrel' + breakables.length;
  circles.push({ x, z, r: 0.42, h: 1.0, id });
  breakables.push({ id, mesh: g, x, z, y: 0.5, r: 0.5, hp: 1, drop });
}
export function resetBreakables() {
  for (const b of breakables) { b.hp = 1; b.mesh.visible = true; removed.delete(b.id); }
  rebuildNav();
}

// 門（閉まっている間は通れない）
export const gates = {};
function gate(name, x1, x2, z, open = false) {
  const g = new THREE.Group();
  const w = x2 - x1;
  for (let i = 0; i <= Math.round(w / 0.5); i++) {
    const p = new THREE.Mesh(new THREE.BoxGeometry(0.2, 2.2, 0.14), M.darkWood);
    p.position.set(x1 + i * 0.5, 1.1, z); p.castShadow = true; g.add(p);
  }
  for (const y of [0.5, 1.7]) { const b = new THREE.Mesh(new THREE.BoxGeometry(w, 0.18, 0.1), M.wood); b.position.set((x1 + x2) / 2, y, z + 0.1); g.add(b); }
  scene.add(g);
  const id = 'gate-' + name;
  boxes.push({ x1, x2, z1: z - 0.3, z2: z + 0.3, h: 2.2, id });
  gates[name] = { g, id, set(o) { g.visible = !o; o ? removeCollider(id) : restoreCollider(id); } };
  if (open) { g.visible = false; removed.add(id); }
}

// ---- 焚き火（揺れる光） ----
export const bonfire = { x: 0, z: 2, embers: null };
const flameTex = (() => {
  const c = document.createElement('canvas'); c.width = 64; c.height = 128;
  const g = c.getContext('2d');
  const r = g.createRadialGradient(32, 96, 2, 32, 80, 60);
  r.addColorStop(0, 'rgba(255,240,200,1)'); r.addColorStop(0.35, 'rgba(255,150,50,.85)'); r.addColorStop(1, 'rgba(255,60,0,0)');
  g.fillStyle = r;
  g.beginPath(); g.moveTo(32, 2); g.bezierCurveTo(52, 50, 62, 80, 56, 108); g.quadraticCurveTo(32, 128, 8, 108); g.bezierCurveTo(2, 80, 12, 50, 32, 2); g.fill();
  const t = new THREE.CanvasTexture(c); t.colorSpace = THREE.SRGBColorSpace; return t;
})();
function makeBonfire() {
  const { x, z } = bonfire;
  for (let i = 0; i < 7; i++) {
    const a = i / 7 * Math.PI * 2;
    place(new THREE.CylinderGeometry(0.09, 0.12, 1.5, 5), M.darkWood, x + Math.cos(a) * 0.3, 0.5, z + Math.sin(a) * 0.3, a, 0.9, 0);
  }
  for (let i = 0; i < 10; i++) { const a = i / 10 * Math.PI * 2; place(new THREE.DodecahedronGeometry(0.22), M.stone, x + Math.cos(a) * 0.9, 0.1, z + Math.sin(a) * 0.9); }
  circles.push({ x, z, r: 1.1, h: 1.2 });
  // 炎（板状の絵を何枚か重ね、毎フレーム揺らす）
  const fire = new THREE.Group();
  for (let i = 0; i < 5; i++) {
    const f = new THREE.Sprite(new THREE.SpriteMaterial({ map: flameTex, color: i < 2 ? '#ff7a30' : '#ffc070', transparent: true, depthWrite: false, blending: THREE.AdditiveBlending, fog: false }));
    f.position.set((i - 2) * 0.12, 0.75 + (i % 2) * 0.15, (i % 3 - 1) * 0.1);
    f.userData.base = 1.2 + (i % 3) * 0.25;
    fire.add(f);
  }
  fire.position.set(x, 0, z); scene.add(fire);
  bonfire.fire = fire;
  fireLight.position.set(x, 1.8, z);
}
export function updateWorld(t) {
  if (!bonfire.fire) return;
  bonfire.fire.children.forEach((f, i) => {
    const s = 1 + Math.sin(t * (9 + i * 3) + i) * 0.14 + Math.sin(t * 23 + i * 2) * 0.07, b = f.userData.base;
    f.scale.set(b * 0.75 * (2 - s), b * 1.4 * s, 1);
    f.position.y = 0.55 + b * 0.6 * s;
    f.material.rotation = Math.sin(t * 3 + i) * 0.08;
  });
  fireLight.intensity = 26 + Math.sin(t * 13) * 4 + Math.sin(t * 31) * 3;
}

// ---- 道案内の網目（1m 四方）。ゾンビはプレイヤーまでの歩数が小さい方へ進む ----
export const NAV = { x0: -45, z0: -100, w: 90, h: 190 };
let blocked = new Uint8Array(NAV.w * NAV.h);
const dist = new Int32Array(NAV.w * NAV.h);
export function rebuildNav() {
  blocked = new Uint8Array(NAV.w * NAV.h);
  const pad = 0.4;
  for (const b of boxes) {
    if (isGone(b.id)) continue;
    const x1 = Math.floor(b.x1 - pad - NAV.x0), x2 = Math.ceil(b.x2 + pad - NAV.x0), z1 = Math.floor(b.z1 - pad - NAV.z0), z2 = Math.ceil(b.z2 + pad - NAV.z0);
    for (let z = Math.max(0, z1); z < Math.min(NAV.h, z2); z++) for (let x = Math.max(0, x1); x < Math.min(NAV.w, x2); x++) {
      const cx = x + 0.5 + NAV.x0, cz = z + 0.5 + NAV.z0;
      if (cx > b.x1 - pad && cx < b.x2 + pad && cz > b.z1 - pad && cz < b.z2 + pad) blocked[z * NAV.w + x] = 1;
    }
  }
  for (const c of circles) {
    if (isGone(c.id)) continue;
    const r = c.r + pad;
    for (let z = Math.floor(c.z - r - NAV.z0); z <= Math.ceil(c.z + r - NAV.z0); z++) for (let x = Math.floor(c.x - r - NAV.x0); x <= Math.ceil(c.x + r - NAV.x0); x++) {
      if (x < 0 || z < 0 || x >= NAV.w || z >= NAV.h) continue;
      if (Math.hypot(x + 0.5 + NAV.x0 - c.x, z + 0.5 + NAV.z0 - c.z) < r) blocked[z * NAV.w + x] = 1;
    }
  }
}
const queue = new Int32Array(NAV.w * NAV.h);
// プレイヤーの位置から、全マスへの歩数を数え直す（数回／秒）
export function updateFlow(px, pz) {
  dist.fill(-1);
  let sx = Math.floor(px - NAV.x0), sz = Math.floor(pz - NAV.z0);
  if (sx < 0 || sz < 0 || sx >= NAV.w || sz >= NAV.h) return;
  let head = 0, tail = 0;
  const s = sz * NAV.w + sx;
  dist[s] = 0; queue[tail++] = s;
  while (head < tail) {
    const i = queue[head++], x = i % NAV.w, z = (i / NAV.w) | 0, d = dist[i] + 1;
    if (x > 0 && dist[i - 1] < 0 && !blocked[i - 1]) { dist[i - 1] = d; queue[tail++] = i - 1; }
    if (x < NAV.w - 1 && dist[i + 1] < 0 && !blocked[i + 1]) { dist[i + 1] = d; queue[tail++] = i + 1; }
    if (z > 0 && dist[i - NAV.w] < 0 && !blocked[i - NAV.w]) { dist[i - NAV.w] = d; queue[tail++] = i - NAV.w; }
    if (z < NAV.h - 1 && dist[i + NAV.w] < 0 && !blocked[i + NAV.w]) { dist[i + NAV.w] = d; queue[tail++] = i + NAV.w; }
  }
}
// x,z にいる者が進むべき向き（単位ベクトル）。道が無ければ null
export function flowDir(x, z, out) {
  const cx = Math.floor(x - NAV.x0), cz = Math.floor(z - NAV.z0);
  if (cx < 1 || cz < 1 || cx >= NAV.w - 1 || cz >= NAV.h - 1) return null;
  const here = dist[cz * NAV.w + cx];
  let best = here < 0 ? 1e9 : here, bx = 0, bz = 0;
  for (let dz = -1; dz <= 1; dz++) for (let dx = -1; dx <= 1; dx++) {
    if (!dx && !dz) continue;
    const i = (cz + dz) * NAV.w + cx + dx, d = dist[i];
    if (d < 0) continue;
    // 斜めは、角を削って通れるときだけ
    if (dx && dz && (blocked[cz * NAV.w + cx + dx] || blocked[(cz + dz) * NAV.w + cx])) continue;
    if (d < best) { best = d; bx = dx; bz = dz; }
  }
  if (!bx && !bz) return null;
  // マスの中心へ向かう
  const tx = cx + bx + 0.5 + NAV.x0, tz = cz + bz + 0.5 + NAV.z0;
  const l = Math.hypot(tx - x, tz - z) || 1;
  out.x = (tx - x) / l; out.z = (tz - z) / l;
  return out;
}
export const navDist = (x, z) => {
  const cx = Math.floor(x - NAV.x0), cz = Math.floor(z - NAV.z0);
  if (cx < 0 || cz < 0 || cx >= NAV.w || cz >= NAV.h) return -1;
  return dist[cz * NAV.w + cx];
};

// ---- 当たり判定 ----
// 円（x,z,r）を壁から押し出す。戻り値は押し出した後の位置（out に書く）
export function collide(out, r) {
  for (let pass = 0; pass < 2; pass++) {
    for (const b of boxes) {
      if (isGone(b.id)) continue;
      const nx = Math.max(b.x1, Math.min(out.x, b.x2)), nz = Math.max(b.z1, Math.min(out.z, b.z2));
      const dx = out.x - nx, dz = out.z - nz, d2 = dx * dx + dz * dz;
      if (d2 >= r * r) continue;
      if (d2 > 1e-8) { const d = Math.sqrt(d2), k = (r - d) / d; out.x += dx * k; out.z += dz * k; }
      else {
        // 箱の中に入り込んだ：一番近い辺へ出す
        const l = out.x - b.x1, rr = b.x2 - out.x, t = out.z - b.z1, bb = b.z2 - out.z, m = Math.min(l, rr, t, bb);
        if (m === l) out.x = b.x1 - r; else if (m === rr) out.x = b.x2 + r; else if (m === t) out.z = b.z1 - r; else out.z = b.z2 + r;
      }
    }
    for (const c of circles) {
      if (isGone(c.id)) continue;
      const dx = out.x - c.x, dz = out.z - c.z, d = Math.hypot(dx, dz), m = r + c.r;
      if (d < m && d > 1e-6) { out.x = c.x + dx / d * m; out.z = c.z + dz / d * m; }
    }
  }
  return out;
}

// 光線（o から単位ベクトル d へ、最大 maxT）が最初に当たる壁までの距離。地面も含む
export function rayWorld(o, d, maxT) {
  let best = maxT;
  if (d.y < -1e-6) { const t = -o.y / d.y; if (t > 0 && t < best) best = t; }
  for (const b of boxes) {
    if (isGone(b.id)) continue;
    let t0 = 0, t1 = best;
    const sl = (o1, d1, lo, hi) => {
      if (Math.abs(d1) < 1e-9) return o1 >= lo && o1 <= hi;
      let a = (lo - o1) / d1, c = (hi - o1) / d1;
      if (a > c) [a, c] = [c, a];
      t0 = Math.max(t0, a); t1 = Math.min(t1, c);
      return t0 <= t1;
    };
    if (sl(o.x, d.x, b.x1, b.x2) && sl(o.y, d.y, 0, b.h) && sl(o.z, d.z, b.z1, b.z2) && t0 < best) best = t0;
  }
  for (const c of circles) {
    if (isGone(c.id)) continue;
    // 円柱（横から）
    const ox = o.x - c.x, oz = o.z - c.z, a = d.x * d.x + d.z * d.z;
    if (a < 1e-9) continue;
    const b2 = ox * d.x + oz * d.z, cc = ox * ox + oz * oz - c.r * c.r, disc = b2 * b2 - a * cc;
    if (disc < 0) continue;
    const t = (-b2 - Math.sqrt(disc)) / a;
    if (t > 0 && t < best && o.y + d.y * t < c.h) best = t;
  }
  return best;
}
// 2点の間に壁があるか（ゾンビがプレイヤーを見られるか）
const _o = new THREE.Vector3(), _d = new THREE.Vector3();
export function lineOfSight(a, b) {
  _o.set(a.x, 1.4, a.z); _d.set(b.x - a.x, 0, b.z - a.z);
  const len = _d.length(); if (len < 0.01) return true;
  _d.divideScalar(len);
  return rayWorld(_o, _d, len) >= len - 0.05;
}

// ---- 地図を作る ----
export const spots = {};
export function buildWorld() {
  ground();

  // ■ 村はずれの小道（南）：プレイヤーは z=74 から北へ
  treeLine(-12, 84, 12, 84, 2.2);
  treeLine(-13, 82, -13, 26, 2.4); treeLine(-17, 82, -17, 26, 3); treeLine(-21, 80, -21, 30, 3.2);
  treeLine(13, 82, 13, 26, 2.4); treeLine(17, 82, 17, 26, 3); treeLine(21, 80, 21, 30, 3.2);
  boxes.push({ x1: -14, x2: 14, z1: 82, z2: 86, h: 8 });
  boxes.push({ x1: -14, x2: -12, z1: 24, z2: 86, h: 8 });
  boxes.push({ x1: 12, x2: 14, z1: 24, z2: 86, h: 8 });
  house(-11.5, 44, -5, 52, { ridgeZ: true, door: 'e', lit: true });
  house(5.5, 35, 11.5, 41, { h: 2.8, door: 'w', rh: 1.6 });
  fence(-5, 60, -5, 76); fence(5, 64, 5, 78); fence(5, 52, 11.5, 52);
  fence(-11.5, 58, -5, 58);
  cart(3, 58, 0.3);
  tree(-8, 66); tree(9, 70); tree(-9, 38); tree(8, 30);
  hay(-8, 56); hay(8.5, 47);
  crate(7.5, 60, { kind: 'ammo', n: 8 });
  barrel(-4, 40, { kind: 'gold', n: 120 });
  crate(9.8, 43.5, { kind: 'herb', n: 1 });
  spots.start = { x: 0, z: 74, yaw: 0 };
  spots.herb1 = { x: -3.6, z: 50 };

  // ■ 村の広場（中央）：周りを家が囲む。隙間の路地からゾンビが来る
  house(-22, -14, -15, -4, { ridgeZ: true, door: 'e', lit: true });
  house(-22, 6, -14, 15, { ridgeZ: true, door: 'e' });
  house(15, -16, 22, -6, { ridgeZ: true, door: 'w' });
  house(14, 4, 22, 14, { ridgeZ: true, door: 'w', lit: true });
  house(-17, -23, -6, -16, { door: 's', lit: true });
  house(6, -23, 17, -16, { door: 's' });
  house(-16, 17, -5, 24, { door: 'n' });
  house(5, 17, 16, 24, { door: 'n', lit: true });
  // 路地の行き止まり（ゾンビが出てくる所）
  boxes.push({ x1: -36, x2: -34, z1: -10, z2: 12, h: 6 }); treeLine(-35, -10, -35, 12, 2.2);
  boxes.push({ x1: 34, x2: 36, z1: -12, z2: 10, h: 6 }); treeLine(35, -12, 35, 10, 2.2);
  boxes.push({ x1: -36, x2: -22, z1: -6, z2: -4, h: 6 }); boxes.push({ x1: -36, x2: -22, z1: 6, z2: 8, h: 6 });
  boxes.push({ x1: -36, x2: -22, z1: -12, z2: -10, h: 6 }); boxes.push({ x1: -36, x2: -22, z1: 12, z2: 14, h: 6 });
  boxes.push({ x1: 22, x2: 36, z1: -8, z2: -6, h: 6 }); boxes.push({ x1: 22, x2: 36, z1: 4, z2: 6, h: 6 });
  boxes.push({ x1: 22, x2: 36, z1: -14, z2: -12, h: 6 }); boxes.push({ x1: 22, x2: 36, z1: 10, z2: 12, h: 6 });
  treeLine(-34, -5, -23, -5, 2.5); treeLine(-34, 7, -23, 7, 2.5); treeLine(23, -7, 34, -7, 2.5); treeLine(23, 5, 34, 5, 2.5);
  // 角の隙間は柵でふさぎ、北西と南東の角だけ通れる
  fence(-22, 15, -16, 17);
  boxes.push({ x1: -17, x2: -6, z1: -25, z2: -23, h: 6 });
  fence(17, -16, 22, -16); fence(17, -23, 17, -16);
  boxes.push({ x1: -24, x2: -22, z1: -30, z2: -14, h: 6 }); boxes.push({ x1: -24, x2: -17, z1: -30, z2: -28, h: 6 });
  treeLine(-23, -29, -23, -16, 2.2); treeLine(-22, -29, -17, -29, 2.2);
  boxes.push({ x1: 16, x2: 24, z1: 24, z2: 30, h: 6 }); treeLine(17, 28, 24, 28, 2.2);
  boxes.push({ x1: 22, x2: 26, z1: 14, z2: 30, h: 6 });
  boxes.push({ x1: -26, x2: -16, z1: 24, z2: 28, h: 6 });
  treeLine(-24, 26, -16, 26, 2.2);
  // 南の入口の両脇
  fence(-5, 24, -4, 24); fence(4, 24, 5, 24);
  makeBonfire();
  well(-8, -7);
  cart(10, -4, 1.2);
  hay(-11, 2); hay(-10, 4.2); hay(12, 9);
  // 見張り台
  for (const [dx, dz] of [[-1, -1], [1, -1], [-1, 1], [1, 1]]) cylinder(0.12, 0.12, 4.2, M.darkWood, 9 + dx, 0, 12 + dz, 5);
  place(new THREE.BoxGeometry(2.6, 0.15, 2.6), M.wood, 9, 4.2, 12);
  place(roofGeo(2.8, 2.8, 1.0), M.roof, 9, 5.6, 12);
  // 散弾銃の置かれた作業台（西の家の軒下）
  place(new THREE.BoxGeometry(2.0, 0.1, 0.9), M.wood, -12.2, 0.9, 10);
  for (const [dx, dz] of [[-0.9, -0.35], [0.9, -0.35], [-0.9, 0.35], [0.9, 0.35]]) place(new THREE.BoxGeometry(0.1, 0.9, 0.1), M.darkWood, -12.2 + dx, 0.45, 10 + dz);
  boxes.push({ x1: -13.2, x2: -11.2, z1: 9.5, z2: 10.5, h: 1.0 });
  spots.shotgun = { x: -12.2, y: 1.02, z: 10 };
  crate(-17, 1, { kind: 'ammo', n: 10 }); crate(18.5, -1, { kind: 'gold', n: 200 }); barrel(-4, -14, { kind: 'shells', n: 4 });
  barrel(13, 16, { kind: 'ammo', n: 8 }); crate(-13, -12, { kind: 'herb', n: 1 });
  spots.plaza = { x: 0, z: 18 };
  spots.spawnsPlaza = [{ x: -31, z: 1 }, { x: 31, z: -1 }, { x: -20, z: -25 }, { x: 19, z: 21 }, { x: -28, z: -2 }, { x: 28, z: 2 }];

  // ■ 北の小道（広場から教会へ）と、商人の居場所
  gate('plazaS', -4, 4, 23.2, true);
  gate('plazaN', -6, 6, -23.4);
  wall(-6, -42, -5, -23, 2.2);
  wall(9, -42, 10, -23, 2.2);
  wall(5, -26, 9, -25, 2.2); wall(5, -42, 9, -41, 2.2);
  house(5.5, -39, 9.5, -33, { h: 2.6, door: 'w', rh: 1.4 });
  spots.merchant = { x: 7, z: -30 };
  crate(8, -28, { kind: 'ammo', n: 8 });

  // ■ 教会の前庭（北）
  treeLine(-20, -40, -20, -95, 2.4); treeLine(20, -40, 20, -95, 2.4); treeLine(-20, -96, 20, -96, 2.4);
  boxes.push({ x1: -22, x2: -19, z1: -100, z2: -40, h: 8 }); boxes.push({ x1: 19, x2: 22, z1: -100, z2: -40, h: 8 });
  boxes.push({ x1: -22, x2: 22, z1: -100, z2: -94, h: 8 });
  wall(-19, -43, -6, -42, 1.4); wall(10, -43, 19, -42, 1.4);
  // 教会
  box(16, 9, 18, M.stone, 0, 0, -84, { tile: 3, solid: false });
  place(roofGeo(19, 17, 6), M.roof, 0, 9, -84, Math.PI / 2);
  boxes.push({ x1: -8, x2: 8, z1: -93, z2: -75, h: 14 });
  box(5, 16, 5, M.stone, 0, 0, -77, { tile: 3 });
  place(new THREE.ConeGeometry(4, 6, 4), M.roof, 0, 19, -77, Math.PI / 4);
  cross(0, 22, -77, 2);
  // 扉（終着点）と、色付きの窓
  place(new THREE.BoxGeometry(2.4, 3.6, 0.2), M.darkWood, 0, 1.8, -74.4);
  spots.churchDoor = { x: 0, z: -73 };
  for (const x of [-5.5, 5.5]) place(new THREE.BoxGeometry(1.4, 3, 0.1), M.windowLit, x, 4.5, -74.95);
  place(new THREE.CircleGeometry(1.2, 16), M.windowLit, 0, 12, -74.45);
  for (let i = 0; i < 14; i++) grave(-15 + (i % 7) * 2.2 + rand() * 0.5, -48 - Math.floor(i / 7) * 4.5 - rand());
  for (let i = 0; i < 10; i++) grave(6 + (i % 5) * 2.2 + rand() * 0.5, -56 - Math.floor(i / 5) * 4.5 - rand());
  tree(-12, -66, 1.2); tree(13, -48, 1.1);
  barrel(-14, -70, { kind: 'ammo', n: 10 }); crate(15, -70, { kind: 'herb', n: 1 }); crate(-16, -58, { kind: 'shells', n: 4 });
  spots.boss = { x: 0, z: -66 };
  spots.yard = { x: 0, z: -46 };
  spots.spawnsYard = [{ x: -17, z: -90 }, { x: 17, z: -90 }, { x: -17, z: -76 }, { x: 17, z: -76 }];

  flushStatic();
  flushTrees();
  rebuildNav();
}

// 物陰の判定に使う：主人公の位置がどの区画か
export function areaOf(z) { return z > 24 ? 'path' : z > -23 ? 'plaza' : z > -42 ? 'lane' : 'yard'; }
