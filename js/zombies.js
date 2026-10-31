// ゾンビ：種類・出現・追いかける・襲う・ひるむ・倒れる・死ぬ。大男（ボス）もここ
import { THREE, scene, camera, blobShadow } from './engine.js';
import { collide, flowDir, lineOfSight, rayWorld } from './world.js';
import { cloneZombie } from './vrm.js';
import { poseZombie } from './anim.js';
import { player, RADIUS as P_R, angDiff } from './player.js';
import { sfx } from './audio.js';
import { cam } from './camera.js';
import { settings } from './input.js';
import { blood, splat, dust } from './fx.js';

// 種類：model（VRM）、hp、speed（歩く速さ）、fast（小走りの度合い）、style（腕の格好）、pitch（声の高さ）
export const TYPES = {
  m1: { model: 'z_m1', hp: 5, speed: 1.0, fast: 0, style: 'reach', pitch: 1 },
  m2: { model: 'z_m2', hp: 5, speed: 1.1, fast: 0, style: 'limp', pitch: 0.9 },
  father: { model: 'z_father', hp: 7, speed: 0.85, fast: 0, style: 'limp', pitch: 0.8 },
  f1: { model: 'z_f1', hp: 4, speed: 1.9, fast: 0.6, style: 'reach', pitch: 1.4 },
  f2: { model: 'z_f2', hp: 4, speed: 1.6, fast: 0.4, style: 'limp', pitch: 1.3 },
  brute: { model: 'z_brute', hp: 48, speed: 1.45, fast: 0.2, style: 'limp', pitch: 0.55, scale: 1.38, boss: true },
  // 床を這う（脚をやられた村人）。背が低く、蹴りでは倒れない。ナイフがよく効く
  crawler: { model: 'z_m2', hp: 4, speed: 0.75, fast: 0, style: 'limp', pitch: 0.7, crawl: true },
  crawlerF: { model: 'z_f1', hp: 3, speed: 0.95, fast: 0, style: 'limp', pitch: 1.2, crawl: true },
  // 第2章のボス：墓守
  warden: { model: 'z_father', hp: 60, speed: 1.5, fast: 0.2, style: 'reach', pitch: 0.5, scale: 1.45, boss: true },
};
// 這うゾンビの頭の位置（足元から前へ）
const headOf = (z, out) => { out.x = z.pos.x + Math.sin(z.facing) * 1.35 * z.scale; out.z = z.pos.z + Math.cos(z.facing) * 1.35 * z.scale; return out; };
const _h = { x: 0, z: 0 };
export const masters = {};   // model → VRM（姿勢をつける元）
export const zombies = [];   // 今いるゾンビ
const pool = {};             // model → 使い終わった複製
export const events = { onKill: null, onBossHp: null };

export function spawnZombie(type, x, z, opts = {}) {
  const T = TYPES[type];
  const list = pool[T.model] || (pool[T.model] = []);
  let rig = list.pop();
  if (!rig) {
    const c = cloneZombie(masters[T.model]);
    const g = new THREE.Group(), tilt = new THREE.Group();
    tilt.add(c.scene); g.add(tilt);
    const sh = blobShadow(1.0); g.add(sh);
    rig = { c, g, tilt, sh };
  }
  const s = T.scale || 0.97 + Math.random() * 0.1;
  rig.c.scene.scale.setScalar(s);
  rig.c.headBone.scale.setScalar(1);
  rig.tilt.rotation.set(0, 0, 0);
  rig.g.position.set(x, 0, z);
  rig.sh.scale.setScalar(s);
  rig.g.visible = true;
  scene.add(rig.g);
  const zb = {
    type, T, rig, scale: s,
    pos: rig.g.position, facing: opts.facing ?? Math.random() * 6,
    hp: T.hp * (opts.hpMul || 1), maxHp: T.hp * (opts.hpMul || 1),
    state: opts.state || 'idle', st: 0, aggro: opts.aggro || false,
    speed: T.speed * (0.9 + Math.random() * 0.2),
    cool: 1 + Math.random(), groan: 1 + Math.random() * 4, legDmg: 0, headless: false,
    a: { t: Math.random() * 10, phase: Math.random() * 6, move: 0, style: T.style, fast: T.fast, tilt: (Math.random() - 0.5) * 0.6, raise: 0, lunge: 0, grab: 0, stagger: 0, kneel: 0, down: 0, roar: 0 },
    fall: 0, fallDir: -1, frame: Math.floor(Math.random() * 3), home: { x, z }, exit: opts.exit || null,
    wander: 0,
  };
  zombies.push(zb);
  return zb;
}
export function freeZombie(z) {
  scene.remove(z.rig.g);
  pool[z.T.model].push(z.rig);
  const i = zombies.indexOf(z); if (i >= 0) zombies.splice(i, 1);
}
export function clearZombies() { while (zombies.length) freeZombie(zombies[0]); }
export const alive = () => zombies.filter(z => z.state !== 'dying' && z.state !== 'dead').length;

