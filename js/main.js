// 起動・読み込み・画面の切り替え・毎フレームの処理
import { scene, camera, makeRenderer, pickQuality, isTouch, setEnv } from './engine.js';
import { buildWorld, updateWorld, rebuildNav, regions } from './world.js';
import { buildChurch } from './world2.js';
import { loadVRM, prepareZombieMaster } from './vrm.js';
import { player, setupPlayer, updatePlayer } from './player.js';
import { masters, TYPES, updateZombies } from './zombies.js';
import { updateCombat, stats } from './combat.js';
import { updateCamera, cam } from './camera.js';
import { updateFx } from './fx.js';
import { updateItems } from './items.js';
import { updateHud } from './hud.js';
import { game, newGame, startChapter, continueGame, updateGame, contextPrompt, zombieHooks, SHOP, jumpTo, loadSave, saveForChapter, CHAPTER_LIST } from './game.js';
import { playScene, updateTalk, showFile, fillFileList } from './talk.js';
import { CHAPTERS } from './story.js';
import { updateTorch } from './chapters/ch2.js';
import { input, settings, saveSettings, consume, endFrame, resetInput, lockPointer, unlockPointer } from './input.js';
import { grab } from './zombies.js';
import { unlockAudio, startAmbient, setListener, setVolume, sfx } from './audio.js';

const $ = id => document.getElementById(id);
const screens = ['loading', 'title', 'howto', 'settings', 'intro', 'pause', 'shop', 'death', 'result', 'error', 'files'];
function show(id) { for (const s of screens) $(s).classList.toggle('hidden', s !== id); }
let mode = 'menu';   // menu | play | paused | talk（会話・ファイル） | fade（暗転）
let renderer;

function setPlaying(on, hud = on) {
  $('hud').classList.toggle('hidden', !hud);
  $('touch').classList.toggle('hidden', !on || !input.usingTouch);
  input.enabled = on;
  if (!on) resetInput();
}

// ---- 読み込み ----
async function boot() {
  pickQuality(settings.quality);
  renderer = makeRenderer();
  buildWorld();
  buildChurch();
  rebuildNav();
  // 建物の影を一度だけ描く
  renderer.shadowMap.needsUpdate = true;
  const models = [...new Set(Object.values(TYPES).map(t => t.model))];
  const files = [{ url: 'assets/vrm/player/black.vrm', kind: 'player' }, ...models.map(m => ({ url: `assets/vrm/zombie/${m}.vrm`, kind: m }))];
  const prog = new Array(files.length).fill(0);
  const tell = () => { const v = prog.reduce((a, b) => a + b, 0) / files.length; $('loadBar').style.width = v * 100 + '%'; };
  await Promise.all(files.map(async (f, i) => {
    const vrm = await loadVRM(f.url, v => { prog[i] = v; tell(); });
    prog[i] = 1; tell();
    if (f.kind === 'player') setupPlayer(vrm);
    else masters[f.kind] = prepareZombieMaster(vrm);
  }));
  // 最初の描画で材質を組み立てておく（遊び始めてから止まらないように）
  player.pos.set(0, 0, 74);
  updateCamera(0, player.pos, 0, player.headY);
  regions.church.visible = true;
  renderer.compile(scene, camera);
  regions.church.visible = false;
  refreshTitle();
  show('title');
  document.title = 'ready';
  requestAnimationFrame(loop);
}

