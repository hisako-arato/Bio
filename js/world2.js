// 第2章の地図：教会の礼拝堂・地下墓所・納骨堂（村から離れた x=125〜175 に置く）
import { THREE, M, TEX, mat, tiled, rand } from './engine.js';
import { boxes, circles, regions, setTarget, place, box, cylinder, crate, barrel, gate, gates, flushStatic, removeCollider, restoreCollider } from './world.js';

export const spots2 = {};
export const steles = [];   // 封印の石碑 { x, z, mesh, rune, done }

const stoneDark = mat('#ffffff', { map: tiled(TEX.stone, 1, 1), color: '#b8b0b8' });
const floorTile = mat('#ffffff', { map: TEX.stone, color: '#c0b8b8' });
const ceilingM = mat('#2a2226');
const candleM = mat('#f0e0c0', { emissive: '#ffb050', emissiveIntensity: 1.5 });
const glassM = mat('#304060', { emissive: '#1a2a50', emissiveIntensity: 0.9 });
const boneM = mat('#cfc4a8');
const runeOn = () => new THREE.MeshBasicMaterial({ color: '#ff4a2a' });

// 床と天井（1枚の板）
function slab(x1, z1, x2, z2, y, material, down = false) {
  const g = new THREE.PlaneGeometry(x2 - x1, z2 - z1).rotateX(down ? Math.PI / 2 : -Math.PI / 2);
  const uv = g.attributes.uv;
  for (let i = 0; i < uv.count; i++) uv.setXY(i, uv.getX(i) * (x2 - x1) / 3, uv.getY(i) * (z2 - z1) / 3);
  place(g, material, (x1 + x2) / 2, y, (z1 + z2) / 2);
}
// 壁（当たり判定つきの箱、x1<x2・z1<z2）
function wallBox(x1, z1, x2, z2, h, material = M.stone) {
  box(x2 - x1, h, z2 - z1, material, (x1 + x2) / 2, 0, (z1 + z2) / 2, { tile: 2.5 });
}
function candleStand(x, z, h = 1.1) {
  cylinder(0.05, 0.12, h, M.iron, x, 0, z, 6, false);
  for (const dx of [-0.1, 0, 0.1]) place(new THREE.CylinderGeometry(0.025, 0.025, 0.16, 6), candleM, x + dx, h + 0.08 + (dx ? 0 : 0.04), z);
}

