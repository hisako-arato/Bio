// VRM の読み込みと、ゾンビの複製
// 主人公は VRM をそのまま使う（髪の揺れ・輪郭線あり）。
// ゾンビは種類ごとに1体だけ読み込み、形と画像を共有したまま骨だけを複製して大勢に見せる
// （複製の作り方は three.js の SkeletonUtils.clone と同じ。MIT License, Copyright 2010-2024 three.js authors）
import { THREE } from './engine.js';
import { GLTFLoader } from '../vendor/GLTFLoader.js';
import { VRMLoaderPlugin, VRMUtils } from '../vendor/three-vrm.module.min.js';

const loader = new GLTFLoader();
loader.register(p => new VRMLoaderPlugin(p));

export async function loadVRM(url, onProgress) {
  const g = await loader.loadAsync(url, e => onProgress && e.total && onProgress(e.loaded / e.total));
  const vrm = g.userData.vrm;
  VRMUtils.removeUnnecessaryVertices(g.scene);
  VRMUtils.combineSkeletons(g.scene);
  vrm.scene.traverse(o => { if (o.isMesh) o.frustumCulled = false; });
  const hips = vrm.humanoid.getNormalizedBoneNode('hips');
  vrm.restHipsY = hips.position.y;
  // 足元から頭のてっぺんまでの高さ（当たり判定の大きさに使う）
  vrm.scene.updateMatrixWorld(true);
  const head = vrm.humanoid.getRawBoneNode('head').getWorldPosition(new THREE.Vector3());
  vrm.headY = head.y;
  return vrm;
}

// ゾンビの材質：VRM の MToon を、場面の光を素直に受ける軽い材質に置き換える。輪郭線は描かない
const HIDDEN = new THREE.MeshBasicMaterial({ visible: false });
function lighten(m) {
  if (m.isOutline) return HIDDEN;
  const n = new THREE.MeshLambertMaterial({
    map: m.map || null, color: m.color ? m.color.clone() : new THREE.Color('#ffffff'),
    transparent: m.transparent, alphaTest: m.alphaTest || 0, side: m.side, depthWrite: m.depthWrite,
  });
  // 濁った緑みの陰
  n.emissive = new THREE.Color('#0b0d08');
  return n;
}
export function prepareZombieMaster(vrm) {
  const cache = new Map();
  const conv = m => { if (!cache.has(m)) cache.set(m, lighten(m)); return cache.get(m); };
  vrm.scene.traverse(o => {
    if (!o.isMesh) return;
    o.material = Array.isArray(o.material) ? o.material.map(conv) : conv(o.material);
    o.castShadow = false; o.receiveShadow = false;
  });
  // 表情は使わない（取り除いてある）。揺れものも無い
  return vrm;
}

function walk(a, b, fn) { fn(a, b); for (let i = 0; i < a.children.length; i++) walk(a.children[i], b.children[i], fn); }
function cloneScene(source) {
  const toClone = new Map(), toSrc = new Map();
  const copy = source.clone();
  walk(source, copy, (s, c) => { toSrc.set(c, s); toClone.set(s, c); });
  copy.traverse(node => {
    if (!node.isSkinnedMesh) return;
    const src = toSrc.get(node);
    node.skeleton = src.skeleton.clone();
    node.bindMatrix.copy(src.bindMatrix);
    node.skeleton.bones = src.skeleton.bones.map(b => toClone.get(b));
    node.bind(node.skeleton, node.bindMatrix);
  });
  return { copy, toClone };
}

// 当たり判定の球：[骨, 次の骨（中点を使う）, 半径, 部位]
const PARTS = [
  ['head', null, 0.16, 'head'],
  ['upperChest', null, 0.19, 'body'],
  ['spine', null, 0.18, 'body'],
  ['hips', null, 0.18, 'body'],
  ['leftUpperLeg', 'leftLowerLeg', 0.11, 'leg'],
  ['rightUpperLeg', 'rightLowerLeg', 0.11, 'leg'],
  ['leftLowerLeg', 'leftFoot', 0.09, 'leg'],
  ['rightLowerLeg', 'rightFoot', 0.09, 'leg'],
  ['leftUpperArm', 'leftLowerArm', 0.08, 'arm'],
  ['rightUpperArm', 'rightLowerArm', 0.08, 'arm'],
  ['leftLowerArm', 'leftHand', 0.07, 'arm'],
  ['rightLowerArm', 'rightHand', 0.07, 'arm'],
];

// ゾンビを1体分複製する。毎フレーム、元の VRM に姿勢をつけてから sync() で骨を写す
export function cloneZombie(master) {
  const { copy, toClone } = cloneScene(master.scene);
  const pairs = [];
  master.scene.traverse(o => { if (o.isBone || o.type === 'Bone') pairs.push([o, toClone.get(o)]); });
  const raw = n => { const b = master.humanoid.getRawBoneNode(n); return b ? toClone.get(b) : null; };
  const parts = PARTS.map(([a, b, r, kind]) => ({ a: raw(a) || raw('chest'), b: b ? raw(b) : null, r, kind, c: new THREE.Vector3() }));
  const headBone = raw('head');
  return {
    scene: copy, parts, headBone,
    bone: raw,
    sync() { for (const [a, b] of pairs) { b.quaternion.copy(a.quaternion); b.position.copy(a.position); } },
    // 当たり判定の球の中心を、今の姿勢で求める（scale：体の大きさ）
    updateParts(scale) {
      const tmp = new THREE.Vector3();
      for (const p of parts) {
        p.a.getWorldPosition(p.c);
        if (p.b) { p.b.getWorldPosition(tmp); p.c.add(tmp).multiplyScalar(0.5); }
        else if (p.kind === 'head') p.c.y += 0.08 * scale;
        p.rs = p.r * scale;
      }
    },
  };
}
