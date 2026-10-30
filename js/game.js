// 体験版の流れ：村はずれの小道 → 広場で鐘が鳴るまで生き延びる → 商人 → 教会の前で大男 → 教会の扉
import { THREE, scene, mat } from './engine.js';
import { spots, gates, resetBreakables, areaOf, updateFlow } from './world.js';
import { player, placePlayer, freshInventory } from './player.js';
import { zombies, spawnZombie, clearZombies, alive, bellLeave, events, kickTarget, grab, nearestThreat, damage } from './zombies.js';
import { stats, setCombatHooks, hurtPlayer, knockPlayer, grabbedPlayer } from './combat.js';
import { dropItem, items, removeItem } from './items.js';
import { objective, timer, bossBar, hint, toast, damageFlash, resetHud } from './hud.js';
import { sfx, setTension } from './audio.js';
import { input } from './input.js';
import { cam } from './camera.js';
import { quality } from './engine.js';
import { clearDecals } from './fx.js';

export const game = {
  phase: 'path',      // path → plaza → lane → yard → end
  checkpoint: null,   // { phase, inv, hp }
  t: 0,
  siegeT: 0, spawnT: 0, spawned: 0,
  boss: null, bossDead: false, minionT: 0,
  shotgunItem: null,
  hints: new Set(),
  onDeath: null, onEnd: null, openShop: null,
};
const once = (key, text, sec) => { if (game.hints.has(key)) return; game.hints.add(key); hint(text, sec); };

// ---- 商人（フードをかぶった人影。手に提灯） ----
const merchant = new THREE.Group();
{
  const cloak = new THREE.Mesh(new THREE.ConeGeometry(0.42, 1.55, 10), mat('#2a2230'));
  cloak.position.y = 0.78; merchant.add(cloak);
  const hood = new THREE.Mesh(new THREE.SphereGeometry(0.2, 10, 8), mat('#2a2230')); hood.position.y = 1.58; hood.scale.set(1, 1.1, 1.05); merchant.add(hood);
  const face = new THREE.Mesh(new THREE.SphereGeometry(0.13, 8, 6), mat('#050406')); face.position.set(0, 1.55, 0.09); merchant.add(face);
  for (const s of [-1, 1]) { const eye = new THREE.Mesh(new THREE.SphereGeometry(0.018, 6, 4), new THREE.MeshBasicMaterial({ color: '#ffb040' })); eye.position.set(s * 0.045, 1.57, 0.2); merchant.add(eye); }
  const lamp = new THREE.Mesh(new THREE.BoxGeometry(0.12, 0.18, 0.12), mat('#ffcf70', { emissive: '#ff9a20', emissiveIntensity: 2 })); lamp.position.set(0.32, 0.95, 0.2); merchant.add(lamp);
  const pack = new THREE.Mesh(new THREE.BoxGeometry(0.5, 0.6, 0.3), mat('#4a3424')); pack.position.set(0, 1.1, -0.28); merchant.add(pack);
  merchant.visible = false;
  scene.add(merchant);
}

