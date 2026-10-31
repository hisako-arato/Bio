// 戦い：撃つ・弾込め・ナイフ・蹴り・回復・掴まれ・被弾。狙いの補助と、落ちている物を拾うのもここ
import { THREE, camera } from './engine.js';
import { player } from './player.js';
import { input, consume, aiming, settings } from './input.js';
import { cam } from './camera.js';
import { rayWorld, breakables, removeCollider } from './world.js';
import { zombies, rayZombies, damage, kickHit, knifeHit, kickTarget, grab, escapeGrab } from './zombies.js';
import { blood, dust, splinters, muzzleFlash, showLaser, hideLaser } from './fx.js';
import { items, removeItem, dropItem } from './items.js';
import { sfx } from './audio.js';

export const WEAPONS = {
  hg: { name: 'ハンドガン', rate: 0.32, reload: 1.35, dmg: 1 },
  sg: { name: 'ショットガン', rate: 0.95, reload: 2.2, dmg: 0.8, pellets: 7, spread: 0.065 },
};
export const stats = { shots: 0, hits: 0, kills: 0, heads: 0, deaths: 0, time: 0 };
export function resetStats() { Object.assign(stats, { shots: 0, hits: 0, kills: 0, heads: 0, deaths: 0, time: 0 }); }

let cooldown = 0, snap = null;
const _o = new THREE.Vector3(), _d = new THREE.Vector3(), _p = new THREE.Vector3(), _v = new THREE.Vector3();
const _aimDir = new THREE.Vector3();
let hooks = {};
export function setCombatHooks(h) { hooks = h; }

// 画面の中央（照準）を通る光線
function aimRay(spread = 0) {
  _o.copy(camera.position);
  camera.getWorldDirection(_d);
  if (spread) { _d.x += (Math.random() - 0.5) * spread; _d.y += (Math.random() - 0.5) * spread; _d.z += (Math.random() - 0.5) * spread; _d.normalize(); }
  // カメラと主人公の間にある物には当てない
  _v.set(player.pos.x, player.pos.y + 1.3, player.pos.z).sub(_o);
  const skip = Math.max(0, _v.dot(_d) - 0.4);
  _o.addScaledVector(_d, skip);
  return { o: _o, d: _d };
}
function rayBreakables(o, d, maxT) {
  let best = maxT, hit = null;
  for (const b of breakables) {
    if (b.hp <= 0) continue;
    _v.set(b.x, b.y, b.z).sub(o);
    const t = _v.dot(d); if (t < 0 || t > best) continue;
    const d2 = _v.lengthSq() - t * t; if (d2 > b.r * b.r) continue;
    const th = t - Math.sqrt(b.r * b.r - d2);
    if (th < best) { best = th; hit = b; }
  }
  return hit ? { b: hit, t: best } : null;
}
export function breakIt(b) {
  if (b.hp <= 0) return;
  b.hp = 0; b.mesh.visible = false; removeCollider(b.id);
  splinters({ x: b.x, y: b.y, z: b.z }); sfx.crate(b);
  if (b.drop) dropItem(b.drop.kind, b.drop.n, b.x, b.z);
}

