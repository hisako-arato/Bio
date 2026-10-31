// 骨の動き（プログラムで姿勢をつける）
// VRM の正規化した骨は T ポーズが基準で、体は +z を向く。
//   脚・腕を下ろした状態で x をマイナスにすると前へ振る／ひざ・ひじは x（脚）・y（腕）で曲げる
//   左腕は z をマイナスで下ろし y をマイナスで前へ、右腕は z をプラスで下ろし y をプラスで前へ
//   背骨は x をプラスで前かがみ、マイナスで反る
const BONES = ['hips', 'spine', 'chest', 'upperChest', 'neck', 'head',
  'leftUpperLeg', 'leftLowerLeg', 'leftFoot', 'rightUpperLeg', 'rightLowerLeg', 'rightFoot',
  'leftShoulder', 'rightShoulder', 'leftUpperArm', 'leftLowerArm', 'leftHand', 'rightUpperArm', 'rightLowerArm', 'rightHand'];
const R = {};
for (const b of BONES) R[b] = [0, 0, 0];
let hipsDrop = 0;

function begin() { for (const b of BONES) { const r = R[b]; r[0] = r[1] = r[2] = 0; } hipsDrop = 0; }
function add(b, x = 0, y = 0, z = 0, w = 1) { const r = R[b]; r[0] += x * w; r[1] += y * w; r[2] += z * w; }
// 今の姿勢から目標の姿勢へ w だけ寄せる
function mix(b, x, y, z, w) { if (w <= 0) return; const r = R[b]; r[0] += (x - r[0]) * w; r[1] += (y - r[1]) * w; r[2] += (z - r[2]) * w; }
function apply(vrm) {
  const h = vrm.humanoid;
  for (const b of BONES) { const n = h.getNormalizedBoneNode(b); if (n) n.rotation.set(R[b][0], R[b][1], R[b][2]); }
  const hips = h.getNormalizedBoneNode('hips');
  hips.position.y = vrm.restHipsY - hipsDrop;
}
const clamp01 = v => Math.max(0, Math.min(1, v));
const ease = v => v * v * (3 - 2 * v);
const seg = (t, a, b) => clamp01((t - a) / (b - a));   // t が a〜b のどこか（0〜1）

