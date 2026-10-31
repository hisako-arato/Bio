// 第2章 沈黙の教会：礼拝堂で祭壇の鍵を取る → 襲撃を退ける → 地下墓所で封印の石碑を3つ → 納骨堂で墓守 → 出口
import { gates } from '../world.js';
import { spots2, steles } from '../world2.js';
import { placePlayer } from '../player.js';
import { candles, env, torch } from '../engine.js';
import { objective } from '../hud.js';
import { OBJECTIVES } from '../story.js';
import {
  game, once, setObjective, say, fade, saveCheckpoint, enterPhase, setPlace, placeMerchant, startBoss, endChapter,
  spawnZombie, alive, zombies, dropItem, hint, toast, setTension, sfx, player, cam,
} from '../game.js';

const sayOnce = id => { if (game.flags['seen_' + id]) return Promise.resolve(); game.flags['seen_' + id] = true; return say(id); };
const AMBUSH = 9;   // 礼拝堂の襲撃で出てくる数

function lightCandles(list) {
  candles.forEach((c, i) => {
    const p = list[i];
    c.intensity = p ? 16 : 0; c.userData.base = c.intensity;
    if (p) c.position.set(p.x, p.y, p.z);
  });
}
const sealCount = () => steles.filter((s, i) => game.flags['seal' + i]).length;
function sealObjective() { objective(`${OBJECTIVES.ch2_seals}（${sealCount()}/${steles.length}）`); }

export default {
  id: 'ch2',
  next: null,       // 第3章ができたら 'ch3'
  par: 660,
  phases: ['nave', 'crypt', 'ossuary'],
  region: phase => ({ map: 'church', env: phase === 'nave' ? 'church' : phase }),

  setup() {
    if (!game.files.includes('f_priest')) dropItem('file', 'f_priest', spots2.priestFile.x, spots2.priestFile.z, spots2.priestFile.y);
    if (!game.files.includes('f_crypt')) dropItem('file', 'f_crypt', spots2.cryptFile.x, spots2.cryptFile.z);
  },

  enter(phase) {
    for (const n of ['sideW', 'sideE', 'sideE2']) gates[n].set(!!game.flags.ambush);
    gates.cryptDoor.set(!!game.flags.cryptOpen);
    gates.crypt.set(sealCount() >= steles.length);
    gates.ossExit.set(false);
    steles.forEach((s, i) => { s.done = !!game.flags['seal' + i]; for (const r of s.runes) r.visible = !s.done; });

    if (phase === 'nave') {
      lightCandles(spots2.naveCandles);
      placePlayer(spots2.naveStart.x, spots2.naveStart.z, spots2.naveStart.yaw);
      game.interactables = [
        { x: spots2.altar.x, z: spots2.altar.z, r: 2.2, label: '調べる', on: () => !game.flags.key, act: takeKey },
        { x: spots2.cryptDoor.x, z: spots2.cryptDoor.z, r: 2.4, label: '開ける', on: () => game.flags.ambushDone && !game.flags.cryptOpen, act: openCrypt },
      ];
      if (game.flags.ambushDone) setObjective('ch2_door');
      else {
        setObjective('ch2_altar');
        game.flags.key = false; game.flags.ambush = false;
        // 長椅子の陰に、動かない者がいる
        spawnZombie('m1', 150, -6, { facing: Math.PI });
        spawnZombie('f2', 141.2, -18, { facing: 0.4 });
        spawnZombie('father', 158.8, -2, { facing: -2 });
      }
      sayOnce('ch2_enter');
    }
    if (phase === 'crypt') {
      enterCrypt();
      placePlayer(spots2.cryptStart.x, spots2.cryptStart.z, spots2.cryptStart.yaw);
    }
    if (phase === 'ossuary') {
      gates.crypt.set(true);
      lightCandles(spots2.ossCandles);
      placePlayer(spots2.ossStart.x, spots2.ossStart.z, spots2.ossStart.yaw);
      bossFight();
    }
  },

  update(dt) {
    const ph = game.phase;
    // ろうそくの火が揺れる
    for (const c of candles) if (c.userData.base) c.intensity = c.userData.base * (0.85 + Math.random() * 0.2);
    if (ph === 'nave' && game.flags.ambush && !game.flags.ambushDone) ambushStep(dt);
    if (ph === 'crypt') {
      if (sealCount() >= steles.length && player.pos.z < -87) { saveCheckpoint('ossuary'); bossFight(); }
    }
    if (ph === 'ossuary') {
      if (game.bossDead && player.pos.z < spots2.ossExit.z + 1.5) endChapter();
    }
  },
};