// 1発撃つ（散弾は粒ごと）
function fireRay(spread, dmg, kind) {
  const { o, d } = aimRay(spread);
  const tw = rayWorld(o, d, 70);
  const hz = rayZombies(o, d, tw);
  const tz = hz ? hz.t : tw;
  const hb = rayBreakables(o, d, tz);
  if (hb) { breakIt(hb.b); return false; }
  _p.copy(o).addScaledVector(d, tz);
  if (hz) {
    // 散弾は遠いほど弱い
    let k = 1;
    if (kind === 'sg') { const dist = hz.z.pos.distanceTo(player.pos); k = dist < 5 ? 1 : Math.max(0.25, 1 - (dist - 5) / 10); }
    damage(hz.z, dmg * k * (kind === 'hg' ? player.inv.hgPow : player.inv.sgPow || 1), hz.part, d.clone(), _p.clone(), kind);
    if (hz.part === 'head') stats.heads++;
    return true;
  }
  if (tw < 70) { dust(_p, 5); if (Math.random() < 0.5) sfx.wall(_p); }
  return false;
}
function shoot() {
  const inv = player.inv, w = player.weapon;
  const magKey = w + 'Mag';
  if (inv[magKey] <= 0) {
    sfx.empty(); cooldown = 0.25;
    if (inv[w + 'Ammo'] > 0) startReload();
    return;
  }
  inv[magKey]--;
  stats.shots++;
  const W = WEAPONS[w];
  cooldown = W.rate;
  player.a.recoil = 1;
  muzzleFlash(player.muzzle, w === 'sg');
  cam.shake = Math.max(cam.shake, w === 'sg' ? 0.45 : 0.18);
  cam.pitch += w === 'sg' ? 0.035 : 0.012;
  let hit = false;
  if (w === 'sg') { sfx.shotgun(); for (let i = 0; i < W.pellets; i++) hit = fireRay(W.spread, W.dmg, 'sg') || hit; }
  else { sfx.handgun(); hit = fireRay(player.speed > 0.5 ? 0.012 : 0.003, W.dmg, 'hg'); }
  if (hit) stats.hits++;
  // 銃声に気づく
  for (const z of zombies) if (z.pos.distanceTo(player.pos) < 28) z.aggro = true;
}
function startReload() {
  const inv = player.inv, w = player.weapon;
  if (inv[w + 'Mag'] >= inv[w + 'Cap'] || inv[w + 'Ammo'] <= 0) return false;
  player.state = 'reload'; player.st = 0; sfx.reload();
  return true;
}
function finishReload() {
  const inv = player.inv, w = player.weapon;
  const need = inv[w + 'Cap'] - inv[w + 'Mag'], take = Math.min(need, inv[w + 'Ammo']);
  inv[w + 'Mag'] += take; inv[w + 'Ammo'] -= take;
}

// ---- 被弾 ----
export function hurtPlayer(dmg) {
  const p = player;
  if (p.invuln > 0 || p.state === 'dead' || p.state === 'down') return;
  p.hp -= dmg;
  p.a.hurt = 1;
  cam.shake = Math.max(cam.shake, 0.6);
  sfx.hurt();
  if (hooks.onHurt) hooks.onHurt(dmg);
  blood({ x: p.pos.x, y: 1.2, z: p.pos.z }, new THREE.Vector3(0, 0.3, 0), 0.6);
  if (p.hp <= 0) { die(); return; }
  if (['normal', 'reload', 'heal', 'knife'].includes(p.state)) { p.state = 'hurt'; p.st = 0; }
  p.invuln = 0.55;
}
export function knockPlayer(dmg, from) {
  const p = player;
  if (p.invuln > 0 || p.state === 'dead') return;
  if (grab.z) { grab.z = null; }
  p.hp -= dmg;
  cam.shake = 1;
  sfx.hurt(); sfx.thud(p.pos);
  if (hooks.onHurt) hooks.onHurt(dmg);
  // 突進の向きへ飛ばされ、仰向けに倒れる
  const dx = p.pos.x - from.pos.x, dz = p.pos.z - from.pos.z, l = Math.hypot(dx, dz) || 1;
  p.knockX = dx / l * 6; p.knockZ = dz / l * 6;
  p.facing = Math.atan2(-dx, -dz);
  p.fallDir = -1;
  if (p.hp <= 0) { die(); return; }
  p.state = 'down'; p.st = 0; p.invuln = 2.8;
}
function die() {
  const p = player;
  p.hp = 0; p.state = 'dead'; p.st = 0; p.fallDir = -1;
  stats.deaths++;
  if (grab.z) { const z = grab.z; grab.z = null; z.state = 'chase'; z.st = 0; z.cool = 3; }
  input.aimToggle = false;
  if (hooks.onDeath) hooks.onDeath();
}
export function grabbedPlayer() {
  const p = player;
  p.state = 'grabbed'; p.st = 0; input.aimToggle = false;
  if (hooks.onGrab) hooks.onGrab();
}