// ---- 主人公 ----
// s：{ t, phase, move, run, aim, pitch, weapon, recoil, reload, knife, kick, hurt, heal, grab, down }
export function posePlayer(vrm, s) {
  begin();
  const p = s.phase, a = s.move, run = s.run, sw = Math.sin(p), cw = Math.cos(p);
  const stride = 0.42 + run * 0.4;
  // 脚
  add('leftUpperLeg', -sw * stride * a); add('rightUpperLeg', sw * stride * a);
  add('leftLowerLeg', (Math.max(0, cw) * (0.55 + run * 0.7) + 0.06) * a);
  add('rightLowerLeg', (Math.max(0, -cw) * (0.55 + run * 0.7) + 0.06) * a);
  hipsDrop = (0.012 + 0.02 * run) * a * (1 + Math.cos(2 * p));
  add('spine', 0.05 * a + 0.16 * run + Math.sin(s.t * 1.7) * 0.012, sw * 0.07 * a);
  add('chest', -Math.sin(s.t * 1.7) * 0.008, -sw * 0.05 * a);
  // 腕（銃を右手に下げて持つ）
  const swing = 0.38 * a * (1 + run * 0.6);
  add('leftUpperArm', sw * swing, 0, -1.22);
  add('leftLowerArm', 0, -0.2 - run * 0.9, 0);
  add('rightUpperArm', -sw * swing * 0.6 - 0.1, 0, 1.18);
  add('rightLowerArm', 0, 0.45 + run * 0.6, 0);
  // 頭はカメラの見る高さに少しついていく
  add('head', -s.pitch * 0.25);

  // 構え（aim：0〜1）。上下の狙いは背骨で反らす・かがむ
  const w = s.aim * (1 - s.knifeW) * (1 - s.reloadW * 0.7);
  if (w > 0) {
    const pit = s.pitch, rc = s.recoil;
    for (const [b, k] of [['spine', 0.34], ['chest', 0.33], ['upperChest', 0.33]]) mix(b, -pit * k - rc * 0.03, 0, 0, w);
    mix('neck', 0, 0, 0, w); mix('head', 0.05, 0, 0, w);
    if (s.weapon === 'sg') {
      // 散弾銃：右手は胸の横で引き金、左手は前で銃身を支える
      mix('rightUpperArm', -rc * 0.3, 0.75, 0.95, w); mix('rightLowerArm', 0, 1.75, 0, w);
      mix('leftUpperArm', -0.1 - rc * 0.3, -1.25, -0.35, w); mix('leftLowerArm', 0, -0.55, 0, w);
    } else {
      // 拳銃：両手を前へ伸ばして構える
      mix('rightUpperArm', -rc * 0.35, 1.72, 0.05, w); mix('rightLowerArm', 0, 0.05, 0, w);
      mix('leftUpperArm', -rc * 0.35, -1.55, 0.02, w); mix('leftLowerArm', 0, -1.0, 0, w);
    }
    mix('rightHand', -rc * 0.4, 0, 0, w);
  }
  // 弾込め（reload：0〜1 の進み）
  if (s.reloadW > 0) {
    const r = s.reload, w2 = s.reloadW;
    const reach = Math.sin(clamp01(r * 1.2) * Math.PI);    // 左手が腰へ行って戻る
    mix('rightUpperArm', -0.1, 0.9, 0.8, w2); mix('rightLowerArm', 0, 1.6, 0, w2);
    mix('leftUpperArm', 0.35 * reach - 0.2, -0.9 + reach * 0.6, -0.9 - reach * 0.35, w2); mix('leftLowerArm', 0, -1.4 + reach * 0.9, 0, w2);
    mix('head', 0.35, 0, 0, w2); mix('spine', 0.08, 0, 0, w2);
  }
  // ナイフ（右から左へ横に払う）
  if (s.knifeW > 0) {
    const k = ease(seg(s.knife, 0.15, 0.6)), w3 = s.knifeW;
    mix('spine', 0.12, -0.45 + k * 0.95, 0, w3); mix('chest', 0.05, -0.2 + k * 0.4, 0, w3);
    mix('rightUpperArm', -0.15, 0.1 + k * 2.0, 0.25, w3); mix('rightLowerArm', 0, 0.5 - k * 0.4, 0, w3);
    mix('leftUpperArm', 0, -0.4, -0.9, w3); mix('leftLowerArm', 0, -1.2, 0, w3);
  }
  // 蹴り（右脚で前蹴り）
  if (s.kick > 0) {
    const k = s.kick, w4 = Math.sin(clamp01(k) * Math.PI) ** 0.5;
    const chamber = ease(seg(k, 0, 0.3)), extend = ease(seg(k, 0.28, 0.5)), back = ease(seg(k, 0.65, 1));
    const lift = (chamber * 1.55) * (1 - back);
    mix('rightUpperLeg', -lift, 0, 0, w4); mix('rightLowerLeg', (chamber * 1.8 - extend * 1.65) * (1 - back), 0, 0, w4);
    mix('leftUpperLeg', 0.1, 0, 0, w4); mix('leftLowerLeg', 0.25, 0, 0, w4);
    mix('spine', -0.22 * (1 - back), 0, 0, w4); mix('chest', -0.1, 0, 0, w4);
    mix('leftUpperArm', -0.3, -0.5, -0.7, w4); mix('rightUpperArm', 0.2, 0.3, 0.9, w4);
  }
  // 回復（左手で口元へ）
  if (s.heal > 0) {
    const w5 = Math.sin(clamp01(s.heal) * Math.PI);
    mix('leftUpperArm', -0.5, -1.1, -0.55, w5); mix('leftLowerArm', 0, -2.3, 0, w5); mix('head', 0.15, 0, 0, w5);
  }
  // 痛がる
  if (s.hurt > 0) {
    const h = s.hurt;
    add('spine', -0.28 * h); add('chest', -0.15 * h); add('head', -0.35 * h, 0, 0.1 * h);
    add('leftUpperArm', 0, 0, 0.4 * h); add('rightUpperArm', 0, 0, -0.4 * h);
  }
  // 掴まれてもがく
  if (s.grab > 0) {
    const g = s.grab, sh = Math.sin(s.t * 22) * 0.12;
    mix('leftUpperArm', -0.35, -1.25, 0, g); mix('leftLowerArm', 0, -0.9, 0, g);
    mix('rightUpperArm', -0.35, 1.25, 0, g); mix('rightLowerArm', 0, 0.9, 0, g);
    mix('spine', -0.15, sh, 0, g); mix('head', -0.2, -sh, 0, g);
  }
  // 倒れている（体ごと傾けるのは player.js）
  if (s.down > 0) {
    const d = s.down;
    mix('leftUpperLeg', -0.25, 0, 0.1, d); mix('rightUpperLeg', -0.6, 0, -0.1, d);
    mix('leftLowerLeg', 0.4, 0, 0, d); mix('rightLowerLeg', 0.9, 0, 0, d);
    mix('leftUpperArm', -0.4, 0, -0.6, d); mix('rightUpperArm', -0.4, 0, 0.6, d);
    mix('spine', 0, 0, 0, d); mix('head', 0.25, 0.3, 0, d);
  }
  apply(vrm);
}