// ---- 被弾 ----
// part：head body leg arm。dir：弾の向き。kind：hg sg kick knife
export function damage(z, amount, part, dir, at, kind = 'hg') {
  if (z.state === 'dying' || z.state === 'dead') return;
  z.aggro = true;
  const boss = z.T.boss;
  let dmg = amount;
  if (part === 'head') dmg *= boss ? 2 : 3;
  if (part === 'leg') dmg *= 0.8;
  if (part === 'arm') dmg *= 0.7;
  // 倒れている相手にはナイフがよく効く
  if (kind === 'knife' && (z.state === 'down' || z.state === 'stunned' || z.T.crawl)) dmg *= boss ? 4 : 2.5;
  // 頭への会心（大男には無い）
  const crit = !boss && part === 'head' && (kind === 'hg' ? Math.random() < 0.18 : kind === 'sg' && at && at.distanceTo(player.pos) < 4);
  if (crit) dmg = z.hp + 1;
  z.hp -= dmg;
  if (at) {
    blood(at, dir, part === 'head' ? 1.5 : 1);
    if (part === 'head') sfx.headshot(at); else sfx.hit(at);
  }
  if (boss && events.onBossHp) events.onBossHp(z);
  if (z.hp <= 0) { kill(z, dir, part === 'head' && (crit || kind === 'sg'), kind); return; }
  // ひるみ
  if (boss) {
    if (part === 'leg') { z.legDmg += dmg; if (z.legDmg > 6 && z.state !== 'stunned') { z.legDmg = 0; setState(z, 'kneel'); } }
    else if (part === 'head' && z.state === 'chase' && Math.random() < 0.3) setState(z, 'stagger');
    if (z.hp < z.maxHp * 0.5 && !z.enraged) { z.enraged = true; setState(z, 'roar'); z.speed *= 1.25; }
    return;
  }
  if (z.state === 'down' || z.state === 'kneel' || z.T.crawl) return;
  if (z.state === 'grabbing') { releaseGrab(z); setState(z, 'stagger'); return; }
  if (kind === 'sg') { setState(z, dmg > 2.2 ? 'stagger' : 'stagger'); z.pushX = dir.x * 2.5; z.pushZ = dir.z * 2.5; return; }
  if (part === 'leg') { z.legDmg += 1; if (z.legDmg >= 2 || Math.random() < 0.5) { z.legDmg = 0; setState(z, 'kneel'); } return; }
  if (part === 'head' || Math.random() < 0.35) setState(z, 'stagger');
}
function kill(z, dir, headPop, kind) {
  if (z.state === 'grabbing') releaseGrab(z);
  // 弾の来た向きへ倒れる（前から撃たれたら仰向け）
  const fx = Math.sin(z.facing), fz = Math.cos(z.facing);
  z.fallDir = dir && (dir.x * fx + dir.z * fz) > 0 ? 1 : -1;
  if (headPop && settings.blood !== 'off') {
    z.headless = true;
    const hp = z.rig.c.parts[0].c;
    blood(hp, new THREE.Vector3(0, 0.6, 0), 3); blood(hp, dir || new THREE.Vector3(), 2);
  }
  setState(z, 'dying');
  z.st = 0;
  if (events.onKill) events.onKill(z, kind, headPop);
}