// ■ 礼拝堂：x 140〜160、z -30〜10。入口は南、祭壇は北
function nave() {
  const H = 8;
  slab(140, -30, 160, 10, 0.01, floorTile);
  slab(140, -30, 160, 10, H, ceilingM, true);
  // 外壁（側面の扉の所は開けておき、門でふさぐ）
  wallBox(139, -31, 140, -11.5, H); wallBox(139, -8.5, 140, 11, H);
  wallBox(160, -31, 161, -11.5, H); wallBox(160, -8.5, 161, 0.5, H); wallBox(160, 3.5, 161, 11, H);
  wallBox(140, 10, 160, 11, H);
  wallBox(140, -31, 148.5, -30, H); wallBox(151.5, -31, 160, -30, H);
  place(new THREE.BoxGeometry(3.2, 4.2, 0.2), M.darkWood, 150, 2.1, 9.9);   // 入口の扉（閉じている）
  // 側面の小部屋（ゾンビが入ってくる所）
  wallBox(133, -13, 139, -12, 4); wallBox(133, -8, 139, -7, 4); wallBox(132, -13, 133, -7, 4);
  wallBox(161, -13, 167, -12, 4); wallBox(161, -8, 167, -7, 4); wallBox(167, -13, 168, -7, 4);
  wallBox(161, -1, 167, 0, 4); wallBox(161, 4, 167, 5, 4); wallBox(167, -1, 168, 5, 4);
  // 柱
  for (const x of [144.5, 155.5]) for (const z of [-24, -17, -10, -3, 4]) {
    cylinder(0.5, 0.55, H, M.stone, x, 0, z, 10);
    place(new THREE.BoxGeometry(1.3, 0.4, 1.3), M.stone, x, 0.2, z);
  }
  // 窓（青い光）
  for (const z of [-20, -6, 6]) { place(new THREE.BoxGeometry(0.1, 3, 1.2), glassM, 140.06, 4.5, z); place(new THREE.BoxGeometry(0.1, 3, 1.2), glassM, 159.94, 4.5, z); }
  place(new THREE.CircleGeometry(1.6, 18), glassM, 150, 6, -29.94);
  // 長椅子（左右に8列）
  for (let i = 0; i < 8; i++) {
    const z = -14 + i * 2.4;
    for (const cx of [145, 155]) {
      place(new THREE.BoxGeometry(5.6, 0.12, 0.55), M.wood, cx, 0.45, z);
      place(new THREE.BoxGeometry(5.6, 0.6, 0.08), M.wood, cx, 0.8, z + 0.28);
      for (const dx of [-2.6, 2.6]) place(new THREE.BoxGeometry(0.1, 0.9, 0.6), M.darkWood, cx + dx, 0.45, z);
      boxes.push({ x1: cx - 2.85, x2: cx + 2.85, z1: z - 0.32, z2: z + 0.34, h: 0.95 });
    }
  }
  // 祭壇
  place(new THREE.BoxGeometry(18, 0.12, 8), M.stone, 150, 0.06, -26);
  box(3.2, 1.1, 1.2, M.stone, 150, 0, -26);
  place(new THREE.BoxGeometry(3.4, 0.06, 1.3), mat('#7a1a1a'), 150, 1.12, -26);
  for (const dx of [-1.2, 1.2]) candleStand(150 + dx, -26.2, 1.12);
  candleStand(146, -24.5, 1.4); candleStand(154, -24.5, 1.4);
  // 十字架
  place(new THREE.BoxGeometry(0.3, 4, 0.3), M.darkWood, 150, 4, -29.6);
  place(new THREE.BoxGeometry(2.2, 0.3, 0.3), M.darkWood, 150, 5, -29.6);
  // 説教台（神父の日誌）
  box(0.8, 1.1, 0.6, M.darkWood, 145.6, 0, -21.5);
  spots2.priestFile = { x: 145.6, y: 1.12, z: -21.5 };
  spots2.altar = { x: 150, z: -24.4 };
  spots2.naveStart = { x: 150, z: 7, yaw: 0 };
  spots2.cryptDoor = { x: 150, z: -29 };
  spots2.naveSpawns = [{ x: 136, z: -10 }, { x: 164, z: -10 }, { x: 164, z: 2 }];
  spots2.naveCandles = [{ x: 150, y: 2.2, z: -24 }, { x: 150, y: 5, z: -4 }];
  crate(141, 8.5, { kind: 'ammo', n: 8 }); crate(159, -28.5, { kind: 'herb', n: 1 }); barrel(141, -28.6, { kind: 'gold', n: 300 });
}

