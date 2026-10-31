// 進行役：章の切り替え・やり直し地点とセーブ・商人・会話・ファイル・ボス戦など、どの章でも使う仕組み
// 章ごとの中身（地図の上で何が起きるか）は js/chapters/ にある
import { THREE, scene, mat, setEnv } from './engine.js';
import { updateFlow, showRegion, resetBreakables } from './world.js';
import { player, freshInventory } from './player.js';
import { zombies, spawnZombie, clearZombies, alive, events, kickTarget, grab, damage } from './zombies.js';
import { stats, resetStats, setCombatHooks, hurtPlayer, knockPlayer, grabbedPlayer } from './combat.js';
import { dropItem, items, removeItem } from './items.js';
import { objective, bossBar, hint, toast, damageFlash, resetHud } from './hud.js';
import { sfx, setTension } from './audio.js';
import { input } from './input.js';
import { cam } from './camera.js';
import { clearDecals } from './fx.js';
import { OBJECTIVES, FILES } from './story.js';
import ch1 from './chapters/ch1.js';
import ch2 from './chapters/ch2.js';

export const CHAPTER_LIST = { ch1, ch2 };

export const game = {
  chapter: 'ch1', phase: '',
  checkpoint: null,      // { chapter, phase, inv, hp, weapon, files }
  t: 0,
  files: [],             // 拾ったファイル
  flags: {},             // 章の中の出来事（鍵を取った・石碑を調べた など）。やり直し地点に一緒に残す
  hints: new Set(),
  boss: null, bossDead: false,
  interactables: [],     // 調べる・話す・開ける場所 { x, z, r, label, act, on() }
  // main.js が中身を入れる
  onDeath: null, onChapterEnd: null, openShop: null, sayHook: null, fadeHook: null, showFileHook: null,
};
const chapter = () => CHAPTER_LIST[game.chapter];
export const once = (key, text, sec) => { if (game.hints.has(key)) return; game.hints.add(key); hint(text, sec); };
export const setObjective = key => objective(OBJECTIVES[key] ?? key);
// 会話の場面を流す（終わるまでゲームは止まる）。終わると解決する Promise
export const say = id => game.sayHook ? game.sayHook(id) : Promise.resolve();
// 暗転して fn を実行し、明ける
export const fade = (fn, text = '') => game.fadeHook ? game.fadeHook(fn, text) : (fn(), Promise.resolve());

// ---- 商人（フードをかぶった人影。手に提灯）。章ごとに置く場所を決める ----
export const merchant = new THREE.Group();
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
export function placeMerchant(at) {
  merchant.visible = !!at;
  if (at) merchant.position.set(at.x, 0, at.z);
}

// ---- やり直し地点とセーブ ----
const SAVE_KEY = 'dusk-save-v1';
export function saveCheckpoint(phase) {
  game.checkpoint = {
    chapter: game.chapter, phase, inv: { ...player.inv }, hp: Math.max(player.hp, 60), weapon: player.weapon,
    files: [...game.files], flags: { ...game.flags }, stats: { ...stats },
  };
  try { localStorage.setItem(SAVE_KEY, JSON.stringify(game.checkpoint)); } catch (e) {}
}
// 章の頭から始められるようにセーブだけしておく（章のクリア画面で使う）
export function saveForChapter(chapterId) {
  const save = { chapter: chapterId, phase: CHAPTER_LIST[chapterId].phases[0], inv: { ...player.inv }, hp: player.maxHp, weapon: player.weapon, files: [...game.files], flags: {}, stats: null, fresh: true };
  try { localStorage.setItem(SAVE_KEY, JSON.stringify(save)); } catch (e) {}
}
export function loadSave() {
  try { const s = JSON.parse(localStorage.getItem(SAVE_KEY) || 'null'); if (s && CHAPTER_LIST[s.chapter]) return s; } catch (e) {}
  return null;
}