// 蹴り：プレイヤーの前のゾンビをまとめて吹き飛ばす
export function kickHit(px, pz, facing) {
  let hit = 0;
  const fx = Math.sin(facing), fz = Math.cos(facing);
  for (const z of zombies) {
    if (z.state === 'dying' || z.state === 'dead') continue;
    const dx = z.pos.x - px, dz = z.pos.z - pz, d = Math.hypot(dx, dz);
    if (d > 2.5 * (z.T.boss ? 1.2 : 1) || (dx * fx + dz * fz) / (d || 1) < 0.35) continue;
    hit++;
    const dir = new THREE.Vector3(dx / d, 0.1, dz / d);
    const at = z.rig.c.parts[1].c.clone();
    if (z.T.boss) {
      if (z.state === 'stunned' || z.state === 'kneel') { damage(z, 4, 'body', dir, at, 'kick'); if (z.hp > 0) setState(z, 'down'); }
      else { damage(z, 1.5, 'body', dir, at, 'kick'); }
      continue;
    }
    damage(z, 3, 'body', dir, at, 'kick');
    if (z.hp > 0 && !z.T.crawl) { setState(z, 'down'); z.fallDir = (dx * Math.sin(z.facing) + dz * Math.cos(z.facing)) > 0 ? 1 : -1; z.pushX = dx / d * 4; z.pushZ = dz / d * 4; }
  }
  return hit;
}
export function knifeHit(px, pz, facing) {
  let hit = 0;
  const fx = Math.sin(facing), fz = Math.cos(facing);
  for (const z of zombies) {
    if (z.state === 'dying' || z.state === 'dead') continue;
    const dx = z.pos.x - px, dz = z.pos.z - pz, d = Math.hypot(dx, dz);
    const reach = (z.state === 'down' ? 2.4 : 1.7) * (z.T.boss ? 1.2 : 1);
    if (d > reach || (dx * fx + dz * fz) / (d || 1) < 0.3) continue;
    hit++;
    const lying = z.state === 'down';
    const part = lying ? 'body' : z.state === 'kneel' ? 'head' : 'body';
    const at = z.rig.c.parts[lying ? 2 : 1].c.clone();
    damage(z, 0.9, part, new THREE.Vector3(fx, 0, fz), at, 'knife');
  }
  return hit;
}

// 蹴れる相手（ひるみ・ひざつき・気絶）が前にいるか
export function kickTarget(px, pz, facing) {
  const fx = Math.sin(facing), fz = Math.cos(facing);
  for (const z of zombies) {
    if (!['stagger', 'kneel', 'stunned'].includes(z.state)) continue;
    const dx = z.pos.x - px, dz = z.pos.z - pz, d = Math.hypot(dx, dz);
    if (d < 2.4 * (z.T.boss ? 1.25 : 1) && (dx * fx + dz * fz) / (d || 1) > 0.2) return z;
  }
  return null;
}

// ---- 光線との当たり（弾） ----
const _oc = new THREE.Vector3();
export function rayZombies(o, d, maxT) {
  let best = maxT, hit = null, part = null;
  for (const z of zombies) {
    if (z.state === 'dying' || z.state === 'dead' || !z.rig.g.visible) continue;
    // 体全体の球（胸のあたり）で先にふるい落とす
    _oc.copy(z.rig.c.parts[1].c).sub(o);
    const tc = _oc.dot(d);
    if (tc < 0 || tc > best + 2) continue;
    if (_oc.lengthSq() - tc * tc > 1.8 * z.scale * z.scale) continue;
    for (const p of z.rig.c.parts) {
      if (p.kind === 'head' && z.headless) continue;
      _oc.copy(p.c).sub(o);
      const t = _oc.dot(d);
      if (t < 0) continue;
      const d2 = _oc.lengthSq() - t * t, r2 = p.rs * p.rs;
      if (d2 > r2) continue;
      const th = t - Math.sqrt(r2 - d2);
      if (th < best) { best = th; hit = z; part = p.kind; }
    }
  }
  return hit ? { z: hit, t: best, part } : null;
}