// ---- ゾンビ ----
// s：{ t, phase, move, style, tilt, raise, lunge, grab, stagger, kneel, down, roar }
export function poseZombie(vrm, s) {
  begin();
  const p = s.phase, a = s.move, sw = Math.sin(p), cw = Math.cos(p);
  const fast = s.fast || 0;
  // 片脚を引きずる歩き
  add('leftUpperLeg', -sw * (0.42 + fast * 0.25) * a - 0.05); add('rightUpperLeg', sw * (0.3 + fast * 0.25) * a - 0.05);
  add('leftLowerLeg', Math.max(0, cw) * (0.6 + fast * 0.5) * a + 0.12);
  add('rightLowerLeg', Math.max(0, -cw) * (0.35 + fast * 0.5) * a + 0.2);
  add('rightFoot', 0.2);
  hipsDrop = 0.03 + 0.025 * a * (1 + Math.cos(2 * p));
  add('hips', 0, sw * 0.08 * a, sw * 0.07 * a);
  add('spine', 0.22 + fast * 0.15 + Math.sin(s.t * 1.1) * 0.03, -sw * 0.05 * a, -sw * 0.04 * a);
  add('chest', 0.1, 0, Math.sin(s.t * 0.9) * 0.04);
  add('neck', 0.18);
  add('head', 0.05 + Math.sin(s.t * 1.3 + s.tilt * 5) * 0.06, Math.sin(s.t * 0.6 + s.tilt * 9) * 0.25, s.tilt);
  if (s.style === 'reach') {
    // 両腕を前へ伸ばしてさまよう
    const k = Math.sin(s.t * 1.9) * 0.08;
    add('leftUpperArm', -0.25 + k, -1.2, -0.3); add('leftLowerArm', 0, -0.25, 0);
    add('rightUpperArm', -0.15 - k, 1.15, 0.35); add('rightLowerArm', 0, 0.35, 0);
  } else {
    // 腕はだらりと下がり、歩みにつれて揺れる
    add('leftUpperArm', sw * 0.3 * a + 0.1, -0.15, -1.38 + Math.sin(s.t * 1.4) * 0.05); add('leftLowerArm', 0, -0.2, 0);
    add('rightUpperArm', -sw * 0.2 * a + 0.15, 0.1, 1.3); add('rightLowerArm', 0, 0.4, 0);
  }
  // 振りかぶる（raise）と、襲いかかる（lunge）
  if (s.raise > 0) {
    const r = s.raise;
    mix('leftUpperArm', -1.1, -0.9, 0.2, r); mix('rightUpperArm', -1.1, 0.9, -0.2, r);
    mix('leftLowerArm', 0, -0.6, 0, r); mix('rightLowerArm', 0, 0.6, 0, r);
    mix('spine', -0.12, 0, 0, r); mix('head', -0.2, 0, s.tilt, r);
  }
  if (s.lunge > 0) {
    const l = s.lunge;
    mix('leftUpperArm', -0.2, -1.45, -0.1, l); mix('rightUpperArm', -0.2, 1.45, 0.1, l);
    mix('leftLowerArm', 0, -0.1, 0, l); mix('rightLowerArm', 0, 0.1, 0, l);
    mix('spine', 0.45, 0, 0, l); mix('chest', 0.15, 0, 0, l);
  }
  // 掴んで噛みつく
  if (s.grab > 0) {
    const g = s.grab, bite = Math.max(0, Math.sin(s.t * 9)) * 0.25;
    mix('leftUpperArm', -0.3, -1.5, 0, g); mix('rightUpperArm', -0.3, 1.5, 0, g);
    mix('leftLowerArm', 0, -0.7, 0, g); mix('rightLowerArm', 0, 0.7, 0, g);
    mix('spine', 0.3, 0, 0, g); mix('neck', 0.25 + bite, 0, 0, g); mix('head', 0.1 + bite, 0, 0.2, g);
  }
  // 雄叫び（大男）
  if (s.roar > 0) {
    const r = s.roar;
    mix('spine', -0.3, 0, 0, r); mix('chest', -0.2, 0, 0, r); mix('head', -0.45, 0, 0, r);
    mix('leftUpperArm', 0.2, -0.3, -0.45, r); mix('rightUpperArm', 0.2, 0.3, 0.45, r);
    mix('leftLowerArm', 0, -1.4, 0, r); mix('rightLowerArm', 0, 1.4, 0, r);
  }
  // ひるむ（のけぞる）
  if (s.stagger > 0) {
    const st = s.stagger;
    add('spine', -0.45 * st); add('chest', -0.2 * st); add('head', -0.5 * st, 0, 0.2 * st);
    mix('leftUpperArm', 0.2, -0.3, -0.5, st * 0.8); mix('rightUpperArm', 0.2, 0.3, 0.5, st * 0.8);
  }
  // 片ひざをつく（脚を撃たれた）
  if (s.kneel > 0) {
    const k = s.kneel;
    mix('leftUpperLeg', -1.45, 0, 0, k); mix('leftLowerLeg', 1.5, 0, 0, k);
    mix('rightUpperLeg', 0.15, 0, 0, k); mix('rightLowerLeg', 1.95, 0, 0, k);
    mix('spine', 0.35, 0, 0, k); mix('head', 0.15, 0, s.tilt, k);
    mix('leftUpperArm', -0.2, -0.4, -1.2, k); mix('rightUpperArm', 0.3, 0.2, 1.3, k);
    hipsDrop += (0.45 - hipsDrop) * k;
  }
  // 床を這う（体ごと前へ倒すのは zombies.js）。腕で床をかいて進む
  if (s.crawl) {
    const k = Math.sin(p) * a, c = Math.cos(p);
    mix('hips', 0, 0, 0, 1);
    mix('spine', -0.18, 0, k * 0.08, 1); mix('chest', -0.1, 0, 0, 1); mix('neck', -0.35, 0, 0, 1); mix('head', -0.45, Math.sin(s.t * 0.8) * 0.2, s.tilt * 0.5, 1);
    mix('leftUpperArm', -0.1, -0.35, 1.2 + k * 0.4, 1); mix('leftLowerArm', 0, -0.35 - Math.max(0, c) * 0.7 * a, 0, 1);
    mix('rightUpperArm', -0.1, 0.35, -1.2 + k * 0.4, 1); mix('rightLowerArm', 0, 0.35 + Math.max(0, -c) * 0.7 * a, 0, 1);
    mix('leftUpperLeg', 0.05 + k * 0.12, 0, 0.08, 1); mix('rightUpperLeg', 0.05 - k * 0.12, 0, -0.08, 1);
    mix('leftLowerLeg', 0.35 + Math.max(0, k) * 0.4, 0, 0, 1); mix('rightLowerLeg', 0.2 + Math.max(0, -k) * 0.4, 0, 0, 1);
    hipsDrop = 0;
  }
  // 倒れている（体ごと傾けるのは zombies.js）
  if (s.down > 0) {
    const d = s.down;
    mix('leftUpperLeg', -0.2, 0, 0.15, d); mix('rightUpperLeg', -0.45, 0, -0.1, d);
    mix('leftLowerLeg', 0.3, 0, 0, d); mix('rightLowerLeg', 0.7, 0, 0, d);
    mix('leftUpperArm', -0.6, -0.2, -0.3, d); mix('rightUpperArm', -0.9, 0.3, 0.2, d);
    mix('spine', -0.05, 0, 0, d); mix('chest', 0, 0, 0, d); mix('neck', 0, 0, 0, d); mix('head', 0.1, 0.5, 0, d);
    hipsDrop *= 1 - d;
  }
  apply(vrm);
}