// ---- 狙いの補助（スマホ向け） ----
function angleTo(point) {
  _v.copy(point).sub(camera.position).normalize();
  camera.getWorldDirection(_aimDir);
  return Math.acos(Math.max(-1, Math.min(1, _v.dot(_aimDir))));
}
function assistTarget(maxAngle) {
  let best = null, ba = maxAngle;
  for (const z of zombies) {
    if (!['idle', 'chase', 'windup', 'swipe', 'stagger', 'kneel', 'charge', 'chargeWind', 'roar', 'stunned'].includes(z.state) || !z.rig.g.visible) continue;
    if (z.pos.distanceTo(player.pos) > 26) continue;
    const c = z.rig.c.parts[1].c;
    const a = angleTo(c);
    if (a < ba) {
      _d.copy(c).sub(camera.position); const len = _d.length(); _d.divideScalar(len);
      if (rayWorld(camera.position, _d, len) < len - 0.3) continue;
      ba = a; best = z;
    }
  }
  return best;
}
let wasAiming = false;
function lookInput(dt) {
  let k = player.aimW > 0.5 ? 0.55 : 1;
  if (settings.assist && player.aimW > 0.5) {
    // 照準が敵の上にあるときは、動きを少し重くする
    for (const z of zombies) {
      if (z.state === 'dead' || z.state === 'dying' || !z.rig.g.visible) continue;
      const a = Math.min(angleTo(z.rig.c.parts[0].c), angleTo(z.rig.c.parts[1].c));
      if (a < 0.07) { k *= 0.5; break; }
    }
  }
  cam.yaw -= input.lookX * k;
  cam.pitch -= input.lookY * k;
  const nowAim = aiming();
  if (nowAim && !wasAiming && settings.assist) {
    const z = assistTarget(0.42);
    if (z) {
      const c = z.rig.c.parts[1].c;
      _v.copy(c).sub(camera.position);
      snap = { yaw: Math.atan2(-_v.x, -_v.z), pitch: Math.atan2(_v.y, Math.hypot(_v.x, _v.z)), t: 0.16 };
    }
  }
  wasAiming = nowAim;
  if (snap) {
    const r = Math.min(1, dt / snap.t);
    let dy = snap.yaw - cam.yaw; while (dy > Math.PI) dy -= Math.PI * 2; while (dy < -Math.PI) dy += Math.PI * 2;
    cam.yaw += dy * r; cam.pitch += (snap.pitch - cam.pitch) * r;
    snap.t -= dt;
    if (snap.t <= 0 || !nowAim) snap = null;
  }
}