// ■ 地下墓所：4m 四方のマス。行 0 が南（礼拝堂の側）、上の行ほど北
// # 壁　. 床　E 入口　S 封印の石碑　C 木箱　R 這うゾンビ　Z 歩くゾンビ　D ファイル　M 商人　G 納骨堂への扉
const CRYPT = [
  '#####E#####',
  '#C..Z..M.C#',
  '#.R.....R.#',
  '#...#.#...#',
  '###.#D#.###',
  '#.C.....C.#',
  '#..##.##..#',
  '#S.#...#.S#',
  '#..#.C.#..#',
  '#R.#.Z.#.R#',
  '##.#####.##',
  '##.Z.S...##',
  '#####G#####',
];
const CX0 = 128, CZ0 = -34, CELL = 4, CH = 3.4;
const cell = (c, r) => ({ x: CX0 + c * CELL + CELL / 2, z: CZ0 - r * CELL - CELL / 2 });
function crypt() {
  const W = CRYPT[0].length, R = CRYPT.length;
  slab(CX0, CZ0 - R * CELL, CX0 + W * CELL, CZ0, 0.01, floorTile);
  slab(CX0, CZ0 - R * CELL, CX0 + W * CELL, CZ0, CH, ceilingM, true);
  // 礼拝堂からの階段の通路
  wallBox(128, -34, 148, -31, CH, stoneDark); wallBox(152, -34, 172, -31, CH, stoneDark);
  slab(148, -34, 152, -30, 0.01, floorTile); slab(148, -34, 152, -30, CH, ceilingM, true);
  spots2.cryptZ = []; spots2.cryptR = []; spots2.cryptSpawns = [];
  for (let r = 0; r < R; r++) for (let c = 0; c < W; c++) {
    const ch = CRYPT[r][c], { x, z } = cell(c, r);
    if (ch === '#') { wallBox(x - 2, z - 2, x + 2, z + 2, CH, stoneDark); continue; }
    if (ch === 'S') {
      // 封印の石碑：赤い印が光っている。調べると消える
      place(new THREE.BoxGeometry(1.1, 0.3, 0.7), M.stone, x, 0.15, z);
      const m = new THREE.Mesh(new THREE.BoxGeometry(0.9, 1.7, 0.35), M.stone); m.position.set(x, 1.0, z); regions.church.add(m);
      const rune = new THREE.Mesh(new THREE.CircleGeometry(0.22, 12), runeOn()); rune.position.set(x, 1.25, z + 0.18); regions.church.add(rune);
      const rune2 = rune.clone(); rune2.position.z = z - 0.18; rune2.rotation.y = Math.PI; regions.church.add(rune2);
      circles.push({ x, z, r: 0.6, h: 1.8 });
      steles.push({ x, z, runes: [rune, rune2], done: false });
    }
    if (ch === 'C') crate(x + (rand() - 0.5), z + (rand() - 0.5), [{ kind: 'ammo', n: 8 }, { kind: 'gold', n: 250 }, { kind: 'herb', n: 1 }, { kind: 'shells', n: 4 }][(r + c) % 4]);
    if (ch === 'R') spots2.cryptR.push({ x, z });
    if (ch === 'Z') spots2.cryptZ.push({ x, z });
    if (ch === 'D') spots2.cryptFile = { x, z };
    if (ch === 'M') spots2.cryptMerchant = { x, z: z - 1 };
    if (ch === 'G') { gate('crypt', x - 2, x + 2, z, false, { bar: M.iron, rail: M.iron, h: CH, thick: 0.12 }); spots2.cryptGate = { x, z }; }
    if (ch === 'E') spots2.cryptStart = { x, z: z + 1.5, yaw: 0 };
    if (ch !== '#' && ch !== 'G' && ch !== 'E' && r > 4) spots2.cryptSpawns.push({ x, z });
  }
  // 壁ぎわの墓碑と骨（飾り）
  for (let i = 0; i < 40; i++) {
    const r = 1 + Math.floor(rand() * (R - 2)), c = 1 + Math.floor(rand() * (W - 2));
    if (CRYPT[r][c] !== '.') continue;
    const { x, z } = cell(c, r);
    place(new THREE.BoxGeometry(0.25, 0.1, 0.08), boneM, x + (rand() - 0.5) * 3, 0.05, z + (rand() - 0.5) * 3, rand() * 3);
  }
  spots2.cryptCandles = [cell(1, 7), cell(9, 7)].map(p => ({ x: p.x, y: 1.6, z: p.z + 1 }));
  for (const p of spots2.cryptCandles) candleStand(p.x + 0.8, p.z, 1.0);
}