// ---- 掴み ----
let grabber = null;
export const grab = { z: null, mash: 0, t: 0 };
function releaseGrab(z) { if (grab.z === z) { grab.z = null; if (player.state === 'grabbed') { player.state = 'normal'; player.st = 0; } } }
export function escapeGrab() {
  const z = grab.z; if (!z) return;
  grab.z = null;
  setState(z, 'stagger');
  z.pushX = Math.sin(player.facing) * 3; z.pushZ = Math.cos(player.facing) * 3;
  player.state = 'normal'; player.st = 0; player.invuln = 0.8;
}

function setState(z, s) {
  z.state = s; z.st = 0; z.struck = false;
  if (s !== 'windup' && s !== 'swipe') { z.a.raise = 0; }
}

// ---- 毎フレーム ----
const _dir = { x: 0, z: 0 };
const _sphere = new THREE.Sphere(), _frustum = new THREE.Frustum(), _pm = new THREE.Matrix4();
let frame = 0;
export function updateZombies(dt, hooks) {
  frame++;
  _pm.multiplyMatrices(camera.projectionMatrix, camera.matrixWorldInverse);
  _frustum.setFromProjectionMatrix(_pm);
  for (let i = zombies.length - 1; i >= 0; i--) {
    const z = zombies[i];
    think(z, dt, hooks);
    if (!zombies.includes(z)) continue;
    // 互いに押し合う・プレイヤーとぶつかる
    for (const o of zombies) {
      if (o === z || o.state === 'dead' || o.state === 'dying' || z.state === 'dead' || z.state === 'dying') continue;
      const dx = z.pos.x - o.pos.x, dz = z.pos.z - o.pos.z, d = Math.hypot(dx, dz), m = 0.36 * (z.scale + o.scale);
      if (d < m && d > 1e-4) { const k = (m - d) / d * 0.5; z.pos.x += dx * k; z.pos.z += dz * k; }
    }
    if (z.state !== 'dead' && z.state !== 'dying' && player.state !== 'dead') {
      const dx = z.pos.x - player.pos.x, dz = z.pos.z - player.pos.z, d = Math.hypot(dx, dz), m = 0.34 * z.scale + P_R;
      if (d < m && d > 1e-4) {
        const k = (m - d) / d;
        z.pos.x += dx * k * 0.8; z.pos.z += dz * k * 0.8;
        player.pos.x -= dx * k * 0.2; player.pos.z -= dz * k * 0.2;
      }
    }
    if (z.state !== 'dead') collide(z.pos, 0.3 * z.scale);
    z.rig.g.rotation.y = z.facing;
    // 画面に映るか（映らないゾンビは姿勢の計算も省く）
    _sphere.center.set(z.pos.x, 0.9 * z.scale, z.pos.z); _sphere.radius = (z.T.crawl ? 2 : 1.4) * z.scale;
    const dist = camera.position.distanceTo(_sphere.center);
    const visible = dist < 48 && _frustum.intersectsSphere(_sphere);
    z.rig.g.visible = visible;
    // 遠いゾンビは2〜3フレームに1回だけ姿勢をつける
    const every = dist > 26 ? 3 : dist > 14 ? 2 : 1;
    z.acc = (z.acc || 0) + dt;
    if (visible && (frame + z.frame) % every === 0) {
      animate(z, z.acc);
      z.acc = 0;
    } else if (!visible) z.a.t += dt;
  }
}