// ---- 毎フレーム ----
export function updateCombat(dt) {
  const p = player, inv = p.inv;
  p.st += dt; p.invuln -= dt; cooldown -= dt;
  if (p.state !== 'dead') lookInput(dt);

  // 照準の先（レーザーと銃の向きに使う）
  const { o, d } = aimRay(0);
  const tw = rayWorld(o, d, 60), hz = rayZombies(o, d, tw);
  p.aimPoint.copy(o).addScaledVector(d, hz ? hz.t : tw);
  p.aimOn = hz;

  // 吹き飛ばされている
  if (p.knockX) {
    p.pos.x += p.knockX * dt; p.pos.z += p.knockZ * dt;
    p.knockX *= Math.max(0, 1 - dt * 5); p.knockZ *= Math.max(0, 1 - dt * 5);
    if (Math.abs(p.knockX) + Math.abs(p.knockZ) < 0.1) p.knockX = p.knockZ = 0;
  }

  switch (p.state) {
    case 'normal': {
      if (consume('action')) {
        const t = kickTarget(p.pos.x, p.pos.z, p.facing);
        if (t) { p.state = 'kick'; p.st = 0; p.facing = Math.atan2(t.pos.x - p.pos.x, t.pos.z - p.pos.z); break; }
        if (hooks.interact && hooks.interact()) break;
      }
      if (consume('fire')) {
        if (p.aimW > 0.6) { if (cooldown <= 0) shoot(); }
        else if (input.usingTouch) input.aimToggle = true;
        else if (hooks.hint) hooks.hint('右クリックを押したまま構えて撃つ');
      }
      if (consume('reload')) startReload();
      if (consume('knife')) { p.state = 'knife'; p.st = 0; sfx.knife(); input.aimToggle = false; break; }
      if (consume('switch') && inv.hasSg) { p.weapon = p.weapon === 'hg' ? 'sg' : 'hg'; cooldown = 0.35; sfx.reload(); if (hooks.onSwitch) hooks.onSwitch(); }
      if (consume('heal')) {
        if (inv.herbs > 0 && p.hp < p.maxHp) { p.state = 'heal'; p.st = 0; input.aimToggle = false; }
        else if (hooks.hint) hooks.hint(inv.herbs > 0 ? '体力は満タンだ' : 'ハーブを持っていない');
      }
      break;
    }
    case 'reload':
      consume('fire');
      if (p.st > WEAPONS[p.weapon].reload) { finishReload(); p.state = 'normal'; p.st = 0; }
      p.a.reload = p.st / WEAPONS[p.weapon].reload;
      break;
    case 'knife':
      p.a.knife = p.st / 0.48;
      if (p.st > 0.2 && !p.didHit) {
        p.didHit = true;
        knifeHit(p.pos.x, p.pos.z, p.facing);
        for (const b of breakables) if (b.hp > 0 && Math.hypot(b.x - p.pos.x, b.z - p.pos.z) < 1.5) breakIt(b);
      }
      if (p.st > 0.48) { p.state = 'normal'; p.st = 0; p.didHit = false; }
      break;
    case 'kick':
      if (p.st > 0.27 && !p.didHit) { p.didHit = true; sfx.kick(); cam.shake = Math.max(cam.shake, 0.4); kickHit(p.pos.x, p.pos.z, p.facing); }
      if (p.st > 0.72) { p.state = 'normal'; p.st = 0; p.didHit = false; p.invuln = 0.3; }
      p.invuln = Math.max(p.invuln, 0.1);
      break;
    case 'heal':
      p.a.heal = p.st / 0.9;
      if (p.st > 0.5 && !p.didHit) { p.didHit = true; inv.herbs--; p.hp = Math.min(p.maxHp, p.hp + 50); sfx.heal(); if (hooks.onHeal) hooks.onHeal(); }
      if (p.st > 0.9) { p.state = 'normal'; p.st = 0; p.didHit = false; p.a.heal = 0; }
      break;
    case 'hurt':
      if (p.st > 0.38) { p.state = 'normal'; p.st = 0; }
      break;
    case 'grabbed': {
      // 連打で振りほどく
      for (const k of ['action', 'fire', 'knife', 'reload']) if (consume(k)) grab.mash++;
      grab.t += dt;
      if (grab.mash >= 7) { escapeGrab(); sfx.kick(); if (hooks.onEscape) hooks.onEscape(); break; }
      if (grab.t > 2.3 || !grab.z) {
        const z = grab.z;
        grab.z = null;
        p.state = 'normal'; p.st = 0;
        if (z) { z.state = 'chase'; z.st = 0; z.cool = 2; p.invuln = 0; hurtPlayer(22); p.invuln = 1.2; }
      }
      break;
    }
    case 'down':
      if (p.st > 2.1) { p.state = 'normal'; p.st = 0; p.invuln = 0.6; }
      break;
  }
  if (p.state !== 'normal') { consume('fire'); consume('switch'); consume('heal'); consume('reload'); consume('knife'); if (p.state !== 'grabbed') consume('action'); }

  // レーザーサイト
  if (p.aimW > 0.6 && (p.state === 'normal') && p.state !== 'dead') showLaser(p.muzzle, p.aimPoint);
  else hideLaser();

  // 拾う
  if (p.state !== 'dead') for (let i = items.length - 1; i >= 0; i--) {
    const it = items[i];
    if (Math.hypot(it.x - p.pos.x, it.z - p.pos.z) > 1.15) continue;
    pickup(it);
  }
}

export function pickup(it) {
  const inv = player.inv;
  let msg = '';
  switch (it.kind) {
    case 'ammo': inv.hgAmmo += it.n; msg = `ハンドガンの弾 ×${it.n}`; sfx.pickup(); break;
    case 'shells': inv.sgAmmo += it.n; msg = `ショットガンの弾 ×${it.n}`; sfx.pickup(); break;
    case 'herb': inv.herbs += it.n; msg = 'グリーンハーブ'; sfx.pickup(); break;
    case 'gold': inv.gold += it.n; msg = `${it.n} G`; sfx.gold(); break;
    case 'file': if (hooks.onFile) hooks.onFile(it.n); removeItem(it); return;
    case 'shotgun': inv.hasSg = true; inv.sgMag = inv.sgCap; player.weapon = 'sg'; msg = 'ショットガンを手に入れた'; sfx.pickup(); if (hooks.onShotgun) hooks.onShotgun(); break;
  }
  removeItem(it);
  if (hooks.onPickup) hooks.onPickup(msg, it.kind);
}