// ■ 納骨堂：x 134〜166、z -116〜-86。四本の柱。奥（北）に出口
function ossuary() {
  const H = 6, x1 = 134, x2 = 166, z1 = -116, z2 = -86;
  slab(x1, z1, x2, z2, 0.01, floorTile);
  slab(x1, z1, x2, z2, H, ceilingM, true);
  wallBox(x1 - 1, z1 - 1, x1, z2, H); wallBox(x2, z1 - 1, x2 + 1, z2, H);
  wallBox(x1, z2, 148, z2 + 1, H); wallBox(152, z2, x2, z2 + 1, H);
  wallBox(x1, z1 - 1, 148, z1, H); wallBox(152, z1 - 1, x2, z1, H);
  gate('ossExit', 148, 152, -116.3, false, { bar: M.iron, rail: M.iron, h: 3.4, thick: 0.12 });
  wallBox(147, -120, 148, -116, 3.4); wallBox(152, -120, 153, -116, 3.4); wallBox(147, -121, 153, -120, 3.4);
  slab(148, -120, 152, -116, 0.01, floorTile);
  // 柱（大男の突進がぶつかる）
  for (const [x, z] of [[142, -94], [158, -94], [142, -108], [158, -108]]) {
    cylinder(1.1, 1.2, H, M.stone, x, 0, z, 12);
  }
  // 骨の山と頭骨の棚
  for (let i = 0; i < 14; i++) {
    const x = x1 + 1.5 + rand() * (x2 - x1 - 3), z = z1 + 1.5 + rand() * (z2 - z1 - 3);
    if (Math.abs(x - 150) < 5 && z > -100) continue;
    for (let k = 0; k < 6; k++) place(new THREE.BoxGeometry(0.3, 0.08, 0.08), boneM, x + (rand() - 0.5) * 0.9, 0.05 + k * 0.05, z + (rand() - 0.5) * 0.9, rand() * 3);
    place(new THREE.SphereGeometry(0.12, 6, 5), boneM, x, 0.3, z);
  }
  for (const x of [x1 + 0.4, x2 - 0.4]) for (let k = 0; k < 6; k++) place(new THREE.BoxGeometry(0.5, 0.08, 6), M.darkWood, x, 0.8 + k * 0.7, -101);
  barrel(x1 + 1.5, z2 - 1.5, { kind: 'ammo', n: 10 }); crate(x2 - 1.5, z2 - 1.5, { kind: 'herb', n: 1 }); crate(x1 + 1.5, z1 + 2, { kind: 'shells', n: 4 }); crate(x2 - 1.5, z1 + 2, { kind: 'ammo', n: 10 });
  spots2.ossStart = { x: 150, z: -88.5, yaw: 0 };
  spots2.boss = { x: 150, z: -108 };
  spots2.ossSpawns = [{ x: 136, z: -88 }, { x: 164, z: -88 }, { x: 136, z: -114 }, { x: 164, z: -114 }];
  spots2.ossExit = { x: 150, z: -118 };
  spots2.ossCandles = [{ x: 150, y: 3, z: -100 }, { x: 150, y: 2, z: -114 }];
  candleStand(146, -114.5, 1.3); candleStand(154, -114.5, 1.3);
}

export function buildChurch() {
  setTarget(regions.church);
  nave();
  // 側面の扉（はじめは閉じている。襲撃でゾンビが破って入ってくる）
  gateZ('sideW', 139.5, -11.5, -8.5);
  gateZ('sideE', 160.5, -11.5, -8.5);
  gateZ('sideE2', 160.5, 0.5, 3.5);
  gate('cryptDoor', 148.5, 151.5, -30.5, false, { bar: M.iron, rail: M.iron, h: 3.2, thick: 0.12 });
  crypt();
  ossuary();
  flushStatic();
  setTarget(regions.village);
  regions.church.visible = false;
}

// z 方向に並ぶ扉（側面の壁に付く）。world.js の gate は x 方向だけなので、ここで作る
function gateZ(name, x, z1, z2) {
  const g = new THREE.Group();
  const d = z2 - z1;
  for (let i = 0; i < 6; i++) {
    const p = new THREE.Mesh(new THREE.BoxGeometry(0.12, 3, d / 6 - 0.04), M.darkWood);
    p.position.set(x, 1.5, z1 + d / 12 + i * d / 6); g.add(p);
  }
  regions.church.add(g);
  const id = 'gate-' + name;
  boxes.push({ x1: x - 0.3, x2: x + 0.3, z1, z2, h: 3, id });
  gates[name] = { g, id, set(o) { g.visible = !o; o ? removeCollider(id) : restoreCollider(id); } };
}