// ---- 進行の切り替え ----
function saveCheckpoint(phase) {
  game.checkpoint = { phase, inv: { ...player.inv }, hp: Math.max(player.hp, 60), weapon: player.weapon };
}
export function newGame() {
  player.inv = freshInventory();
  player.hp = player.maxHp;
  player.weapon = 'hg';
  game.hints.clear();
  for (const it of [...items]) removeItem(it);
  resetBreakables();
  game.shotgunItem = dropItem('shotgun', 1, spots.shotgun.x, spots.shotgun.z, spots.shotgun.y);
  enterPhase('path', true);
}
export function jumpTo(phase) { enterPhase(phase, true); }
export function continueGame() {
  const c = game.checkpoint;
  player.inv = { ...c.inv }; player.hp = c.hp; player.weapon = c.weapon;
  // 散弾銃を拾った後にやられたら、元の場所に戻す
  if (!player.inv.hasSg && !items.includes(game.shotgunItem)) game.shotgunItem = dropItem('shotgun', 1, spots.shotgun.x, spots.shotgun.z, spots.shotgun.y);
  enterPhase(c.phase, false);
}
function resetPlayerState() {
  Object.assign(player, { state: 'normal', st: 0, invuln: 1, speed: 0, knockX: 0, knockZ: 0, didHit: false, fall: 0 });
  player.a.hurt = 0; player.a.recoil = 0;
  input.aimToggle = false;
  grab.z = null;
}
function enterPhase(phase, fresh) {
  clearZombies();
  clearDecals();
  resetHud();
  resetPlayerState();
  game.phase = phase;
  game.boss = null; game.bossDead = false;
  merchant.visible = false;
  gates.plazaS.set(true); gates.plazaN.set(false);
  setTension(0.15);
  cam.override = null;
  if (phase === 'path') {
    placePlayer(spots.start.x, spots.start.z, spots.start.yaw);
    objective('村の広場へ向かう');
    spawnZombie('m1', 0.5, 55, { facing: Math.PI });
    spawnZombie('m2', -2.5, 43, { facing: 0.5 });
    spawnZombie('father', 8, 46.5, { facing: -1.5 });
    game.pathAmbush = false;
    once('move', input.usingTouch ? '左側をなぞって移動、右側をなぞって見回す' : 'WASD で移動、マウスで見回す（画面をクリックで操作開始）', 6);
  }
  if (phase === 'plaza') {
    placePlayer(0, 21, 0);
    startSiege();
  }
  if (phase === 'lane') {
    gates.plazaN.set(true);
    placePlayer(0, -18, 0);
    merchant.visible = true;
    objective('教会へ向かう');
  }
  if (phase === 'yard') {
    gates.plazaN.set(true);
    merchant.visible = true;
    placePlayer(1, -43, 0);
    startBoss();
  }
  if (fresh) saveCheckpoint(phase);
}

// ■ 広場：鐘が鳴るまで生き延びる
const SIEGE = 110;
function startSiege() {
  game.phase = 'plaza';
  gates.plazaS.set(false);
  game.siegeT = SIEGE; game.spawnT = 1.5; game.spawned = 0;
  objective('鐘が鳴るまで生き延びろ');
  setTension(0.7);
  // 最初の何体かは広場にいる
  spawnZombie('m1', -6, 4, { aggro: true, facing: 2 });
  spawnZombie('f2', 7, -6, { aggro: true, facing: -2 });
  spawnZombie('m2', 3, 9, { aggro: true });
  hint('囲まれた！ 鐘が鳴るまで持ちこたえろ', 4);
}
function siegeStep(dt) {
  game.siegeT -= dt;
  timer(game.siegeT);
  const cap = quality.level === 'low' ? 6 : 8;
  game.spawnT -= dt;
  if (game.spawnT <= 0 && alive() < cap) {
    game.spawnT = 2.6 + Math.random() * 1.6;
    // プレイヤーから遠い路地から出す
    const sp = spots.spawnsPlaza.slice().sort((a, b) => Math.hypot(b.x - player.pos.x, b.z - player.pos.z) - Math.hypot(a.x - player.pos.x, a.z - player.pos.z));
    const at = sp[Math.floor(Math.random() * 3)];
    const kinds = game.siegeT < SIEGE * 0.5 ? ['m1', 'm2', 'f1', 'f2', 'father', 'f1'] : ['m1', 'm2', 'f2', 'father'];
    spawnZombie(kinds[Math.floor(Math.random() * kinds.length)], at.x + (Math.random() - 0.5), at.z + (Math.random() - 0.5), { aggro: true, exit: at });
    game.spawned++;
  }
  if (game.siegeT <= SIEGE - 20) once('shotgun', '西の家の軒下に、何か光る物がある', 4);
  if (game.siegeT <= 0) {
    // 鐘が鳴り、ゾンビは去っていく
    timer(null);
    sfx.bell();
    bellLeave(spots.spawnsPlaza);
    objective('……鐘の音？');
    setTension(0.15);
    game.phase = 'bell'; game.bellT = 0;
  }
}

