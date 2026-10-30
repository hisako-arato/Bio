// 操作：スマホ（左の仮想スティック・右のドラッグで視点・ボタン）と PC（WASD・マウス）
import { canvas, isTouch } from './engine.js';

export const input = {
  mx: 0, my: 0,          // 移動（-1〜1、my は前がプラス）
  run: false,
  lookX: 0, lookY: 0,    // 視点の動き（このフレームの分、ラジアン相当の量）
  aimHeld: false,        // PC：右クリックを押している間
  aimToggle: false,      // スマホ：構えボタンで切り替え
  fireHeld: false,
  pressed: new Set(),    // このフレームに押されたボタン（fire reload knife switch heal action pause）
  enabled: false,
  usingTouch: isTouch,
};
export const settings = { sens: 1, invert: false, assist: isTouch, blood: 'high', quality: 'auto', volume: 0.8 };
try { Object.assign(settings, JSON.parse(localStorage.getItem('dusk-settings') || '{}')); } catch (e) {}
export function saveSettings() { try { localStorage.setItem('dusk-settings', JSON.stringify(settings)); } catch (e) {} }

const press = name => { if (input.enabled) input.pressed.add(name); };
export function consume(name) { const had = input.pressed.has(name); input.pressed.delete(name); return had; }
export function endFrame() { input.lookX = 0; input.lookY = 0; input.pressed.clear(); }
export const aiming = () => input.aimHeld || input.aimToggle;

// ---- PC ----
const keys = new Set();
const KEYMAP = { KeyR: 'reload', KeyF: 'knife', KeyV: 'knife', KeyQ: 'switch', Digit1: 'switch', Digit2: 'switch', KeyH: 'heal', KeyE: 'action', Space: 'action', Escape: 'pause', KeyP: 'pause' };
addEventListener('keydown', e => {
  if (e.repeat) return;
  keys.add(e.code);
  if (KEYMAP[e.code]) { press(KEYMAP[e.code]); if (e.code === 'Space') e.preventDefault(); }
  updateKeys();
});
addEventListener('keyup', e => { keys.delete(e.code); updateKeys(); });
addEventListener('blur', () => { keys.clear(); updateKeys(); input.aimHeld = false; input.fireHeld = false; });
function updateKeys() {
  if (input.usingTouch && !keys.size) return;
  const k = c => keys.has(c);
  input.mx = (k('KeyD') || k('ArrowRight') ? 1 : 0) - (k('KeyA') || k('ArrowLeft') ? 1 : 0);
  input.my = (k('KeyW') || k('ArrowUp') ? 1 : 0) - (k('KeyS') || k('ArrowDown') ? 1 : 0);
  const l = Math.hypot(input.mx, input.my); if (l > 1) { input.mx /= l; input.my /= l; }
  input.run = k('ShiftLeft') || k('ShiftRight');
}

export const pointer = { locked: false };
export function lockPointer() { if (!input.usingTouch && !navigator.webdriver && canvas.requestPointerLock) { try { const p = canvas.requestPointerLock(); if (p && p.catch) p.catch(() => {}); } catch (e) {} } }
export function unlockPointer() { if (document.pointerLockElement) document.exitPointerLock(); }
document.addEventListener('pointerlockchange', () => {
  pointer.locked = document.pointerLockElement === canvas;
  if (!pointer.locked && input.enabled && !input.usingTouch) press('pause');
});
canvas.addEventListener('mousedown', e => {
  if (input.usingTouch) return;
  if (!pointer.locked) { if (input.enabled) lockPointer(); return; }
  if (e.button === 0) { input.fireHeld = true; press('fire'); }
  if (e.button === 2) input.aimHeld = true;
});
addEventListener('mouseup', e => { if (e.button === 0) input.fireHeld = false; if (e.button === 2) input.aimHeld = false; });
canvas.addEventListener('contextmenu', e => e.preventDefault());
addEventListener('mousemove', e => {
  if (!pointer.locked) return;
  input.lookX += e.movementX * 0.0024 * settings.sens;
  input.lookY += e.movementY * 0.0024 * settings.sens * (settings.invert ? -1 : 1);
});

// ---- スマホ ----
const STICK_R = 56;
const stickEl = document.getElementById('stick'), knob = stickEl.querySelector('i');
const touches = new Map();   // id → { kind: 'stick'|'look'|'btn', x, y, ox, oy, btn }
function onStart(e) {
  if (!input.enabled) return;
  input.usingTouch = true;
  for (const t of e.changedTouches) {
    const btn = t.target.closest && t.target.closest('[data-btn]');
    if (btn) {
      const name = btn.dataset.btn;
      btn.classList.add('down');
      if (name === 'aim') input.aimToggle = !input.aimToggle;
      else press(name);
      if (name === 'fire') input.fireHeld = true;
      // 撃つボタンは、押したまま指を動かすと狙いも動かせる
      touches.set(t.identifier, { kind: name === 'fire' ? 'look' : 'btn', btn, x: t.clientX, y: t.clientY });
      continue;
    }
    const stickTaken = [...touches.values()].some(v => v.kind === 'stick');
    if (t.clientX < innerWidth * 0.42 && !stickTaken) {
      touches.set(t.identifier, { kind: 'stick', ox: t.clientX, oy: t.clientY });
      stickEl.style.left = t.clientX + 'px'; stickEl.style.top = t.clientY + 'px';
      stickEl.classList.add('on'); knob.style.transform = 'translate(-50%,-50%)';
    } else {
      touches.set(t.identifier, { kind: 'look', x: t.clientX, y: t.clientY });
    }
  }
  e.preventDefault();
}
function onMove(e) {
  for (const t of e.changedTouches) {
    const s = touches.get(t.identifier);
    if (!s) continue;
    if (s.kind === 'stick') {
      let dx = t.clientX - s.ox, dy = t.clientY - s.oy;
      const l = Math.hypot(dx, dy), m = Math.min(1, l / STICK_R);
      input.run = l > STICK_R * 1.15;
      if (l > 0) { dx = dx / l * m; dy = dy / l * m; }
      input.mx = dx; input.my = -dy;
      knob.style.transform = `translate(calc(-50% + ${dx * STICK_R}px), calc(-50% + ${dy * STICK_R}px))`;
    } else if (s.kind === 'look') {
      const k = 0.0058 * settings.sens;
      input.lookX += (t.clientX - s.x) * k;
      input.lookY += (t.clientY - s.y) * k * (settings.invert ? -1 : 1);
      s.x = t.clientX; s.y = t.clientY;
    }
  }
  e.preventDefault();
}
function onEnd(e) {
  for (const t of e.changedTouches) {
    const s = touches.get(t.identifier);
    if (!s) continue;
    if (s.btn) { s.btn.classList.remove('down'); if (s.btn.dataset.btn === 'fire') input.fireHeld = false; }
    if (s.kind === 'stick') { input.mx = input.my = 0; input.run = false; stickEl.classList.remove('on'); }
    touches.delete(t.identifier);
  }
}
const layer = document.getElementById('touch');
layer.addEventListener('touchstart', onStart, { passive: false });
addEventListener('touchmove', onMove, { passive: false });
addEventListener('touchend', onEnd);
addEventListener('touchcancel', onEnd);

export function resetInput() {
  input.mx = input.my = 0; input.run = false; input.aimHeld = false; input.aimToggle = false; input.fireHeld = false;
  input.pressed.clear(); touches.clear(); stickEl.classList.remove('on');
  document.querySelectorAll('[data-btn].down').forEach(b => b.classList.remove('down'));
}