// はじめから（chapterId を渡すとその章の頭から）
export function newGame(chapterId = 'ch1') {
  player.inv = freshInventory();
  player.hp = player.maxHp;
  player.weapon = 'hg';
  game.files = [];
  game.hints.clear();
  resetBreakables();
  startChapter(chapterId);
}
// 章の頭から始める（持ち物はそのまま）
export function startChapter(chapterId) {
  game.chapter = chapterId;
  game.flags = {};
  resetStats();
  for (const it of [...items]) removeItem(it);
  const ch = chapter();
  ch.setup && ch.setup();
  enterPhase(ch.phases[0], true);
}
// やられた／つづきから：やり直し地点から
export function continueGame(save = game.checkpoint) {
  const c = save;
  game.checkpoint = c;
  const changed = game.chapter !== c.chapter || !game.started;
  game.chapter = c.chapter;
  player.inv = { ...c.inv }; player.hp = c.hp; player.weapon = c.weapon;
  game.files = [...(c.files || [])];
  game.flags = { ...(c.flags || {}) };
  if (c.stats) Object.assign(stats, c.stats); else resetStats();
  if (changed) { for (const it of [...items]) removeItem(it); const ch = chapter(); ch.setup && ch.setup(); }
  enterPhase(c.phase, !!c.fresh);
}
export function jumpTo(chapterId, phase) {
  if (chapterId !== game.chapter || !game.started) { game.chapter = chapterId; for (const it of [...items]) removeItem(it); const ch = chapter(); ch.setup && ch.setup(); }
  enterPhase(phase || chapter().phases[0], true);
}
function resetPlayerState() {
  Object.assign(player, { state: 'normal', st: 0, invuln: 1, speed: 0, knockX: 0, knockZ: 0, didHit: false, fall: 0 });
  player.a.hurt = 0; player.a.recoil = 0;
  input.aimToggle = false;
  grab.z = null;
}
export function enterPhase(phase, fresh) {
  game.started = true;
  clearZombies();
  clearDecals();
  resetHud();
  resetPlayerState();
  game.phase = phase;
  game.boss = null; game.bossDead = false;
  game.interactables = [];
  placeMerchant(null);
  setTension(0.15);
  cam.override = null;
  const ch = chapter();
  const region = ch.region(phase);
  showRegion(region.map);
  setEnv(region.env);
  ch.enter(phase);
  if (fresh) saveCheckpoint(phase);
}
// 章の中で場所が変わる（暗転は呼ぶ側で）
export function setPlace(map, envName) { showRegion(map); setEnv(envName); }

// 章の終わり
export async function endChapter() {
  const ch = chapter();
  game.phase = 'end';
  await say(ch.id + '_end');
  game.onChapterEnd && game.onChapterEnd(ch);
}