// ■ 教会の前庭：大男
function startBoss() {
  game.phase = 'yard';
  objective('大男を倒せ');
  setTension(1);
  game.boss = spawnZombie('brute', 0, -70, { aggro: true, state: 'roar', facing: 0 });
  bossBar(game.boss);
  game.minionT = 8;
  spawnZombie('m2', -9, -60, { aggro: true });
  spawnZombie('f1', 10, -64, { aggro: true });
  hint('突進は横に避けろ。壁にぶつかって怯んだら蹴り飛ばせ', 5);
}
function bossStep(dt) {
  const b = game.boss;
  if (!b) return;
  if (!game.bossDead) bossBar(b);
  if (b.hp <= 0 || !zombies.includes(b)) {
    if (!game.bossDead) {
      game.bossDead = true; bossBar(null);
      objective('教会の扉へ');
      setTension(0.2);
      for (const z of [...zombies]) if (z !== b && z.state !== 'dying' && z.state !== 'dead') damage(z, 99, 'body', new THREE.Vector3(0, 0, 1), null, 'kick');
      hint('大男を倒した！ 教会の扉へ向かえ', 4);
      dropItem('gold', 1500, b.pos.x, b.pos.z);
    }
    return;
  }
  // 手下を少しずつ呼ぶ
  game.minionT -= dt;
  if (game.minionT <= 0) {
    game.minionT = 16;
    if (alive() < 3) {
      const sp = spots.spawnsYard[Math.floor(Math.random() * spots.spawnsYard.length)];
      spawnZombie(['m1', 'm2', 'f2'][Math.floor(Math.random() * 3)], sp.x, sp.z, { aggro: true });
    }
  }
}

// ---- 商人の品 ----
export const SHOP = [
  { id: 'ammo', name: 'ハンドガンの弾 ×15', price: 300, buy: inv => { inv.hgAmmo += 15; } },
  { id: 'shells', name: 'ショットガンの弾 ×6', price: 450, need: inv => inv.hasSg, buy: inv => { inv.sgAmmo += 6; } },
  { id: 'herb', name: 'グリーンハーブ', price: 400, buy: inv => { inv.herbs++; } },
  { id: 'pow', name: 'ハンドガン改造：威力', desc: '威力 ×1.5', price: 1500, once: inv => inv.hgPow > 1, buy: inv => { inv.hgPow = 1.5; } },
  { id: 'cap', name: 'ハンドガン改造：装弾数', desc: '10 → 15 発', price: 900, once: inv => inv.hgCap > 10, buy: inv => { inv.hgCap = 15; } },
  { id: 'sgcap', name: 'ショットガン改造：装弾数', desc: '5 → 8 発', price: 1100, need: inv => inv.hasSg, once: inv => inv.sgCap > 5, buy: inv => { inv.sgCap = 8; } },
];

