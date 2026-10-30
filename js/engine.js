// 描画の土台：レンダラー・場面・カメラ・光・画質・プログラムで描く画像
import * as THREE from '../vendor/three.module.min.js';
export { THREE };

export const canvas = document.getElementById('view');
export const isTouch = matchMedia('(pointer: coarse)').matches || 'ontouchstart' in window;

// 画質：low はスマホ向け（解像度を抑え、影を描かない）、high は PC 向け
export const quality = { level: 'high' };
export function pickQuality(setting) {
  quality.level = setting === 'auto' ? (isTouch ? 'low' : 'high') : setting;
  return quality.level;
}

export let renderer;
export function makeRenderer() {
  renderer = new THREE.WebGLRenderer({ canvas, antialias: quality.level === 'high', powerPreference: 'high-performance' });
  renderer.setPixelRatio(quality.level === 'high' ? Math.min(devicePixelRatio, 2) : Math.min(devicePixelRatio, 1.25));
  renderer.outputColorSpace = THREE.SRGBColorSpace;
  renderer.toneMapping = THREE.ACESFilmicToneMapping;
  renderer.toneMappingExposure = 1.05;
  renderer.shadowMap.enabled = quality.level === 'high';
  renderer.shadowMap.type = THREE.PCFSoftShadowMap;
  // 建物の影は動かないので、最初に一度だけ描く（毎フレームの負担がない）
  renderer.shadowMap.autoUpdate = false;
  resize();
  return renderer;
}

export const scene = new THREE.Scene();
export const FOG_COLOR = new THREE.Color('#5a4a52');
scene.background = FOG_COLOR.clone();
scene.fog = new THREE.FogExp2(FOG_COLOR, 0.028);

export const camera = new THREE.PerspectiveCamera(62, 1, 0.08, 140);

export function resize() {
  if (!renderer) return;
  const w = innerWidth, h = innerHeight;
  renderer.setSize(w, h, false);
  camera.aspect = w / h;
  camera.updateProjectionMatrix();
}
addEventListener('resize', resize);

// 黄昏の光：空と地面からの環境光、沈みかけの日、広場の焚き火
export const hemi = new THREE.HemisphereLight('#c9a6a0', '#2c2a2a', 1.15);
export const sun = new THREE.DirectionalLight('#ffb27a', 1.5);
sun.position.set(-40, 38, 30);
sun.target.position.set(0, 0, 0);
sun.castShadow = true;
sun.shadow.mapSize.set(4096, 4096);
Object.assign(sun.shadow.camera, { left: -70, right: 70, top: 90, bottom: -90, near: 1, far: 160 });
sun.shadow.bias = -0.0008;
sun.shadow.normalBias = 0.05;
scene.add(hemi, sun, sun.target);

// 銃口の光と焚き火の光。光の数が変わると材質の作り直しが起きるので、いつも置いておき強さだけ変える
export const flashLight = new THREE.PointLight('#ffcf8a', 0, 9, 2);
export const fireLight = new THREE.PointLight('#ff8a3a', 0, 22, 1.6);
scene.add(flashLight, fireLight);

// ---- プログラムで描く画像 ----
let seed = 11;
export const rand = () => ((seed = (seed * 16807) % 2147483647) / 2147483647);

export function canvasTex(w, h, draw, repeat = true) {
  const c = document.createElement('canvas');
  c.width = w; c.height = h;
  draw(c.getContext('2d'), w, h);
  const t = new THREE.CanvasTexture(c);
  t.colorSpace = THREE.SRGBColorSpace;
  if (repeat) t.wrapS = t.wrapT = THREE.RepeatWrapping;
  t.anisotropy = 4;
  return t;
}
export function tiled(tex, rx, ry) { const t = tex.clone(); t.needsUpdate = true; t.repeat.set(rx, ry); return t; }