// ■ 礼拝堂
function takeKey() {
  game.flags.key = true;
  sfx.pickup();
  toast('地下の鍵');
  say('ch2_altar').then(startAmbush);
}
function startAmbush() {
  game.flags.ambush = true; game.ambushLeft = AMBUSH; game.ambushT = 0.5;
  for (const n of ['sideW', 'sideE', 'sideE2']) gates[n].set(true);
  sfx.crate({ x: 140, z: -10 }); sfx.crate({ x: 160, z: 2 });
  cam.shake = 0.5;
  setObjective('ch2_ambush');
  setTension(0.85);
  for (const z of zombies) z.aggro = true;
  hint('側面の扉が破られた！', 3);
}
function ambushStep(dt) {
  game.ambushT -= dt;
  if (game.ambushLeft > 0 && game.ambushT <= 0 && alive() < 5) {
    game.ambushT = 2.2 + Math.random() * 1.5;
    game.ambushLeft--;
    const sp = spots2.naveSpawns[Math.floor(Math.random() * spots2.naveSpawns.length)];
    const kinds = ['m1', 'm2', 'f1', 'f2', 'father', 'crawler'];
    spawnZombie(kinds[Math.floor(Math.random() * kinds.length)], sp.x + (Math.random() - 0.5), sp.z + (Math.random() - 0.5), { aggro: true });
  }
  if (game.ambushLeft <= 0 && alive() === 0) {
    game.flags.ambushDone = true;
    setTension(0.2);
    setObjective('ch2_door');
    saveCheckpoint('nave');
    sayOnce('ch2_ambush_end');
  }
}
function openCrypt() {
  game.flags.cryptOpen = true;
  sfx.reload();
  fade(() => enterPhase('crypt', true), '地下墓所');
}

// ■ 地下墓所
function enterCrypt() {
  game.phase = 'crypt';
  lightCandles(spots2.cryptCandles);
  placeMerchant(spots2.cryptMerchant);
  sealObjective();
  for (const p of spots2.cryptR) spawnZombie(Math.random() < 0.5 ? 'crawler' : 'crawlerF', p.x, p.z, { facing: Math.random() * 6 });
  for (const p of spots2.cryptZ) spawnZombie(['m1', 'm2', 'father'][Math.floor(Math.random() * 3)], p.x, p.z, { facing: Math.random() * 6 });
  game.interactables = steles.map((s, i) => ({ x: s.x, z: s.z, r: 2.0, label: '調べる', on: () => !game.flags['seal' + i], act: () => breakSeal(i) }));
  sayOnce('ch2_crypt').then(() => once('torch', '暗い場所では、懐中電灯が向いている方を照らす', 4));
}
function breakSeal(i) {
  const s = steles[i];
  game.flags['seal' + i] = true; s.done = true;
  for (const r of s.runes) r.visible = false;
  sfx.stomp(s); cam.shake = 0.35;
  sealObjective();
  // 石碑を調べると、どこかで何かが目を覚ます
  const far = spots2.cryptSpawns.filter(p => Math.hypot(p.x - player.pos.x, p.z - player.pos.z) > 10);
  for (let k = 0; k < 2 && far.length; k++) {
    const p = far.splice(Math.floor(Math.random() * far.length), 1)[0];
    spawnZombie(['crawler', 'm1', 'f1', 'm2'][Math.floor(Math.random() * 4)], p.x, p.z, { aggro: true });
  }
  if (sealCount() >= steles.length) {
    gates.crypt.set(true);
    setObjective('ch2_gate');
    saveCheckpoint('crypt');
    say('ch2_seal_done');
  } else toast(`封印を解いた（${sealCount()}/${steles.length}）`);
}

// ■ 納骨堂：墓守
function bossFight() {
  game.phase = 'ossuary';
  setPlace('church', 'ossuary');
  lightCandles(spots2.ossCandles);
  gates.crypt.set(false);
  setObjective('ch2_boss');
  startBoss({
    type: 'warden', x: spots2.boss.x, z: spots2.boss.z, name: '墓守', reward: 2000, facing: Math.PI,
    minions: { first: 10, every: 14, cap: 2, kinds: ['crawler', 'crawlerF', 'm1'], spawns: spots2.ossSpawns },
    onDead: () => {
      gates.ossExit.set(true);
      setObjective('ch2_exit');
      hint('墓守を倒した！ 奥の扉が開いた', 4);
    },
  });
  sayOnce('ch2_boss').then(() => hint('柱を背にして突進を誘え。柱に激突したら蹴れ', 5));
}

// 暗い場所の懐中電灯（main の毎フレームから呼ぶ）
export function updateTorch() {
  if (!env.torch || player.state === 'dead') { torch.intensity = 0; return; }
  torch.intensity = 45;
  torch.position.set(player.pos.x, 1.5, player.pos.z);
  if (player.aimW > 0.5) torch.target.position.copy(player.aimPoint);
  else torch.target.position.set(player.pos.x + cam.dir.x * 8, 1.0 + cam.dir.y * 8, player.pos.z + cam.dir.z * 8);
  torch.target.updateMatrixWorld();
}