function animate(z, dt) {
  const a = z.a, s = z.state;
  a.t += dt;
  const moving = ['chase', 'wander', 'leave', 'charge'].includes(s) && z.curSpeed > 0.1;
  a.move += ((moving ? 1 : 0) - a.move) * Math.min(1, dt * 6);
  a.phase += dt * (z.curSpeed || 0) * (s === 'charge' ? 2.2 : 3.4);
  a.fast = s === 'charge' ? 1 : z.T.fast;
  const to = (k, v, r = 8) => { a[k] += (v - a[k]) * Math.min(1, dt * r); };
  a.crawl = z.T.crawl ? 1 : 0;
  to('raise', s === 'windup' && !z.T.crawl ? 1 : 0, s === 'windup' ? 5 : 10);
  to('lunge', s === 'swipe' || s === 'charge' ? 1 : 0, 14);
  to('grab', s === 'grabbing' ? 1 : 0, 10);
  to('stagger', s === 'stagger' || s === 'stunned' ? 1 : 0, 12);
  to('kneel', s === 'kneel' ? 1 : 0, 10);
  to('roar', s === 'roar' || s === 'chargeWind' ? 1 : 0, 8);
  // 倒れる角度
  let fall = 0;
  if (s === 'down') fall = z.st < 0.45 ? z.st / 0.45 : z.st < 2.0 ? 1 : Math.max(0, 1 - (z.st - 2.0) / 0.9);
  else if (s === 'dying') fall = Math.min(1, (z.st / 0.75) ** 1.6);
  else if (s === 'dead') fall = 1;
  if (z.T.crawl) { fall = 1; z.fallDir = 1; }
  to('down', fall > 0.5 && !z.T.crawl ? 1 : 0, 8);
  z.rig.tilt.rotation.x = z.fallDir * fall * Math.PI / 2 * 0.97;
  z.rig.tilt.position.y = fall * 0.12 * z.scale;
  const m = masters[z.T.model];
  poseZombie(m, a);
  m.humanoid.update();
  z.rig.c.sync();
  if (z.headless) z.rig.c.headBone.scale.setScalar(0.001);
  z.rig.g.updateMatrixWorld(true);
  z.rig.c.updateParts(z.scale);
}

function face(z, x, zz, dt, rate = 4) {
  const want = Math.atan2(x - z.pos.x, zz - z.pos.z);
  z.facing += angDiff(z.facing, want) * Math.min(1, dt * rate);
}
function stepToward(z, dt, speed) {
  z.curSpeed = speed;
  const d = flowDir(z.pos.x, z.pos.z, _dir);
  let dx, dz;
  const px = player.pos.x - z.pos.x, pz = player.pos.z - z.pos.z, pd = Math.hypot(px, pz);
  // 近くて間に壁が無ければまっすぐ、そうでなければ道案内に従う
  if (pd < 3 || !d) { dx = px / (pd || 1); dz = pz / (pd || 1); }
  else { dx = d.x; dz = d.z; }
  z.pos.x += dx * speed * dt; z.pos.z += dz * speed * dt;
  const want = Math.atan2(dx, dz);
  z.facing += angDiff(z.facing, want) * Math.min(1, dt * 5);
}

