// 音：すべて Web Audio で合成する（音のファイルは使わない）
import { settings } from './input.js';

let ctx = null, master = null, noiseBuf = null, ambient = null;
export function unlockAudio() {
  if (!ctx) {
    const AC = window.AudioContext || window.webkitAudioContext;
    if (!AC) return;
    ctx = new AC();
    master = ctx.createGain(); master.gain.value = settings.volume; master.connect(ctx.destination);
    noiseBuf = ctx.createBuffer(1, ctx.sampleRate * 2, ctx.sampleRate);
    const d = noiseBuf.getChannelData(0);
    for (let i = 0; i < d.length; i++) d[i] = Math.random() * 2 - 1;
  }
  if (ctx.state === 'suspended') ctx.resume();
}
export function setVolume(v) { if (master) master.gain.value = v; }

// 音の出口：距離で小さく、左右に振る（pos：音の位置、listener：耳の位置と向き）
const ear = { x: 0, z: 0, yaw: 0 };
export function setListener(x, z, yaw) { ear.x = x; ear.z = z; ear.yaw = yaw; }
function out(gain = 1, pos = null, range = 30) {
  const g = ctx.createGain();
  let v = gain;
  if (pos) {
    const dx = pos.x - ear.x, dz = pos.z - ear.z, d = Math.hypot(dx, dz);
    v *= Math.max(0, 1 - d / range) ** 1.6;
    const p = ctx.createStereoPanner ? ctx.createStereoPanner() : null;
    if (p) {
      // カメラの右向き（cos yaw, -sin yaw）との内積
      p.pan.value = d > 0.1 ? Math.max(-0.9, Math.min(0.9, (dx * Math.cos(ear.yaw) - dz * Math.sin(ear.yaw)) / d)) : 0;
      g.connect(p); p.connect(master);
    } else g.connect(master);
  } else g.connect(master);
  g.gain.value = v;
  return v > 0.002 ? g : null;
}
function noise(dest, t0, dur, { type = 'lowpass', f0 = 2000, f1 = 300, q = 0.7, a = 0.002, vol = 1 } = {}) {
  const s = ctx.createBufferSource(); s.buffer = noiseBuf; s.loop = true;
  const f = ctx.createBiquadFilter(); f.type = type; f.Q.value = q;
  f.frequency.setValueAtTime(f0, t0); f.frequency.exponentialRampToValueAtTime(Math.max(20, f1), t0 + dur);
  const g = ctx.createGain();
  g.gain.setValueAtTime(0, t0); g.gain.linearRampToValueAtTime(vol, t0 + a); g.gain.exponentialRampToValueAtTime(0.001, t0 + dur);
  s.connect(f); f.connect(g); g.connect(dest);
  s.start(t0, Math.random()); s.stop(t0 + dur + 0.05);
}
function tone(dest, t0, dur, { type = 'sine', f0 = 440, f1 = null, vol = 0.5, a = 0.005 } = {}) {
  const o = ctx.createOscillator(); o.type = type;
  o.frequency.setValueAtTime(f0, t0); if (f1) o.frequency.exponentialRampToValueAtTime(f1, t0 + dur);
  const g = ctx.createGain();
  g.gain.setValueAtTime(0, t0); g.gain.linearRampToValueAtTime(vol, t0 + a); g.gain.exponentialRampToValueAtTime(0.001, t0 + dur);
  o.connect(g); g.connect(dest); o.start(t0); o.stop(t0 + dur + 0.05);
}

