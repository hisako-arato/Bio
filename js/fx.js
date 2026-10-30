// 演出：血しぶき・地面の血だまり・銃口の光・土埃・木片・レーザーサイト
import { THREE, scene, canvasTex, flashLight, camera } from './engine.js';
import { settings } from './input.js';

// ---- 粒（血・土埃・木片）：まとめて1回で描く ----
const N = 420;
const pos = new Float32Array(N * 3), col = new Float32Array(N * 3);
const vel = new Float32Array(N * 3), life = new Float32Array(N), kind = new Uint8Array(N);
const geo = new THREE.BufferGeometry();
geo.setAttribute('position', new THREE.BufferAttribute(pos, 3));
geo.setAttribute('color', new THREE.BufferAttribute(col, 3));
const dotTex = canvasTex(32, 32, (g) => {
  const r = g.createRadialGradient(16, 16, 1, 16, 16, 15);
  r.addColorStop(0, 'rgba(255,255,255,1)'); r.addColorStop(0.6, 'rgba(255,255,255,.8)'); r.addColorStop(1, 'rgba(255,255,255,0)');
  g.fillStyle = r; g.fillRect(0, 0, 32, 32);
}, false);
const points = new THREE.Points(geo, new THREE.PointsMaterial({ size: 0.07, map: dotTex, vertexColors: true, transparent: true, depthWrite: false, alphaTest: 0.05 }));
points.frustumCulled = false;
scene.add(points);
let next = 0;
for (let i = 0; i < N; i++) pos[i * 3 + 1] = -100;
function emit(x, y, z, vx, vy, vz, r, g, b, t, k) {
  const i = next; next = (next + 1) % N;
  pos[i * 3] = x; pos[i * 3 + 1] = y; pos[i * 3 + 2] = z;
  vel[i * 3] = vx; vel[i * 3 + 1] = vy; vel[i * 3 + 2] = vz;
  col[i * 3] = r; col[i * 3 + 1] = g; col[i * 3 + 2] = b;
  life[i] = t; kind[i] = k;
}
// 血しぶき。dir：弾の進む向き（血は主に後ろへ抜ける）
export function blood(p, dir, amount = 1) {
  if (settings.blood === 'off') { dust(p, 4); return; }
  const n = Math.round((settings.blood === 'low' ? 6 : 14) * amount);
  for (let i = 0; i < n; i++) {
    const s = 1 + Math.random() * 2.5;
    emit(p.x, p.y, p.z,
      dir.x * s + (Math.random() - 0.5) * 2, dir.y * s + Math.random() * 1.8, dir.z * s + (Math.random() - 0.5) * 2,
      0.35 + Math.random() * 0.2, 0.01, 0.02, 0.6 + Math.random() * 0.5, 1);
  }
  if (Math.random() < 0.7 * amount) splat(p.x + dir.x * 0.6, p.z + dir.z * 0.6, 0.5 + Math.random() * 0.6 * amount);
}
export function dust(p, n = 8, r = 0.55, g = 0.5, b = 0.42) {
  for (let i = 0; i < n; i++) emit(p.x, p.y, p.z, (Math.random() - 0.5) * 2, Math.random() * 1.5, (Math.random() - 0.5) * 2, r, g, b, 0.35 + Math.random() * 0.3, 0);
}
export function splinters(p) {
  for (let i = 0; i < 22; i++) emit(p.x, p.y, p.z, (Math.random() - 0.5) * 4, Math.random() * 4, (Math.random() - 0.5) * 4, 0.42, 0.3, 0.18, 0.7 + Math.random() * 0.5, 2);
  dust(p, 10);
}
export function updateFx(dt) {
  for (let i = 0; i < N; i++) {
    if (life[i] <= 0) continue;
    life[i] -= dt;
    const j = i * 3;
    vel[j + 1] -= (kind[i] === 0 ? 1.5 : 9.8) * dt;
    pos[j] += vel[j] * dt; pos[j + 1] += vel[j + 1] * dt; pos[j + 2] += vel[j + 2] * dt;
    if (pos[j + 1] < 0.02) { pos[j + 1] = 0.02; vel[j] *= 0.3; vel[j + 2] *= 0.3; vel[j + 1] = 0; }
    if (life[i] <= 0) pos[j + 1] = -100;
  }
  geo.attributes.position.needsUpdate = true;
  geo.attributes.color.needsUpdate = true;
  // 血だまりは時間とともに薄れる
  for (const d of decals) if (d.t > 0) {
    d.t -= dt;
    d.m.material.opacity = Math.min(0.85, d.t / 4) * d.o;
    if (d.t <= 0) d.m.visible = false;
  }
  if (flash.t > 0) {
    flash.t -= dt;
    if (flash.t <= 0) { flash.s.visible = false; flashLight.intensity = 0; }
  }
}

