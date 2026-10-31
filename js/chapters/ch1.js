// 第1章 黄昏の村：村はずれの小道 → 広場で鐘が鳴るまで生き延びる → 商人の路地 → 教会の前で大男 → 教会の扉
import { spots, gates } from '../world.js';
import { placePlayer } from '../player.js';
import { bellLeave } from '../zombies.js';
import { timer } from '../hud.js';
import { quality } from '../engine.js';
import {
  game, once, setObjective, say, saveCheckpoint, placeMerchant, startBoss, endChapter,
  spawnZombie, clearZombies, alive, zombies, dropItem, items, hint, setTension, sfx, input, player,
} from '../game.js';

const SIEGE = 110;
// 場面を一度だけ流す（やり直しても繰り返さない）
const sayOnce = id => { if (game.flags['seen_' + id]) return Promise.resolve(); game.flags['seen_' + id] = true; return say(id); };

export default {
  id: 'ch1',
  next: 'ch2',
  par: 600,   // ランクの目安の時間（秒）
  phases: ['path', 'plaza', 'lane', 'yard'],
  region: () => ({ map: 'village', env: 'village' }),

  // 章の頭で一度だけ：散弾銃とファイルを置く
  setup() {
    if (!player.inv.hasSg) game.shotgunItem = dropItem('shotgun', 1, spots.shotgun.x, spots.shotgun.z, spots.shotgun.y);
    if (!game.files.includes('f_memo')) dropItem('file', 'f_memo', -3.4, 63.5);
    if (!game.files.includes('f_villager')) dropItem('file', 'f_villager', 3.2, -31);
  },

  enter(phase) {
    gates.plazaS.set(true); gates.plazaN.set(false);
    // 散弾銃を拾った後にやられたら、元の場所に戻す
    if (!player.inv.hasSg && (!game.shotgunItem || !items.includes(game.shotgunItem))) game.shotgunItem = dropItem('shotgun', 1, spots.shotgun.x, spots.shotgun.z, spots.shotgun.y);
    if (phase === 'path') {
      placePlayer(spots.start.x, spots.start.z, spots.start.yaw);
      setObjective('ch1_path');
      spawnZombie('m1', 0.5, 55, { facing: Math.PI });
      spawnZombie('m2', -2.5, 43, { facing: 0.5 });
      spawnZombie('father', 8, 46.5, { facing: -1.5 });
      game.flags.ambush = false;
      sayOnce('ch1_start').then(() => once('move', input.usingTouch ? '左側をなぞって移動、右側をなぞって見回す' : 'WASD で移動、マウスで見回す（画面をクリックで操作開始）', 6));
    }
    if (phase === 'plaza') {
      placePlayer(0, 21, 0);
      startSiege();
    }
    if (phase === 'lane') {
      gates.plazaN.set(true);
      placePlayer(0, -18, 0);
      placeMerchant(spots.merchant);
      setObjective('ch1_lane');
    }
    if (phase === 'yard') {
      gates.plazaN.set(true);
      placeMerchant(spots.merchant);
      placePlayer(1, -43, 0);
      bossFight();
    }
  },

  update(dt) {
    const z = player.pos.z, ph = game.phase;
    if (ph === 'path') {
      if (!game.flags.ambush && z < 40) {
        game.flags.ambush = true;
        // 家の陰から2体
        spawnZombie('f2', -9, 36, { aggro: true });
        spawnZombie('m1', 9.5, 31, { aggro: true });
      }
      if (zombies.some(zz => zz.pos.distanceTo(player.pos) < 14)) once('aim', input.usingTouch ? '「構え」で狙い、「撃つ」で撃つ。頭や脚を狙え' : '右クリックで構え、左クリックで撃つ。頭や脚を狙え', 5);
      if (z < 19) { saveCheckpoint('plaza'); startSiege(); }
    } else if (ph === 'plaza') {
      siegeStep(dt);
    } else if (ph === 'bell') {
      game.bellT += dt;
      // 見えなくなった者から消していく
      if (game.bellT > 4) for (const zz of [...zombies]) if (zz.state === 'leave' && !zz.rig.g.visible) zz.st = 99;
      if (game.bellT > 4 && alive() === 0 || game.bellT > 11) {
        clearZombies();
        gates.plazaN.set(true);
        placeMerchant(spots.merchant);
        setObjective('ch1_lane');
        hint('北の門が開いた。路地に誰かいる……', 4);
        game.phase = 'lane';
        saveCheckpoint('lane');
      }
    } else if (ph === 'lane') {
      if (z < -44) { saveCheckpoint('yard'); bossFight(); }
    } else if (ph === 'yard') {
      if (game.bossDead && Math.hypot(player.pos.x - spots.churchDoor.x, player.pos.z - spots.churchDoor.z) < 2.2) endChapter();
    }
  },
};

// ■ 広場：鐘が鳴るまで生き延びる
function startSiege() {
  game.phase = 'plaza';
  gates.plazaS.set(false);
  game.siegeT = SIEGE; game.spawnT = 1.5;
  setObjective('ch1_siege');
  setTension(0.7);
  // 最初の何体かは広場にいる
  spawnZombie('m1', -6, 4, { aggro: true, facing: 2 });
  spawnZombie('f2', 7, -6, { aggro: true, facing: -2 });
  spawnZombie('m2', 3, 9, { aggro: true });
  sayOnce('ch1_siege').then(() => hint('鐘が鳴るまで持ちこたえろ', 4));
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
  }
  if (game.siegeT <= SIEGE - 20) once('shotgun', '西の家の軒下に、何か光る物がある', 4);
  if (game.siegeT <= 0) {
    // 鐘が鳴り、ゾンビは去っていく
    timer(null);
    sfx.bell();
    bellLeave(spots.spawnsPlaza);
    setObjective('ch1_bell');
    setTension(0.15);
    game.phase = 'bell'; game.bellT = 0;
    setTimeout(() => sayOnce('ch1_bell'), 1500);
  }
}

// ■ 教会の前庭：大男
function bossFight() {
  game.phase = 'yard';
  setObjective('ch1_boss');
  startBoss({
    type: 'brute', x: 0, z: -70, name: '大男', reward: 1500,
    minions: { first: 8, every: 16, cap: 2, kinds: ['m1', 'm2', 'f2'], spawns: spots.spawnsYard },
    onDead: () => { setObjective('ch1_door'); hint('大男を倒した！ 教会の扉へ向かえ', 4); },
  });
  spawnZombie('m2', -9, -60, { aggro: true });
  spawnZombie('f1', 10, -64, { aggro: true });
  sayOnce('ch1_boss').then(() => hint('突進は横に避けろ。壁にぶつかって怯んだら蹴り飛ばせ', 5));
}