export const sfx = {
  handgun() {
    if (!ctx) return; const t = ctx.currentTime, o = out(0.9);
    noise(o, t, 0.28, { f0: 5000, f1: 200, vol: 1 }); tone(o, t, 0.12, { type: 'square', f0: 160, f1: 50, vol: 0.4 });
  },
  shotgun() {
    if (!ctx) return; const t = ctx.currentTime, o = out(1);
    noise(o, t, 0.6, { f0: 3500, f1: 90, vol: 1.2 }); tone(o, t, 0.3, { type: 'sawtooth', f0: 110, f1: 35, vol: 0.6 });
    noise(o, t + 0.35, 0.12, { type: 'bandpass', f0: 1800, f1: 1200, q: 4, vol: 0.4 });   // 先台を引く音
  },
  empty() { if (!ctx) return; const t = ctx.currentTime; noise(out(0.5), t, 0.05, { type: 'bandpass', f0: 3000, f1: 2500, q: 6 }); },
  reload() {
    if (!ctx) return; const t = ctx.currentTime, o = out(0.5);
    noise(o, t + 0.1, 0.06, { type: 'bandpass', f0: 1500, f1: 1200, q: 5 }); noise(o, t + 0.75, 0.08, { type: 'bandpass', f0: 2600, f1: 2000, q: 5 });
  },
  hit(pos) { if (!ctx) return; const o = out(0.7, pos, 40); if (o) noise(o, ctx.currentTime, 0.12, { f0: 900, f1: 120, vol: 1 }); },
  headshot(pos) {
    if (!ctx) return; const o = out(0.9, pos, 40); if (!o) return; const t = ctx.currentTime;
    noise(o, t, 0.35, { f0: 1200, f1: 80, vol: 1.2 }); tone(o, t, 0.2, { type: 'triangle', f0: 90, f1: 40, vol: 0.5 });
  },
  wall(pos) { if (!ctx) return; const o = out(0.35, pos, 30); if (o) noise(o, ctx.currentTime, 0.07, { type: 'bandpass', f0: 3000, f1: 1500, q: 2 }); },
  knife() { if (!ctx) return; noise(out(0.4), ctx.currentTime, 0.18, { type: 'bandpass', f0: 6000, f1: 2500, q: 1.5, a: 0.05 }); },
  kick() { if (!ctx) return; const t = ctx.currentTime, o = out(0.8); noise(o, t, 0.15, { f0: 600, f1: 100, vol: 1 }); tone(o, t, 0.15, { f0: 120, f1: 50, vol: 0.6 }); },
  hurt() { if (!ctx) return; const t = ctx.currentTime, o = out(0.6); tone(o, t, 0.25, { type: 'triangle', f0: 520, f1: 300, vol: 0.35 }); noise(o, t, 0.15, { f0: 800, f1: 200, vol: 0.6 }); },
  pickup() { if (!ctx) return; const t = ctx.currentTime, o = out(0.4); tone(o, t, 0.12, { type: 'triangle', f0: 880, vol: 0.3 }); tone(o, t + 0.08, 0.18, { type: 'triangle', f0: 1320, vol: 0.3 }); },
  gold() { if (!ctx) return; const t = ctx.currentTime, o = out(0.35); for (let i = 0; i < 3; i++) tone(o, t + i * 0.05, 0.15, { type: 'square', f0: 1600 + i * 300, vol: 0.12 }); },
  crate(pos) { if (!ctx) return; const o = out(0.7, pos, 30); if (o) { const t = ctx.currentTime; noise(o, t, 0.3, { f0: 1500, f1: 200, vol: 1 }); noise(o, t + 0.05, 0.2, { type: 'bandpass', f0: 500, f1: 300, q: 3, vol: 0.6 }); } },
  ui() { if (!ctx) return; tone(out(0.3), ctx.currentTime, 0.08, { type: 'triangle', f0: 660, vol: 0.3 }); },
  buy() { if (!ctx) return; const t = ctx.currentTime, o = out(0.4); tone(o, t, 0.1, { type: 'square', f0: 1200, vol: 0.12 }); tone(o, t + 0.1, 0.25, { type: 'square', f0: 1800, vol: 0.12 }); },
  heal() { if (!ctx) return; const t = ctx.currentTime, o = out(0.4); [523, 659, 784].forEach((f, i) => tone(o, t + i * 0.09, 0.3, { type: 'sine', f0: f, vol: 0.25 })); },
  // ゾンビのうめき声（声の高さは種類ごと）
  groan(pos, pitch = 1) {
    if (!ctx) return; const o = out(0.55, pos, 26); if (!o) return;
    const t = ctx.currentTime, dur = 0.7 + Math.random() * 0.9;
    const src = ctx.createOscillator(); src.type = 'sawtooth';
    const f = (70 + Math.random() * 40) * pitch;
    src.frequency.setValueAtTime(f, t); src.frequency.linearRampToValueAtTime(f * (0.75 + Math.random() * 0.3), t + dur);
    const lfo = ctx.createOscillator(), lg = ctx.createGain(); lfo.frequency.value = 5 + Math.random() * 4; lg.gain.value = f * 0.06; lfo.connect(lg); lg.connect(src.frequency);
    const bp = ctx.createBiquadFilter(); bp.type = 'bandpass'; bp.Q.value = 5; bp.frequency.setValueAtTime(500 + Math.random() * 300, t); bp.frequency.linearRampToValueAtTime(350, t + dur);
    const g = ctx.createGain(); g.gain.setValueAtTime(0, t); g.gain.linearRampToValueAtTime(0.6, t + 0.15); g.gain.exponentialRampToValueAtTime(0.001, t + dur);
    src.connect(bp); bp.connect(g); g.connect(o);
    src.start(t); lfo.start(t); src.stop(t + dur + 0.05); lfo.stop(t + dur + 0.05);
    noise(o, t, dur * 0.8, { type: 'bandpass', f0: 900, f1: 500, q: 3, a: 0.1, vol: 0.25 });
  },
  roar(pos) {
    if (!ctx) return; const o = out(1.2, pos, 60); if (!o) return; const t = ctx.currentTime;
    const src = ctx.createOscillator(); src.type = 'sawtooth'; src.frequency.setValueAtTime(70, t); src.frequency.linearRampToValueAtTime(48, t + 1.4);
    const bp = ctx.createBiquadFilter(); bp.type = 'lowpass'; bp.frequency.value = 700;
    const g = ctx.createGain(); g.gain.setValueAtTime(0, t); g.gain.linearRampToValueAtTime(0.9, t + 0.2); g.gain.exponentialRampToValueAtTime(0.001, t + 1.5);
    src.connect(bp); bp.connect(g); g.connect(o); src.start(t); src.stop(t + 1.6);
    noise(o, t, 1.4, { f0: 1500, f1: 300, a: 0.2, vol: 0.7 });
  },
  stomp(pos) { if (!ctx) return; const o = out(0.8, pos, 40); if (o) tone(o, ctx.currentTime, 0.25, { f0: 70, f1: 35, vol: 0.9 }); },
  thud(pos) { if (!ctx) return; const o = out(0.6, pos, 30); if (o) { noise(o, ctx.currentTime, 0.25, { f0: 400, f1: 60, vol: 1 }); } },
  bell() {
    if (!ctx) return; const t = ctx.currentTime, o = out(0.7);
    for (let k = 0; k < 3; k++) for (const [r, v] of [[1, 0.4], [2.01, 0.2], [2.76, 0.12], [5.4, 0.06]]) tone(o, t + k * 2.2, 3.2, { f0: 196 * r, vol: v, a: 0.004 });
  },
  heart() { if (!ctx) return; const t = ctx.currentTime, o = out(0.5); tone(o, t, 0.12, { f0: 60, f1: 40, vol: 0.8 }); tone(o, t + 0.18, 0.12, { f0: 55, f1: 38, vol: 0.6 }); },
  step(run) { if (!ctx) return; noise(out(run ? 0.16 : 0.1), ctx.currentTime, 0.08, { f0: 700, f1: 150, vol: 1 }); },
};