// ---- 毎フレーム ----
let flowT = 0, heartT = 0;
export function updateGame(dt) {
  game.t += dt;
  if (game.phase !== 'end') stats.time += dt;
  flowT -= dt;
  if (flowT <= 0) { flowT = 0.3; updateFlow(player.pos.x, player.pos.z); }
  const z = player.pos.z;
  const ph = game.phase;
  if (ph === 'path') {
    if (!game.pathAmbush && z < 40) {
      game.pathAmbush = true;
      // 家の陰から2体
      spawnZombie('f2', -9, 36, { aggro: true });
      spawnZombie('m1', 9.5, 31, { aggro: true });
    }
    const near = nearestThreat();
    if (near < 14) once('aim', input.usingTouch ? '「構え」で狙い、「撃つ」で撃つ。頭や脚を狙え' : '右クリックで構え、左クリックで撃つ。頭や脚を狙え', 5);
    if (z < 19) { saveCheckpoint('plaza'); startSiege(); }
  } else if (ph === 'plaza') {
    siegeStep(dt);
  } else if (ph === 'bell') {
    game.bellT += dt;
    // 見えなくなった者から消していく
    if (game.bellT > 4) for (const z of [...zombies]) if (z.state === 'leave' && !z.rig.g.visible) z.st = 99;
    if (game.bellT > 4 && alive() === 0 || game.bellT > 11) {
      clearZombies();
      gates.plazaN.set(true);
      merchant.visible = true;
      objective('教会へ向かう');
      hint('北の門が開いた。路地に誰かいる……', 4);
      game.phase = 'lane';
      saveCheckpoint('lane');
    }
  } else if (ph === 'lane') {
    if (z < -44) { saveCheckpoint('yard'); startBoss(); }
  } else if (ph === 'yard') {
    bossStep(dt);
    if (game.bossDead && Math.hypot(player.pos.x - spots.churchDoor.x, player.pos.z - spots.churchDoor.z) < 2.2) {
      game.phase = 'end';
      game.onEnd && game.onEnd();
    }
  }
  // 体力が少ないと心音
  if (player.hp < 30 && player.state !== 'dead') { heartT -= dt; if (heartT <= 0) { heartT = 0.9; sfx.heart(); } }
  // 商人はプレイヤーの方を向く
  if (merchant.visible) {
    merchant.position.set(spots.merchant.x, 0, spots.merchant.z);
    merchant.rotation.y = Math.atan2(player.pos.x - spots.merchant.x, player.pos.z - spots.merchant.z);
  }
  // 「蹴る」などのヒント
  const kt = player.state === 'normal' && kickTarget(player.pos.x, player.pos.z, player.facing);
  if (kt) once('kick', 'ひるんだ敵は蹴り飛ばせる（まとめて倒せる）', 4);
  if (player.inv.hgMag === 0 && player.inv.hgAmmo === 0 && player.weapon === 'hg') once('noammo', '弾切れだ。ナイフで木箱や樽を壊すと、中身が出ることがある', 5);
}

// 今押せる「調べる・話す」ボタン
export function contextPrompt() {
  if (player.state === 'grabbed') return '連打！';
  if (player.state !== 'normal') return null;
  if (kickTarget(player.pos.x, player.pos.z, player.facing)) return '蹴る';
  if (merchant.visible && Math.hypot(player.pos.x - spots.merchant.x, player.pos.z - spots.merchant.z) < 2.2) return '話す';
  return null;
}
export function interact() {
  if (merchant.visible && Math.hypot(player.pos.x - spots.merchant.x, player.pos.z - spots.merchant.z) < 2.2) { game.openShop && game.openShop(); return true; }
  return false;
}

// 倒したゾンビが落とす物
events.onKill = (z, kind, headPop) => {
  stats.kills++;
  if (z.T.boss) return;
  const r = Math.random(), inv = player.inv;
  const lowAmmo = inv.hgAmmo + inv.hgMag < 10;
  const x = z.pos.x, zz = z.pos.z;
  if (r < (lowAmmo ? 0.5 : 0.3)) dropItem('ammo', 5 + Math.floor(Math.random() * 4), x, zz);
  else if (r < 0.62) dropItem('gold', 50 + Math.floor(Math.random() * 11) * 10, x, zz);
  else if (inv.hasSg && r < 0.74) dropItem('shells', 2 + Math.floor(Math.random() * 3), x, zz);
  else if (r < 0.8 && player.hp < 60) dropItem('herb', 1, x, zz);
};

setCombatHooks({
  interact,
  hint: t => hint(t, 2.5),
  onHurt: d => damageFlash(d / 30),
  onHeal: () => toast('体力が回復した'),
  onGrab: () => once('grab', input.usingTouch ? '掴まれた！ ボタンを連打して振りほどけ' : '掴まれた！ E か Space を連打して振りほどけ', 3),
  onEscape: () => toast('振りほどいた！ 今なら蹴れる'),
  onPickup: (msg, kind) => { toast(msg); if (kind === 'shotgun') hint(input.usingTouch ? '「持替」で武器を切り替える' : 'Q で武器を切り替える', 4); },
  onDeath: () => { setTimeout(() => game.onDeath && game.onDeath(), 2600); },
});
export const zombieHooks = {
  hurt: (d, z) => hurtPlayer(d),
  knock: (d, z) => knockPlayer(d, z),
  grabbed: z => grabbedPlayer(),
  bossStunned: () => once('stun', '壁に激突して怯んだ！ 近づいて蹴れ', 3),
};
export function areaName() { return areaOf(player.pos.z); }