// ---- 毎フレーム ----
let lastT = performance.now(), attract = 0;
function loop(now) {
  requestAnimationFrame(loop);
  let dt = Math.min(0.05, (now - lastT) / 1000);
  lastT = now;
  if (mode === 'play') {
    if (queue.length) runQueue();
    else if (consume('pause')) { pause(); }
    else step(dt);
  } else if (mode === 'talk' || mode === 'fade') {
    // 会話・暗転の間も、主人公の姿勢・カメラ・炎や血は動かす
    updateTalk(dt);
    updatePlayer(dt);
    updateCamera(dt, player.pos, player.aimW, player.headY + 0.05 - player.fall * 1.0);
    updateWorld(game.t += dt);
    updateFx(dt);
    updateItems(dt);
  } else if (mode === 'menu') {
    // タイトルの裏：村をゆっくり見回す
    attract += dt * 0.05;
    camera.position.set(Math.sin(attract) * 6, 3.2, 20 + Math.cos(attract) * 4);
    camera.lookAt(0, 1.5, 0);
    updateWorld(now / 1000);
  }
  renderer.render(scene, camera);
  endFrame();
}
function step(dt) {
  updateCombat(dt);
  updatePlayer(dt);
  updateZombies(dt, zombieHooks);
  updateGame(dt);
  updateTorch();
  updateCamera(dt, player.pos, player.aimW, player.headY + 0.05 - player.fall * 1.0);
  updateWorld(game.t);
  updateFx(dt);
  updateItems(dt);
  setListener(player.pos.x, player.pos.z, cam.yaw);
  updateHud(dt, { prompt: contextPrompt(), mash: player.state === 'grabbed' ? grab.mash / 7 : null });
}

// ---- 画面の操作 ----
function startPlay() {
  mode = 'play';
  show(null);
  setPlaying(true);
  lastT = performance.now();
  lockPointer();
}
function pause() {
  if (mode !== 'play') return;
  mode = 'paused';
  setPlaying(false);
  unlockPointer();
  show('pause');
}
function toTitle() {
  mode = 'menu';
  refreshTitle();
  setPlace0();
  setPlaying(false);
  unlockPointer();
  show('title');
}
// タイトルの裏は村を映す
function setPlace0() { regions.village.visible = true; regions.church.visible = false; setEnv('village'); }
async function enterFullscreen() {
  if (!isTouch) return;
  try { if (!document.fullscreenElement && document.documentElement.requestFullscreen) await document.documentElement.requestFullscreen({ navigationUI: 'hide' }); } catch (e) {}
  try { if (screen.orientation && screen.orientation.lock) await screen.orientation.lock('landscape'); } catch (e) {}
}

// ---- 会話・ファイル・暗転（遊んでいる最中に起きる。終わると遊びに戻る） ----
const queue = [];   // { kind: 'talk'|'file', id, done }
game.sayHook = id => new Promise(done => { queue.push({ kind: 'talk', id, done }); if (mode === 'play') runQueue(); });
game.showFileHook = id => new Promise(done => { queue.push({ kind: 'file', id, done }); if (mode === 'play') runQueue(); });
function runQueue() {
  const q = queue.shift();
  if (!q) return;
  mode = 'talk';
  setPlaying(false, q.kind === 'talk');
  unlockPointer();
  const p = q.kind === 'talk' ? playScene(q.id) : showFile(q.id);
  p.then(() => {
    q.done();
    if (mode !== 'talk') return;
    if (queue.length) { runQueue(); return; }
    mode = 'play'; setPlaying(true); lastT = performance.now(); lockPointer();
  });
}
game.fadeHook = (fn, text) => new Promise(done => {
  mode = 'fade';
  setPlaying(false);
  $('fadeText').textContent = text || '';
  $('fade').classList.add('on');
  setTimeout(() => {
    fn();
    setTimeout(() => {
      $('fade').classList.remove('on');
      mode = 'play'; setPlaying(true); lastT = performance.now();
      done();
    }, text ? 1100 : 300);
  }, 550);
});