function speckle(g, w, h, n, colors, size = 2) {
  for (let i = 0; i < n; i++) { g.fillStyle = colors[(rand() * colors.length) | 0]; g.fillRect(rand() * w, rand() * h, size * (0.5 + rand()), size * (0.5 + rand())); }
}

export const TEX = {
  dirt: canvasTex(256, 256, (g, w, h) => {
    g.fillStyle = '#5b4a3a'; g.fillRect(0, 0, w, h);
    speckle(g, w, h, 2200, ['#4f3f31', '#66543f', '#6f5d48', '#463729', '#58483a'], 3);
    for (let i = 0; i < 30; i++) { g.fillStyle = 'rgba(30,22,15,.25)'; g.beginPath(); g.ellipse(rand() * w, rand() * h, 6 + rand() * 18, 3 + rand() * 8, rand() * 3, 0, 7); g.fill(); }
    speckle(g, w, h, 160, ['#8a7a66', '#7b6b58'], 2);
  }),
  grass: canvasTex(256, 256, (g, w, h) => {
    g.fillStyle = '#3f4a2c'; g.fillRect(0, 0, w, h);
    for (let i = 0; i < 2600; i++) {
      g.strokeStyle = `hsl(${60 + rand() * 30}, ${25 + rand() * 20}%, ${18 + rand() * 18}%)`;
      const x = rand() * w, y = rand() * h; g.beginPath(); g.moveTo(x, y); g.lineTo(x + (rand() - 0.5) * 4, y - 3 - rand() * 5); g.stroke();
    }
  }),
  planks: canvasTex(256, 256, (g, w, h) => {
    for (let i = 0; i < 8; i++) {
      g.fillStyle = `hsl(25, ${22 + rand() * 12}%, ${20 + rand() * 9}%)`; g.fillRect(i * 32, 0, 32, h);
      g.fillStyle = 'rgba(0,0,0,.45)'; g.fillRect(i * 32, 0, 2, h);
      g.fillStyle = 'rgba(255,240,220,.04)'; for (let k = 0; k < 10; k++) g.fillRect(i * 32 + 3 + rand() * 26, 0, 1, h);
      g.fillStyle = 'rgba(0,0,0,.3)'; g.fillRect(i * 32, rand() * h, 32, 2);
    }
    speckle(g, w, h, 300, ['rgba(0,0,0,.25)', 'rgba(60,40,20,.3)'], 2);
  }),
  plaster: canvasTex(256, 256, (g, w, h) => {
    g.fillStyle = '#9c8b74'; g.fillRect(0, 0, w, h);
    speckle(g, w, h, 1800, ['#8f7f69', '#a8977f', '#857561', '#93836d'], 3);
    for (let i = 0; i < 12; i++) { g.fillStyle = 'rgba(60,45,30,.18)'; g.beginPath(); g.ellipse(rand() * w, rand() * h, 10 + rand() * 30, 6 + rand() * 20, rand() * 3, 0, 7); g.fill(); }
    const grd = g.createLinearGradient(0, h * 0.7, 0, h); grd.addColorStop(0, 'rgba(40,30,20,0)'); grd.addColorStop(1, 'rgba(40,30,20,.5)');
    g.fillStyle = grd; g.fillRect(0, 0, w, h);
    // 柱と梁（ハーフティンバー）
    g.fillStyle = '#3a2a1c'; g.fillRect(0, 0, 14, h); g.fillRect(w - 14, 0, 14, h); g.fillRect(0, 0, w, 12); g.fillRect(0, h - 12, w, 12);
  }),
  roof: canvasTex(256, 256, (g, w, h) => {
    g.fillStyle = '#4a3a30'; g.fillRect(0, 0, w, h);
    for (let y = 0; y < h; y += 16) for (let x = (y / 16 % 2) * 12; x < w; x += 24) {
      g.fillStyle = `hsl(15, ${15 + rand() * 15}%, ${16 + rand() * 12}%)`; g.fillRect(x, y, 22, 14);
      g.fillStyle = 'rgba(0,0,0,.4)'; g.fillRect(x, y + 13, 22, 3);
    }
  }),
  stone: canvasTex(256, 256, (g, w, h) => {
    g.fillStyle = '#4f4b47'; g.fillRect(0, 0, w, h);
    for (let y = 0; y < h; y += 32) for (let x = (y / 32 % 2) * 24; x < w + 48; x += 48) {
      g.fillStyle = `hsl(30, ${4 + rand() * 6}%, ${30 + rand() * 14}%)`; g.fillRect(x - 46, y + 2, 44, 28);
    }
    speckle(g, w, h, 900, ['rgba(0,0,0,.2)', 'rgba(255,255,255,.06)'], 2);
  }),
  bark: canvasTex(64, 128, (g, w, h) => {
    g.fillStyle = '#2f241c'; g.fillRect(0, 0, w, h);
    for (let i = 0; i < 40; i++) { g.fillStyle = `rgba(0,0,0,${0.2 + rand() * 0.3})`; g.fillRect(rand() * w, 0, 2, h); }
  }),
  leaves: canvasTex(128, 128, (g, w, h) => {
    g.fillStyle = '#26301c'; g.fillRect(0, 0, w, h);
    speckle(g, w, h, 900, ['#1e2716', '#33402a', '#2b3622', '#3c4a2c'], 5);
  }),
  hay: canvasTex(128, 128, (g, w, h) => {
    g.fillStyle = '#8a7340'; g.fillRect(0, 0, w, h);
    for (let i = 0; i < 700; i++) { g.strokeStyle = `hsl(${40 + rand() * 10}, 45%, ${30 + rand() * 25}%)`; const x = rand() * w, y = rand() * h; g.beginPath(); g.moveTo(x, y); g.lineTo(x + (rand() - 0.5) * 14, y + (rand() - 0.5) * 4); g.stroke(); }
  }),
};

