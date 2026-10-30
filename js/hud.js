// 画面の表示（体力・弾・所持金・目的・ヒント・ボスの体力）。値が変わったときだけ書き換える
import { player } from './player.js';
import { WEAPONS } from './combat.js';
import { input } from './input.js';

const $ = id => document.getElementById(id);
const el = {
  hpbar: $('hpbar'), hptext: $('hptext'), herbs: $('herbs'), weapon: $('weapon'), mag: $('mag'), reserve: $('reserve'), gold: $('gold'),
  objective: $('objective'), timer: $('timer'), bossbar: $('bossbar'), bosshp: $('bosshp'), cross: $('cross'), prompt: $('prompt'),
  hint: $('hint'), toasts: $('toasts'), vignette: $('vignette'), lowhp: $('lowhp'), mash: $('mash'),
  bAction: document.querySelector('.b-action'), bSwitch: document.querySelector('.b-switch'), bAim: document.querySelector('.b-aim'),
};
const last = {};
const put = (k, v, fn) => { if (last[k] !== v) { last[k] = v; fn(v); } };

export function updateHud(dt, extra) {
  const p = player, inv = p.inv;
  const hp = Math.max(0, Math.round(p.hp));
  put('hp', hp, v => {
    el.hpbar.style.width = v / p.maxHp * 100 + '%';
    el.hpbar.className = v < 30 ? 'low' : v < 60 ? 'mid' : '';
    el.hptext.textContent = v;
  });
  put('herbs', inv.herbs, v => el.herbs.textContent = v);
  put('weapon', p.weapon, v => el.weapon.textContent = WEAPONS[v].name);
  const mag = inv[p.weapon + 'Mag'], res = inv[p.weapon + 'Ammo'];
  put('mag', mag, v => { el.mag.textContent = v; el.mag.className = v === 0 ? 'empty' : ''; });
  put('res', res, v => el.reserve.textContent = v);
  put('gold', inv.gold, v => el.gold.textContent = v);
  put('aim', p.aimW > 0.5, v => { el.cross.className = v ? 'aim' : ''; el.bAim.classList.toggle('on', v); });
  put('sg', inv.hasSg, v => el.bSwitch.classList.toggle('hidden', !v));
  // 体力が少ないと画面の縁が赤く脈打つ
  const low = hp < 30 && p.state !== 'dead' ? 0.5 + Math.sin(performance.now() / 260) * 0.4 : 0;
  el.lowhp.style.opacity = low;
  // 文脈のボタン（蹴る・話す・調べる・連打）
  const label = extra.prompt || null;
  put('prompt', label, v => {
    el.prompt.classList.toggle('hidden', !v || input.usingTouch);
    if (v) el.prompt.textContent = (input.usingTouch ? '' : '[E] ') + v;
    el.bAction.classList.toggle('hidden', !v);
    if (v) el.bAction.textContent = v;
  });
  put('mash', extra.mash != null, v => el.mash.classList.toggle('hidden', !v));
  if (extra.mash != null) el.mash.querySelector('i').style.width = Math.min(100, extra.mash * 100) + '%';
  if (hintT > 0) { hintT -= dt; if (hintT <= 0) el.hint.classList.add('hidden'); }
}

export function objective(text) { el.objective.textContent = text || ''; }
export function timer(sec) {
  if (sec == null) { el.timer.classList.add('hidden'); return; }
  el.timer.classList.remove('hidden');
  const s = Math.max(0, Math.ceil(sec));
  el.timer.textContent = `${Math.floor(s / 60)}:${String(s % 60).padStart(2, '0')}`;
}
export function bossBar(z) {
  if (!z) { el.bossbar.classList.add('hidden'); return; }
  el.bossbar.classList.remove('hidden');
  el.bosshp.style.width = Math.max(0, z.hp / z.maxHp * 100) + '%';
}
let hintT = 0;
export function hint(text, sec = 4) { el.hint.textContent = text; el.hint.classList.remove('hidden'); hintT = sec; }
export function clearHint() { hintT = 0; el.hint.classList.add('hidden'); }
export function toast(text) {
  const d = document.createElement('div'); d.textContent = text;
  el.toasts.append(d);
  setTimeout(() => d.remove(), 2700);
  while (el.toasts.children.length > 4) el.toasts.firstChild.remove();
}
export function damageFlash(k = 1) {
  el.vignette.style.transition = 'none'; el.vignette.style.opacity = Math.min(1, 0.5 + k * 0.5);
  requestAnimationFrame(() => { el.vignette.style.transition = 'opacity .6s'; el.vignette.style.opacity = 0; });
}
export function resetHud() { for (const k in last) delete last[k]; clearHint(); el.toasts.innerHTML = ''; bossBar(null); timer(null); }