// ---- 章の始まりの画面 ----
let introThen = null;
function showIntro(chId, then) {
  const c = CHAPTERS[chId] || {};
  $('introTitle').textContent = c.title || '';
  $('introBody').innerHTML = '';
  for (const line of c.intro || []) { const p = document.createElement('p'); p.textContent = line; $('introBody').append(p); }
  if (c.goal) { const p = document.createElement('p'); p.className = 'goal'; p.textContent = c.goal; $('introBody').append(p); }
  introThen = then;
  show('intro');
}
function refreshTitle() {
  const s = loadSave();
  $('btnContinueSave').classList.toggle('hidden', !s);
  $('btnStart').classList.toggle('primary', !s);
  if (s) $('btnContinueSave').textContent = `つづきから（${(CHAPTERS[s.chapter] || {}).title || s.chapter}）`;
}
$('btnStart').onclick = async () => {
  unlockAudio(); startAmbient(); sfx.ui();
  await enterFullscreen();
  showIntro('ch1', () => newGame('ch1'));
};
$('btnContinueSave').onclick = async () => {
  unlockAudio(); startAmbient(); sfx.ui();
  await enterFullscreen();
  const s = loadSave();
  if (!s) { refreshTitle(); return; }
  continueGame(s);
  startPlay();
};
$('btnGo').onclick = () => {
  sfx.ui();
  const then = introThen; introThen = null;
  startPlay();
  if (then) then();
};
$('btnFiles').onclick = () => { sfx.ui(); openFiles(); };
$('btnFilesBack').onclick = () => { sfx.ui(); show('pause'); };
function openFiles() {
  fillFileList(game.files, id => showFile(id));
  show('files');
}
let backTo = 'title';
$('btnHowto').onclick = () => { backTo = 'title'; show('howto'); };
$('btnSettings').onclick = () => { backTo = 'title'; openSettings(); };
$('btnPHowto').onclick = () => { backTo = 'pause'; show('howto'); };
$('btnPSettings').onclick = () => { backTo = 'pause'; openSettings(); };
document.querySelectorAll('.back').forEach(b => b.onclick = () => { sfx.ui(); show(backTo); });
$('btnResume').onclick = () => { sfx.ui(); startPlay(); };
$('btnRetry').onclick = () => { sfx.ui(); continueGame(); startPlay(); };
$('btnQuit').onclick = () => { sfx.ui(); toTitle(); };
$('btnContinue').onclick = () => { sfx.ui(); continueGame(); startPlay(); };
$('btnDeathQuit').onclick = () => { sfx.ui(); toTitle(); };
$('btnResultTitle').onclick = () => { sfx.ui(); toTitle(); };
$('btnNext').onclick = () => {
  sfx.ui();
  const next = $('btnNext').dataset.next;
  if (next) showIntro(next, () => startChapter(next));
};
document.querySelector('.b-pause').addEventListener('touchstart', e => { e.stopPropagation(); e.preventDefault(); pause(); }, { passive: false });

game.onDeath = () => {
  if (mode !== 'play') return;
  mode = 'paused';
  setPlaying(false);
  unlockPointer();
  show('death');
};
game.onChapterEnd = ch => {
  mode = 'paused';
  setPlaying(false);
  unlockPointer();
  // 次の章の頭をセーブしておく（ここでやめても、つづきから次の章を遊べる）
  if (ch.next) saveForChapter(ch.next);
  const c = CHAPTERS[ch.id] || {};
  $('resultTitle').textContent = `${c.title || ch.id}　クリア`;
  $('resultSub').textContent = ch.next ? (c.outro || '') : `${c.outro || ''}　――続きは製作中です。`;
  $('btnNext').classList.toggle('hidden', !ch.next);
  $('btnNext').dataset.next = ch.next || '';
  const par = ch.par || 600;
  const acc = stats.shots ? Math.round(stats.hits / stats.shots * 100) : 0;
  const min = Math.floor(stats.time / 60), sec = Math.floor(stats.time % 60);
  // ランク：時間・命中率・やられた回数
  let score = 0;
  score += stats.time < par ? 2 : stats.time < par * 1.5 ? 1 : 0;
  score += acc >= 60 ? 2 : acc >= 40 ? 1 : 0;
  score += stats.deaths === 0 ? 2 : stats.deaths < 3 ? 1 : 0;
  const rank = score >= 6 ? 'S' : score >= 4 ? 'A' : score >= 2 ? 'B' : 'C';
  $('resultBody').innerHTML = `
    <span>クリア時間</span><b>${min}分${String(sec).padStart(2, '0')}秒</b>
    <span>倒した数</span><b>${stats.kills}</b>
    <span>命中率</span><b>${acc}%</b>
    <span>頭への命中</span><b>${stats.heads}</b>
    <span>やられた回数</span><b>${stats.deaths}</b>
    <span>所持金</span><b>${player.inv.gold} G</b>
    <div class="rank">${rank}</div>`;
  show('result');
};