export const mat = (color, extra = {}) => new THREE.MeshLambertMaterial({ color, ...extra });
export const M = {
  dirt: mat('#ffffff', { map: TEX.dirt }),
  grass: mat('#ffffff', { map: TEX.grass }),
  planks: mat('#ffffff', { map: TEX.planks }),
  plaster: mat('#ffffff', { map: TEX.plaster }),
  roof: mat('#ffffff', { map: TEX.roof }),
  stone: mat('#ffffff', { map: TEX.stone }),
  bark: mat('#ffffff', { map: TEX.bark }),
  leaves: mat('#ffffff', { map: TEX.leaves }),
  hay: mat('#ffffff', { map: TEX.hay }),
  darkWood: mat('#3a2818'), wood: mat('#6a4a2e'), iron: mat('#3a3a3e'), black: mat('#141416'),
  window: mat('#1a1410', { emissive: '#000000' }), windowLit: mat('#ffb060', { emissive: '#d06a20', emissiveIntensity: 1.2 }),
  ember: mat('#ff6a20', { emissive: '#ff5a10', emissiveIntensity: 2 }),
};

// 足元の丸い影
export const shadowTex = canvasTex(64, 64, (g) => {
  const r = g.createRadialGradient(32, 32, 2, 32, 32, 30);
  r.addColorStop(0, 'rgba(0,0,0,.6)'); r.addColorStop(1, 'rgba(0,0,0,0)');
  g.fillStyle = r; g.fillRect(0, 0, 64, 64);
}, false);
const shadowMat = new THREE.MeshBasicMaterial({ map: shadowTex, transparent: true, depthWrite: false });
const shadowGeo = new THREE.PlaneGeometry(1, 1).rotateX(-Math.PI / 2);
export function blobShadow(size = 0.9) {
  const m = new THREE.Mesh(shadowGeo, shadowMat);
  m.scale.setScalar(size); m.position.y = 0.02; m.renderOrder = 1;
  return m;
}