function think(z, dt, hooks) {
  z.st += dt;
  z.cool -= dt;
  const T = z.T, boss = T.boss;
  const dx = player.pos.x - z.pos.x, dz = player.pos.z - z.pos.z, dist = Math.hypot(dx, dz);
  const facingErr = Math.abs(angDiff(z.facing, Math.atan2(dx, dz)));
  const pDead = player.state === 'dead';
  z.curSpeed = 0;
  // 押された勢い
  if (z.pushX) { z.pos.x += z.pushX * dt; z.pos.z += z.pushZ * dt; z.pushX *= Math.max(0, 1 - dt * 6); z.pushZ *= Math.max(0, 1 - dt * 6); if (Math.abs(z.pushX) + Math.abs(z.pushZ) < 0.05) z.pushX = z.pushZ = 0; }
  // うめき声
  if (z.state !== 'dead' && z.state !== 'dying') {
    z.groan -= dt;
    if (z.groan < 0) { z.groan = 3 + Math.random() * 6; if (dist < 26) sfx.groan(z.pos, T.pitch); }
  }
  switch (z.state) {
    case 'idle': {
      // 気づくまでは、その場で揺れるか、ゆっくりさまよう
      z.wander -= dt;
      if (z.wander < 0) { z.wander = 2 + Math.random() * 3; z.wx = z.home.x + (Math.random() - 0.5) * 5; z.wz = z.home.z + (Math.random() - 0.5) * 5; }
      if (z.wx != null && Math.hypot(z.wx - z.pos.x, z.wz - z.pos.z) > 0.5) {
        face(z, z.wx, z.wz, dt, 2);
        z.curSpeed = 0.35;
        z.pos.x += Math.sin(z.facing) * 0.35 * dt; z.pos.z += Math.cos(z.facing) * 0.35 * dt;
      }
      if (!pDead && (z.aggro || (dist < 16 && lineOfSight(z.pos, player.pos)) || dist < 4)) { z.aggro = true; setState(z, 'chase'); if (dist < 26) sfx.groan(z.pos, T.pitch); }
      break;
    }
    case 'chase': {
      if (pDead) { setState(z, 'idle'); break; }
      if (boss) { bossChase(z, dt, dist, facingErr); break; }
      const hd = z.T.crawl ? Math.hypot(player.pos.x - headOf(z, _h).x, player.pos.z - _h.z) : dist;
      const near = z.T.crawl ? hd < 0.9 : dist < 1.25 + (z.scale - 1);
      if (near) { face(z, player.pos.x, player.pos.z, dt, 6); z.curSpeed = 0; }
      else stepToward(z, dt, z.speed * (dist > 12 ? 1.15 : 1));
      if (near && facingErr < 0.6 && z.cool <= 0 && player.state !== 'down' && player.invuln <= 0) setState(z, 'windup');
      break;
    }
    case 'windup': {
      face(z, player.pos.x, player.pos.z, dt, 5);
      if (z.st > (boss ? 0.75 : 0.6)) setState(z, 'swipe');
      break;
    }
    case 'swipe': {
      // 腕を振り下ろす瞬間に、届けば当たる。2割ほどは掴みかかる
      if (z.st > 0.12 && !z.struck) {
        z.struck = true;
        const reach = boss ? 2.1 : 1.65;
        const d2 = z.T.crawl ? Math.hypot(player.pos.x - headOf(z, _h).x, player.pos.z - _h.z) + 0.4 : dist;
        if (d2 < reach && facingErr < 0.9 && player.invuln <= 0 && ['normal', 'reload', 'heal', 'knife'].includes(player.state)) {
          if (!boss && !z.T.crawl && !grab.z && Math.random() < 0.3) {
            grab.z = z; grab.mash = 0; grab.t = 0;
            setState(z, 'grabbing');
            hooks.grabbed(z);
            break;
          }
          hooks.hurt(boss ? 26 : z.T.crawl ? 9 : 12, z);
        }
      }
      if (z.st > 0.45) { z.cool = boss ? 1.4 : 1.2 + Math.random() * 0.8; setState(z, 'chase'); }
      break;
    }
    case 'grabbing': {
      face(z, player.pos.x, player.pos.z, dt, 10);
      // 主人公の正面に張り付く
      const want = 0.75;
      if (dist > want) { z.pos.x += dx / dist * (dist - want) * Math.min(1, dt * 8); z.pos.z += dz / dist * (dist - want) * Math.min(1, dt * 8); }
      break;
    }
    case 'stagger': {
      z.curSpeed = 0;
      if (z.st < 0.3) { z.pos.x -= Math.sin(z.facing) * 0.8 * dt; z.pos.z -= Math.cos(z.facing) * 0.8 * dt; }
      if (z.st > (boss ? 1.0 : 1.3)) { setState(z, 'chase'); z.cool = 0.4; }
      break;
    }
    case 'kneel': {
      if (z.st > (boss ? 2.2 : 2.0)) { setState(z, 'chase'); z.cool = 0.5; }
      break;
    }
    case 'down': {
      if (z.st > 2.9) { setState(z, 'chase'); z.cool = 0.8; }
      break;
    }
    case 'stunned': {
      if (z.st > 2.6) { setState(z, 'roar'); }
      break;
    }
    case 'roar': {
      if (z.st < 0.05) { sfx.roar(z.pos); cam.shake = Math.max(cam.shake, 0.5); }
      face(z, player.pos.x, player.pos.z, dt, 3);
      if (z.st > 1.3) { setState(z, 'chase'); z.cool = 0.5; z.chargeCool = 1.5; }
      break;
    }
    case 'chargeWind': {
      face(z, player.pos.x, player.pos.z, dt, 6);
      if (z.st > 0.8) { setState(z, 'charge'); z.cx = Math.sin(z.facing); z.cz = Math.cos(z.facing); z.hitPlayer = false; sfx.roar(z.pos); }
      break;
    }
    case 'charge': {
      // 一直線に突進する。壁にぶつかると気絶する
      const sp = z.enraged ? 8 : 7;
      z.curSpeed = sp;
      const ox = z.pos.x, oz = z.pos.z;
      z.pos.x += z.cx * sp * dt; z.pos.z += z.cz * sp * dt;
      if (Math.floor(z.st * 4) !== Math.floor((z.st - dt) * 4)) { sfx.stomp(z.pos); cam.shake = Math.max(cam.shake, 0.25); }
      const probe = { x: z.pos.x, z: z.pos.z }; collide(probe, 0.45 * z.scale);
      const blocked = Math.hypot(probe.x - z.pos.x, probe.z - z.pos.z) > 0.02;
      if (!z.hitPlayer && dist < 1.4 && player.invuln <= 0 && player.state !== 'dead') {
        z.hitPlayer = true; hooks.knock(34, z);
      }
      if (blocked && z.st > 0.2) {
        z.pos.x = ox; z.pos.z = oz;
        sfx.thud(z.pos); cam.shake = Math.max(cam.shake, 0.6); dust(z.rig.c.parts[1].c, 16);
        setState(z, 'stunned'); hooks.bossStunned && hooks.bossStunned(z);
      } else if (z.st > 3.0) { setState(z, 'chase'); z.chargeCool = 3 + Math.random() * 2; }
      break;
    }
    case 'leave': {
      // 鐘が鳴った：出てきた路地へ帰っていく
      if (z.exit) {
        const ex = z.exit.x - z.pos.x, ez = z.exit.z - z.pos.z, d = Math.hypot(ex, ez);
        if (d < 1.5) { freeZombie(z); return; }
        face(z, z.exit.x, z.exit.z, dt, 3);
        z.curSpeed = 1.3;
        z.pos.x += Math.sin(z.facing) * 1.3 * dt; z.pos.z += Math.cos(z.facing) * 1.3 * dt;
      }
      if (z.st > 14) { freeZombie(z); return; }
      break;
    }
    case 'dying': {
      if (z.st > 0.75 && !z.thud) { z.thud = true; sfx.thud(z.pos); dust({ x: z.pos.x, y: 0.1, z: z.pos.z }, 8); if (settings.blood !== 'off') splat(z.pos.x - Math.sin(z.facing) * z.fallDir * 0.9, z.pos.z - Math.cos(z.facing) * z.fallDir * 0.9, 1.2); }
      if (z.st > 0.8) { setState(z, 'dead'); z.thud = false; }
      break;
    }
    case 'dead': {
      // 少し置いてから地面に沈んで消える
      if (z.st > 4) z.rig.g.position.y = -(z.st - 4) * 0.35;
      if (z.st > 6) { freeZombie(z); return; }
      break;
    }
  }
}

