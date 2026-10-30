// 主人公：移動・向き・姿勢・手に持つ物（拳銃・散弾銃・ナイフ）
import { THREE, scene, mat, blobShadow } from './engine.js';
import { collide } from './world.js';
import { posePlayer } from './anim.js';
import { input, aiming } from './input.js';
import { cam } from './camera.js';
import { shotgunMesh } from './items.js';
import { sfx } from './audio.js';

export const RADIUS = 0.32;
export const player = {
  vrm: null, g: new THREE.Group(), body: new THREE.Group(),
  pos: new THREE.Vector3(), facing: 0, speed: 0,
  hp: 100, maxHp: 100,
  inv: null,
  weapon: 'hg',
  state: 'normal', st: 0,       // 今の動作と、その経過時間
  invuln: 0,
  aimW: 0,                      // 構えの度合い（0〜1）
  a: { t: 0, phase: 0, move: 0, run: 0, aim: 0, pitch: 0, weapon: 'hg', recoil: 0, reload: 0, reloadW: 0, knife: 0, knifeW: 0, kick: 0, hurt: 0, heal: 0, grab: 0, down: 0 },
  hand: new THREE.Vector3(), muzzle: new THREE.Vector3(), aimPoint: new THREE.Vector3(),
  fall: 0, fallDir: -1,
};
export function freshInventory() {
  return { hgMag: 10, hgAmmo: 20, hgCap: 10, hgPow: 1, sgMag: 0, sgAmmo: 0, sgCap: 5, hasSg: false, herbs: 1, gold: 0 };
}
player.inv = freshInventory();

// ---- 手に持つ物 ----
function handgunMesh() {
  const g = new THREE.Group();
  const m = mat('#24242a'), m2 = mat('#3a3a40');
  const slide = new THREE.Mesh(new THREE.BoxGeometry(0.032, 0.036, 0.19), m2); slide.position.set(0, 0.035, 0.06); g.add(slide);
  const grip = new THREE.Mesh(new THREE.BoxGeometry(0.03, 0.1, 0.045), m); grip.position.set(0, -0.02, -0.01); grip.rotation.x = -0.25; g.add(grip);
  const guard = new THREE.Mesh(new THREE.BoxGeometry(0.01, 0.025, 0.05), m); guard.position.set(0, 0.0, 0.035); g.add(guard);
  return g;
}
function knifeMesh() {
  const g = new THREE.Group();
  const blade = new THREE.Mesh(new THREE.BoxGeometry(0.006, 0.03, 0.2), mat('#c8ccd4', { emissive: '#202428' })); blade.position.z = 0.13; g.add(blade);
  const hilt = new THREE.Mesh(new THREE.BoxGeometry(0.025, 0.03, 0.1), mat('#2a2018')); g.add(hilt);
  return g;
}
const guns = { hg: handgunMesh(), sg: shotgunMesh(), knife: knifeMesh() };
const MUZZLE = { hg: new THREE.Vector3(0, 0.035, 0.17), sg: new THREE.Vector3(0, 0.02, 0.6) };
for (const k in guns) { guns[k].visible = false; scene.add(guns[k]); }

export function setupPlayer(vrm) {
  player.vrm = vrm;
  player.body.add(vrm.scene);
  player.g.add(player.body);
  player.g.add(blobShadow(0.9));
  scene.add(player.g);
  vrm.scene.traverse(o => { if (o.isMesh) { o.castShadow = false; o.receiveShadow = false; } });
  player.rawHand = vrm.humanoid.getRawBoneNode('rightHand');
  player.rawLower = vrm.humanoid.getRawBoneNode('rightLowerArm');
  player.rawLeftHand = vrm.humanoid.getRawBoneNode('leftHand');
  player.headY = vrm.headY;
}

export function placePlayer(x, z, yaw) {
  player.pos.set(x, 0, z);
  player.facing = yaw + Math.PI;
  cam.yaw = yaw; cam.pitch = -0.08;
  player.speed = 0;
}

const angDiff = (a, b) => { let d = b - a; while (d > Math.PI) d -= Math.PI * 2; while (d < -Math.PI) d += Math.PI * 2; return d; };
export { angDiff };
const _wish = new THREE.Vector3(), _q = new THREE.Quaternion(), _v = new THREE.Vector3(), _v2 = new THREE.Vector3();
let stepPhase = 0;