// ---- 地面の血だまり ----
const splatTex = canvasTex(128, 128, (g) => {
  g.fillStyle = 'rgba(70,4,6,1)';
  for (let i = 0; i < 9; i++) { g.beginPath(); g.arc(64 + (Math.random() - 0.5) * 50, 64 + (Math.random() - 0.5) * 50, 8 + Math.random() * 22, 0, 7); g.fill(); }
  for (let i = 0; i < 30; i++) { g.beginPath(); g.arc(Math.random() * 128, Math.random() * 128, 1 + Math.random() * 4, 0, 7); g.fill(); }
}, false);
const decals = [];
const decalGeo = new THREE.PlaneGeometry(1, 1).rotateX(-Math.PI / 2);
for (let i = 0; i < 36; i++) {
  const m = new THREE.Mesh(decalGeo, new THREE.MeshLambertMaterial({ map: splatTex, transparent: true, depthWrite: false, polygonOffset: true, polygonOffsetFactor: -2 }));
  m.visible = false; m.renderOrder = 2; scene.add(m);
  decals.push({ m, t: 0, o: 1 });
}
let nextDecal = 0;
export function splat(x, z, size = 1) {
  if (settings.blood === 'off') return;
  const d = decals[nextDecal]; nextDecal = (nextDecal + 1) % decals.length;
  d.m.position.set(x, 0.03 + nextDecal * 0.0005, z); d.m.rotation.y = Math.random() * 6; d.m.scale.setScalar(size);
  d.m.visible = true; d.t = 40; d.o = 0.7 + Math.random() * 0.3;
}
export function clearDecals() { for (const d of decals) { d.t = 0; d.m.visible = false; } }

// ---- 銃口の光 ----
const flashTex = canvasTex(64, 64, (g) => {
  const r = g.createRadialGradient(32, 32, 1, 32, 32, 30);
  r.addColorStop(0, 'rgba(255,250,220,1)'); r.addColorStop(0.3, 'rgba(255,190,90,.9)'); r.addColorStop(1, 'rgba(255,120,20,0)');
  g.fillStyle = r; g.fillRect(0, 0, 64, 64);
  g.strokeStyle = 'rgba(255,230,160,.9)'; g.lineWidth = 3;
  for (let i = 0; i < 6; i++) { const a = i / 6 * Math.PI * 2; g.beginPath(); g.moveTo(32, 32); g.lineTo(32 + Math.cos(a) * 30, 32 + Math.sin(a) * 30); g.stroke(); }
}, false);
const flash = { s: new THREE.Sprite(new THREE.SpriteMaterial({ map: flashTex, blending: THREE.AdditiveBlending, depthWrite: false, fog: false })), t: 0 };
flash.s.visible = false; scene.add(flash.s);
export function muzzleFlash(p, big = false) {
  flash.s.position.copy(p); flash.s.scale.setScalar(big ? 0.7 : 0.4); flash.s.material.rotation = Math.random() * 6;
  flash.s.visible = true; flash.t = 0.05;
  flashLight.position.copy(p); flashLight.intensity = big ? 40 : 22;
}

// ---- レーザーサイト（銃口から当たる所まで、赤い細い線と点） ----
const laserMat = new THREE.MeshBasicMaterial({ color: '#ff2a1a', transparent: true, opacity: 0.55, blending: THREE.AdditiveBlending, depthWrite: false, fog: false });
const laser = new THREE.Mesh(new THREE.CylinderGeometry(0.004, 0.004, 1, 4, 1, true).translate(0, 0.5, 0).rotateX(Math.PI / 2), laserMat);
laser.frustumCulled = false; laser.visible = false; scene.add(laser);
const dot = new THREE.Sprite(new THREE.SpriteMaterial({ map: dotTex, color: '#ff3020', blending: THREE.AdditiveBlending, depthWrite: false, depthTest: false, fog: false }));
dot.visible = false; dot.renderOrder = 5; scene.add(dot);
export function showLaser(from, to) {
  laser.visible = dot.visible = true;
  laser.position.copy(from); laser.lookAt(to);
  laser.scale.set(1, 1, from.distanceTo(to));
  dot.position.copy(to);
  dot.scale.setScalar(0.035 + camera.position.distanceTo(to) * 0.006);
}
export function hideLaser() { laser.visible = dot.visible = false; }
