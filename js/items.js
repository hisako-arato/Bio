// 落ちている物（弾・散弾・ハーブ・お金・散弾銃）。近づくと自動で拾う
import { THREE, scene, mat, canvasTex } from './engine.js';

const glowTex = canvasTex(64, 64, (g) => {
  const r = g.createRadialGradient(32, 32, 2, 32, 32, 30);
  r.addColorStop(0, 'rgba(255,240,180,.9)'); r.addColorStop(1, 'rgba(255,240,180,0)');
  g.fillStyle = r; g.fillRect(0, 0, 64, 64);
}, false);
const glowMat = new THREE.SpriteMaterial({ map: glowTex, blending: THREE.AdditiveBlending, depthWrite: false, transparent: true, opacity: 0.6 });

const LOOK = {
  ammo: () => { const g = new THREE.Group(); const b = new THREE.Mesh(new THREE.BoxGeometry(0.28, 0.16, 0.2), mat('#5a6a3a')); b.position.y = 0.08; g.add(b); const l = new THREE.Mesh(new THREE.BoxGeometry(0.29, 0.06, 0.12), mat('#d8c060')); l.position.y = 0.1; g.add(l); return g; },
  shells: () => { const g = new THREE.Group(); const b = new THREE.Mesh(new THREE.BoxGeometry(0.28, 0.16, 0.2), mat('#7a2a22')); b.position.y = 0.08; g.add(b); const l = new THREE.Mesh(new THREE.BoxGeometry(0.29, 0.06, 0.12), mat('#e0d0a0')); l.position.y = 0.1; g.add(l); return g; },
  herb: () => {
    const g = new THREE.Group();
    const pot = new THREE.Mesh(new THREE.CylinderGeometry(0.1, 0.08, 0.14, 8), mat('#8a5a3a')); pot.position.y = 0.07; g.add(pot);
    for (let i = 0; i < 5; i++) { const l = new THREE.Mesh(new THREE.ConeGeometry(0.06, 0.22, 4), mat('#3aa040', { emissive: '#0a3a0a' })); l.position.set(Math.cos(i * 1.3) * 0.05, 0.22, Math.sin(i * 1.3) * 0.05); l.rotation.set(Math.cos(i) * 0.4, 0, Math.sin(i) * 0.4); g.add(l); }
    return g;
  },
  gold: () => { const g = new THREE.Group(); for (let i = 0; i < 4; i++) { const c = new THREE.Mesh(new THREE.CylinderGeometry(0.06, 0.06, 0.02, 10), mat('#e0b040', { emissive: '#4a3000' })); c.position.set((i % 2) * 0.07 - 0.03, 0.02 + i * 0.022, ((i / 2) | 0) * 0.05); g.add(c); } return g; },
  shotgun: () => shotgunMesh(),
};

export function shotgunMesh() {
  const g = new THREE.Group();
  const barrel = new THREE.Mesh(new THREE.CylinderGeometry(0.018, 0.018, 0.62, 8).rotateX(Math.PI / 2), mat('#2a2a2e'));
  barrel.position.set(0, 0.02, 0.28); g.add(barrel);
  const pump = new THREE.Mesh(new THREE.BoxGeometry(0.05, 0.05, 0.16), mat('#5a3a22')); pump.position.set(0, -0.015, 0.3); g.add(pump);
  const body = new THREE.Mesh(new THREE.BoxGeometry(0.05, 0.07, 0.2), mat('#2a2a2e')); body.position.set(0, 0, 0.0); g.add(body);
  const stock = new THREE.Mesh(new THREE.BoxGeometry(0.045, 0.09, 0.3), mat('#5a3a22')); stock.position.set(0, -0.03, -0.24); stock.rotation.x = 0.12; g.add(stock);
  return g;
}

export const items = [];
// 物を置く。kind：ammo shells herb gold shotgun、n：数
export function dropItem(kind, n, x, z, y = 0) {
  const g = LOOK[kind]();
  if (kind === 'shotgun') g.rotation.set(0, 0.6, Math.PI / 2);
  const glow = new THREE.Sprite(glowMat); glow.scale.setScalar(0.7); glow.position.y = 0.15; g.add(glow);
  g.position.set(x, y, z);
  scene.add(g);
  const it = { kind, n, g, x, z, y, t: Math.random() * 6 };
  items.push(it);
  return it;
}
export function removeItem(it) {
  scene.remove(it.g);
  const i = items.indexOf(it); if (i >= 0) items.splice(i, 1);
}
export function updateItems(dt) {
  for (const it of items) {
    it.t += dt;
    if (it.kind !== 'shotgun') { it.g.rotation.y += dt * 1.2; it.g.position.y = it.y + 0.04 + Math.sin(it.t * 3) * 0.03; }
  }
}