// 毎フレーム：移動と向き（動作の切り替えは combat.js）
export function updatePlayer(dt) {
  const p = player, a = p.a, s = p.state;
  const canAim = s === 'normal' || s === 'reload';
  const wantAim = canAim && aiming();
  p.aimW += ((wantAim ? 1 : 0) - p.aimW) * Math.min(1, dt * 12);
  // 動ける速さ
  let max = 0;
  if (s === 'normal' || s === 'reload' || s === 'heal') {
    max = wantAim ? 1.15 : input.run && s === 'normal' ? 4.7 : 2.55;
    if (s !== 'normal') max = Math.min(max, 1.6);
  }
  _wish.set(0, 0, 0).addScaledVector(cam.fwd, input.my).addScaledVector(cam.right, input.mx);
  const amt = Math.min(1, _wish.length());
  if (amt > 0.05) _wish.normalize();
  const target = amt > 0.05 ? max * Math.max(0.35, amt) : 0;
  p.speed += (target - p.speed) * Math.min(1, dt * (target > p.speed ? 8 : 12));
  if (p.speed > 0.02 && amt > 0.05) {
    p.pos.addScaledVector(_wish, p.speed * dt);
    collide(p.pos, RADIUS);
    p.moveDir = Math.atan2(_wish.x, _wish.z);
  }
  // 向き：構えている間はカメラの向き、歩くときは進む向き
  let face = p.facing;
  if (p.aimW > 0.3 || wantAim) face = cam.yaw + Math.PI;
  else if (amt > 0.05 && max > 0) face = p.moveDir;
  if (s === 'normal' || s === 'reload' || s === 'heal' || (s === 'knife' && p.st < 0.1) || (s === 'kick' && p.st < 0.08)) {
    const rate = wantAim ? 18 : 10;
    p.facing += angDiff(p.facing, face) * Math.min(1, dt * rate);
  }
  p.g.position.copy(p.pos);
  p.g.rotation.y = p.facing;

  // 姿勢
  a.t += dt;
  const moving = p.speed > 0.15;
  const relSpeed = p.speed;
  a.phase += dt * (relSpeed < 0.2 ? 0 : 3.2 + relSpeed * 1.55);
  a.move += ((moving ? Math.min(1, relSpeed / 2.2) : 0) - a.move) * Math.min(1, dt * 10);
  a.run += ((relSpeed > 3.2 ? 1 : 0) - a.run) * Math.min(1, dt * 6);
  a.aim = p.aimW;
  a.pitch = cam.pitch;
  a.weapon = p.weapon;
  a.recoil = Math.max(0, a.recoil - dt * 6);
  a.hurt = Math.max(0, a.hurt - dt * 3);
  a.reloadW += ((s === 'reload' ? 1 : 0) - a.reloadW) * Math.min(1, dt * 12);
  a.knifeW += ((s === 'knife' ? 1 : 0) - a.knifeW) * Math.min(1, dt * 18);
  a.grab += ((s === 'grabbed' ? 1 : 0) - a.grab) * Math.min(1, dt * 10);
  a.kick = s === 'kick' ? p.st / 0.72 : 0;
  // 足音
  if (moving) {
    const k = Math.floor(a.phase / Math.PI);
    if (k !== stepPhase) { stepPhase = k; sfx.step(a.run > 0.5); }
  }
  // 倒れる・起き上がる（体ごと後ろへ傾ける）
  const lying = s === 'down' ? (p.st < 0.45 ? p.st / 0.45 : p.st < 1.5 ? 1 : Math.max(0, 1 - (p.st - 1.5) / 0.6)) : s === 'dead' ? Math.min(1, p.st / 0.7) : 0;
  p.fall = lying;
  a.down = lying;
  p.body.rotation.x = p.fallDir * lying * Math.PI / 2 * 0.96;
  p.body.position.y = lying * 0.08;
  posePlayer(p.vrm, a);
  // まばたき
  const em = p.vrm.expressionManager;
  if (em) {
    p.blink = (p.blink ?? 3) - dt;
    let b = 0;
    if (p.blink < 0.15) b = Math.sin(Math.max(0, p.blink) / 0.15 * Math.PI);
    if (p.blink < 0) p.blink = 2 + Math.random() * 4;
    em.setValue('blink', s === 'dead' ? 1 : b);
    em.setValue('sad', a.hurt * 0.8 + (s === 'grabbed' ? 0.8 : 0));
  }
  p.vrm.update(dt);
  p.g.updateMatrixWorld(true);
  placeHeld();
}

// 手に持つ物を、右手の位置に合わせて置く
function placeHeld() {
  const p = player;
  p.rawHand.getWorldPosition(p.hand);
  const knifing = p.state === 'knife';
  for (const k in guns) guns[k].visible = false;
  if (p.state === 'dead') return;
  if (knifing) {
    const kn = guns.knife; kn.visible = true;
    p.rawLower.getWorldPosition(_v);
    _v2.copy(p.hand).sub(_v).normalize();
    kn.position.copy(p.hand).addScaledVector(_v2, 0.04);
    kn.lookAt(_v.copy(p.hand).addScaledVector(_v2, 1));
    return;
  }
  const gun = guns[p.weapon];
  gun.visible = true;
  if (p.aimW > 0.5 && p.state !== 'reload') {
    gun.position.copy(p.hand);
    if (p.weapon === 'sg') { gun.position.y += 0.02; }
    gun.lookAt(p.aimPoint);
  } else {
    // 下げて持つ：前やや下へ向ける
    p.rawLower.getWorldPosition(_v);
    _v2.copy(p.hand).sub(_v).normalize();
    gun.position.copy(p.hand);
    const fx = Math.sin(p.facing), fz = Math.cos(p.facing);
    _v.set(p.hand.x + fx * 0.6 + _v2.x * 0.5, p.hand.y - 0.35, p.hand.z + fz * 0.6 + _v2.z * 0.5);
    if (p.weapon === 'sg') _v.y = p.hand.y - 0.6;
    gun.lookAt(_v);
  }
  gun.updateMatrixWorld();
  p.muzzle.copy(MUZZLE[p.weapon]).applyMatrix4(gun.matrixWorld);
}