function bossChase(z, dt, dist, facingErr) {
  z.chargeCool = (z.chargeCool ?? 2) - dt;
  // 離れていて、まっすぐ見通せるなら突進
  if (dist > 5 && dist < 22 && z.chargeCool <= 0 && lineOfSight(z.pos, player.pos)) { setState(z, 'chargeWind'); return; }
  const near = dist < 1.9;
  if (near) { face(z, player.pos.x, player.pos.z, dt, 5); z.curSpeed = 0; }
  else stepToward(z, dt, z.speed);
  if (near && facingErr < 0.6 && z.cool <= 0 && player.state !== 'down' && player.invuln <= 0) setState(z, 'windup');
}

export function bellLeave(exits) {
  for (const z of zombies) {
    if (z.state === 'dying' || z.state === 'dead') continue;
    if (z.state === 'grabbing') releaseGrab(z);
    let best = exits[0], bd = 1e9;
    for (const e of exits) { const d = Math.hypot(e.x - z.pos.x, e.z - z.pos.z); if (d < bd) { bd = d; best = e; } }
    z.exit = best; setState(z, 'leave');
  }
}

export function nearestThreat() {
  let best = 1e9;
  for (const z of zombies) if (z.state !== 'dead' && z.state !== 'dying' && z.state !== 'leave') best = Math.min(best, z.pos.distanceTo(player.pos));
  return best;
}
export { rayWorld };
