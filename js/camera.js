// 肩越しのカメラ。主人公の右肩の後ろから見る。構えると寄って狭くなる。壁にめり込まないよう手前に寄せる
import { THREE, camera } from './engine.js';
import { rayWorld } from './world.js';

export const cam = {
  yaw: 0, pitch: -0.05,
  dist: 2.9,
  shake: 0,
  fwd: new THREE.Vector3(), right: new THREE.Vector3(), dir: new THREE.Vector3(),
  pivot: new THREE.Vector3(),
  override: null,   // 演出用：{ pos, look }
};
const NORMAL = { back: 2.7, side: 0.62, up: 0.12, fov: 60 };
const AIM = { back: 1.25, side: 0.58, up: 0.06, fov: 46 };
const _p = new THREE.Vector3(), _d = new THREE.Vector3(), _look = new THREE.Vector3(), _shoulder = new THREE.Vector3();

export function updateCamera(dt, target, aimW, height = 1.45) {
  cam.pitch = Math.max(-1.0, Math.min(0.75, cam.pitch));
  const cy = Math.cos(cam.yaw), sy = Math.sin(cam.yaw), cp = Math.cos(cam.pitch), sp = Math.sin(cam.pitch);
  cam.fwd.set(-sy, 0, -cy);
  cam.right.set(cy, 0, -sy);
  cam.dir.set(-sy * cp, sp, -cy * cp);
  const k = aimW;
  const back = NORMAL.back + (AIM.back - NORMAL.back) * k;
  const side = NORMAL.side + (AIM.side - NORMAL.side) * k;
  const up = NORMAL.up + (AIM.up - NORMAL.up) * k;
  cam.pivot.set(target.x, target.y + height, target.z);
  // 肩の位置（頭の横）まで壁が無いか
  _shoulder.copy(cam.pivot).addScaledVector(cam.right, side);
  _shoulder.y += up;
  _d.copy(_shoulder).sub(cam.pivot); let len = _d.length(); _d.divideScalar(len);
  const hs = rayWorld(cam.pivot, _d, len + 0.2);
  if (hs < len + 0.2) _shoulder.copy(cam.pivot).addScaledVector(_d, Math.max(0, hs - 0.2));
  // 肩から後ろへ
  _d.copy(cam.dir).negate();
  const hit = rayWorld(_shoulder, _d, back + 0.25);
  const want = Math.max(0.35, Math.min(back, hit - 0.25));
  cam.dist = want < cam.dist ? want : cam.dist + (want - cam.dist) * Math.min(1, dt * 4);
  _p.copy(_shoulder).addScaledVector(_d, cam.dist);
  if (_p.y < 0.25) _p.y = 0.25;
  // 揺れ（被弾・大男の足音）
  if (cam.shake > 0) {
    cam.shake = Math.max(0, cam.shake - dt * 2.5);
    const s = cam.shake * cam.shake * 0.12;
    _p.x += (Math.random() - 0.5) * s; _p.y += (Math.random() - 0.5) * s; _p.z += (Math.random() - 0.5) * s;
  }
  if (cam.override) {
    camera.position.lerp(cam.override.pos, Math.min(1, dt * 3));
    camera.lookAt(cam.override.look);
  } else {
    camera.position.copy(_p);
    _look.copy(_shoulder).addScaledVector(cam.dir, 20);
    camera.lookAt(_look);
  }
  const fov = NORMAL.fov + (AIM.fov - NORMAL.fov) * k;
  if (Math.abs(camera.fov - fov) > 0.01) { camera.fov = fov; camera.updateProjectionMatrix(); }
}