// ---- 商人 ----
const SAY = ['「よう、旅の人……何か要るかい？」', '「いい品が揃ってるぜ」', '「ひっひっ……毎度あり」'];
game.openShop = () => {
  mode = 'paused';
  setPlaying(false);
  unlockPointer();
  $('shopSay').textContent = SAY[0];
  renderShop();
  show('shop');
};
function renderShop() {
  const inv = player.inv;
  $('shopGold').textContent = inv.gold;
  const list = $('shopList');
  list.innerHTML = '';
  for (const it of SHOP) {
    if (it.need && !it.need(inv)) continue;
    const done = it.once && it.once(inv);
    const b = document.createElement('button');
    b.innerHTML = `<span>${it.name}${it.desc ? `<small>${it.desc}</small>` : ''}</span><span class="price">${done ? '済み' : it.price + ' G'}</span>`;
    b.disabled = done || inv.gold < it.price;
    b.onclick = () => {
      if (inv.gold < it.price) return;
      inv.gold -= it.price; it.buy(inv); sfx.buy();
      $('shopSay').textContent = SAY[1 + Math.floor(Math.random() * 2)];
      renderShop();
    };
    list.append(b);
  }
}
$('btnShopClose').onclick = () => { sfx.ui(); startPlay(); };

// ---- 設定 ----
function openSettings() {
  $('setSens').value = settings.sens; $('setSensV').textContent = (+settings.sens).toFixed(1);
  $('setInvert').checked = settings.invert; $('setAssist').checked = settings.assist;
  $('setBlood').value = settings.blood; $('setQuality').value = settings.quality; $('setVolume').value = settings.volume;
  show('settings');
}
$('setSens').oninput = e => { settings.sens = +e.target.value; $('setSensV').textContent = settings.sens.toFixed(1); saveSettings(); };
$('setInvert').onchange = e => { settings.invert = e.target.checked; saveSettings(); };
$('setAssist').onchange = e => { settings.assist = e.target.checked; saveSettings(); };
$('setBlood').onchange = e => { settings.blood = e.target.value; saveSettings(); };
$('setQuality').onchange = e => { settings.quality = e.target.value; saveSettings(); };
$('setVolume').oninput = e => { settings.volume = +e.target.value; setVolume(settings.volume); saveSettings(); };

// 縦向きのスマホでは、横向きにするよう伝える
function checkRotate() { $('rotate').classList.toggle('hidden', !(isTouch && innerHeight > innerWidth)); }
addEventListener('resize', checkRotate); checkRotate();
document.addEventListener('visibilitychange', () => { if (document.hidden) pause(); });

// 動作確認用：描画せずに時間を進める（sim）・場面を飛ばす（jump）・1コマの重さを測る（bench）
window.__game = {
  game, player, stats, cam, input,
  sim(sec, fps = 30) { for (let i = 0; i < sec * fps; i++) { step(1 / fps); endFrame(); } },
  jump(ch, phase) { jumpTo(ch, phase); },
  bench(n = 10) { const t = performance.now(); for (let i = 0; i < n; i++) renderer.render(scene, camera); return (performance.now() - t) / n; },
};

boot().catch(e => {
  console.error(e);
  $('errorText').textContent = String(e && e.message || e);
  show('error');
});