// 風と低い唸り（ずっと鳴らす）。tension：0〜1 で緊張の音を重ねる
export function startAmbient() {
  if (!ctx || ambient) return;
  const wind = ctx.createBufferSource(); wind.buffer = noiseBuf; wind.loop = true;
  const wf = ctx.createBiquadFilter(); wf.type = 'bandpass'; wf.frequency.value = 400; wf.Q.value = 0.6;
  const wg = ctx.createGain(); wg.gain.value = 0.08;
  const lfo = ctx.createOscillator(), lg = ctx.createGain(); lfo.frequency.value = 0.13; lg.gain.value = 180; lfo.connect(lg); lg.connect(wf.frequency);
  wind.connect(wf); wf.connect(wg); wg.connect(master); wind.start(); lfo.start();
  const drone = ctx.createOscillator(); drone.type = 'sawtooth'; drone.frequency.value = 55;
  const d2 = ctx.createOscillator(); d2.type = 'sawtooth'; d2.frequency.value = 55 * 1.498;
  const df = ctx.createBiquadFilter(); df.type = 'lowpass'; df.frequency.value = 220;
  const dg = ctx.createGain(); dg.gain.value = 0;
  drone.connect(df); d2.connect(df); df.connect(dg); dg.connect(master); drone.start(); d2.start();
  ambient = { dg, df };
}
export function setTension(v) {
  if (!ambient) return;
  const t = ctx.currentTime;
  ambient.dg.gain.setTargetAtTime(0.02 + v * 0.07, t, 0.8);
  ambient.df.frequency.setTargetAtTime(180 + v * 500, t, 0.8);
}
