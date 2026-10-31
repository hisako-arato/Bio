// 会話の場面とファイル（文書）の表示。文言は story.js から取る
import { SCENES, CHARACTERS, FILES } from './story.js';
import { sfx } from './audio.js';

const $ = id => document.getElementById(id);
const box = $('talk'), nameEl = box.querySelector('.who'), textEl = box.querySelector('.text');
const reader = $('fileview');

let cur = null;   // { lines, i, shown, done, typing }
const SPEED = 45; // 1秒に出す文字数

// 場面を流す。終わると解決する Promise を返す（場面が無ければすぐ解決）
export function playScene(id) {
  const lines = (SCENES[id] || []).filter(l => l && l[1]);
  if (!lines.length) return Promise.resolve();
  return new Promise(done => {
    cur = { lines, i: -1, done, typing: 0, len: 0 };
    box.classList.remove('hidden');
    next();
  });
}
function next() {
  if (!cur) return;
  if (cur.typing < cur.len) { cur.typing = cur.len; textEl.textContent = cur.text; return; }
  cur.i++;
  if (cur.i >= cur.lines.length) { finish(); return; }
  const [who, text] = cur.lines[cur.i];
  nameEl.textContent = who ? (CHARACTERS[who] || who) : '';
  nameEl.classList.toggle('hidden', !who);
  box.classList.toggle('narration', !who);
  cur.text = text; cur.len = text.length; cur.typing = 0;
  textEl.textContent = '';
}
function finish() {
  const d = cur && cur.done;
  cur = null;
  box.classList.add('hidden');
  if (d) d();
}
export const talking = () => !!cur;
// 毎フレーム：1文字ずつ出す
export function updateTalk(dt) {
  if (!cur || cur.typing >= cur.len) return;
  cur.typing = Math.min(cur.len, cur.typing + dt * SPEED);
  textEl.textContent = cur.text.slice(0, Math.floor(cur.typing));
}
box.addEventListener('pointerdown', e => { if (e.target.closest('.skip')) return; e.preventDefault(); next(); });
box.querySelector('.skip').addEventListener('pointerdown', e => { e.preventDefault(); e.stopPropagation(); finish(); });

// ---- ファイル ----
let readerDone = null;
export function showFile(id) {
  const f = FILES[id];
  if (!f) return Promise.resolve();
  reader.querySelector('h2').textContent = f.title;
  reader.querySelector('.body').textContent = f.body;
  reader.classList.remove('hidden');
  sfx.pickup();
  return new Promise(done => { readerDone = done; });
}
export const reading = () => !reader.classList.contains('hidden');
function closeReader() {
  reader.classList.add('hidden');
  const d = readerDone; readerDone = null;
  if (d) d();
}
reader.querySelector('button').addEventListener('click', closeReader);

// ファイルの一覧（一時停止の画面から開く）。have：持っているファイルの名前
export function fillFileList(have, onPick) {
  const list = $('fileList');
  list.innerHTML = '';
  const ids = Object.keys(FILES);
  for (const id of ids) {
    const b = document.createElement('button');
    const got = have.includes(id);
    b.textContent = got ? FILES[id].title : '？？？';
    b.disabled = !got;
    b.onclick = () => onPick(id);
    list.append(b);
  }
  $('fileCount').textContent = `${have.length} / ${ids.length}`;
}

// キーボード：会話は Space・Enter・E・クリックで進む、Esc で飛ばす。ファイルは同じキーで閉じる
addEventListener('keydown', e => {
  if (cur) {
    if (['Space', 'Enter', 'KeyE'].includes(e.code)) { e.preventDefault(); if (!e.repeat) next(); }
    if (e.code === 'Escape') finish();
    return;
  }
  if (reading() && ['Space', 'Enter', 'KeyE', 'Escape'].includes(e.code) && !e.repeat) { e.preventDefault(); closeReader(); }
});