// ---- ボス戦（どの章でも使う） ----
// opt：{ type, x, z, name, minions: { every, cap, kinds, spawns }, reward }
export function startBoss(opt) {
  game.bossOpt = opt;
  game.boss = spawnZombie(opt.type, opt.x, opt.z, { aggro: true, state: 'roar', facing: opt.facing ?? 0 });
  game.bossDead = false;
  game.minionT = opt.minions ? opt.minions.first ?? 8 : 0;
  bossBar(game.boss, opt.name);
  setTension(1);
}
function bossStep(dt) {
  const b = game.boss, opt = game.bossOpt;
  if (!b || game.bossDead) return;
  bossBar(b, opt.name);
  if (b.hp <= 0 || !zombies.includes(b)) {
    game.bossDead = true; bossBar(null);
    setTension(0.2);
    for (const z of [...zombies]) if (z !== b && z.state !== 'dying' && z.state !== 'dead') damage(z, 99, 'body', new THREE.Vector3(0, 0, 1), null, 'kick');
    if (opt.reward) dropItem('gold', opt.reward, b.pos.x, b.pos.z);
    opt.onDead && opt.onDead();
    return;
  }
  // 手下を少しずつ呼ぶ
  const m = opt.minions;
  if (!m) return;
  game.minionT -= dt;
  if (game.minionT <= 0) {
    game.minionT = m.every;
    if (alive() < m.cap + 1) {
      const sp = m.spawns[Math.floor(Math.random() * m.spawns.length)];
      spawnZombie(m.kinds[Math.floor(Math.random() * m.kinds.length)], sp.x, sp.z, { aggro: true });
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
  { id: 'sgpow', name: 'ショットガン改造：威力', desc: '威力 ×1.4', price: 1800, need: inv => inv.hasSg, once: inv => inv.sgPow > 1, buy: inv => { inv.sgPow = 1.4; } },
];

// ---- 毎フレーム ----
let flowT = 0, heartT = 0;
export function updateGame(dt) {
  game.t += dt;
  if (game.phase !== 'end') stats.time += dt;
  flowT -= dt;
  if (flowT <= 0) { flowT = 0.3; updateFlow(player.pos.x, player.pos.z); }
  if (game.phase !== 'end') chapter().update(dt);
  bossStep(dt);
  // 体力が少ないと心音
  if (player.hp < 30 && player.state !== 'dead') { heartT -= dt; if (heartT <= 0) { heartT = 0.9; sfx.heart(); } }
  // 商人はプレイヤーの方を向く
  if (merchant.visible) merchant.rotation.y = Math.atan2(player.pos.x - merchant.position.x, player.pos.z - merchant.position.z);
  // 共通のヒント
  const kt = player.state === 'normal' && kickTarget(player.pos.x, player.pos.z, player.facing);
  if (kt) once('kick', 'ひるんだ敵は蹴り飛ばせる（まとめて倒せる）', 4);
  if (player.inv.hgMag === 0 && player.inv.hgAmmo === 0 && player.weapon === 'hg') once('noammo', '弾切れだ。ナイフで木箱や樽を壊すと、中身が出ることがある', 5);
}

// 今押せる「蹴る・話す・調べる」
function nearInteract() {
  if (merchant.visible && Math.hypot(player.pos.x - merchant.position.x, player.pos.z - merchant.position.z) < 2.2) return { label: '話す', act: openMerchant };
  let best = null, bd = 1e9;
  for (const it of game.interactables) {
    if (it.on && !it.on()) continue;
    const d = Math.hypot(player.pos.x - it.x, player.pos.z - it.z);
    if (d < (it.r || 1.8) && d < bd) { bd = d; best = it; }
  }
  return best;
}
export function contextPrompt() {
  if (player.state === 'grabbed') return '連打！';
  if (player.state !== 'normal' || game.phase === 'end') return null;
  if (kickTarget(player.pos.x, player.pos.z, player.facing)) return '蹴る';
  const it = nearInteract();
  return it ? it.label : null;
}
export function interact() {
  const it = nearInteract();
  if (!it) return false;
  it.act();
  return true;
}
function openMerchant() {
  // 初めて会ったときだけ挨拶する
  if (!game.flags.metMerchant) { game.flags.metMerchant = true; say(game.chapter + '_merchant').then(() => game.openShop && game.openShop()); }
  else game.openShop && game.openShop();
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
  onFile: id => {
    if (!game.files.includes(id)) game.files.push(id);
    toast(`ファイル「${FILES[id] ? FILES[id].title : id}」`);
    once('files', '読んだファイルは、一時停止の「ファイル」で読み返せる', 4);
    game.showFileHook && game.showFileHook(id);
  },
  onDeath: () => { setTimeout(() => game.onDeath && game.onDeath(), 2600); },
});
export const zombieHooks = {
  hurt: (d, z) => hurtPlayer(d),
  knock: (d, z) => knockPlayer(d, z),
  grabbed: z => grabbedPlayer(),
  bossStunned: () => once('stun', '壁や柱に激突して怯んだ！ 近づいて蹴れ', 3),
};

// 章の中身から使う道具
export { spawnZombie, clearZombies, alive, zombies, dropItem, items, removeItem, hint, toast, setTension, sfx, input, player, cam, resetBreakables };
