#!/usr/bin/env python3
"""人間の VRM から、ゾンビの VRM を作る（肌・目・服・髪の画像を塗り替えて、軽くする）。

  python3 tools/vrm_zombie.py 元.vrm 出力.vrm [--skin green|gray|purple] [--seed 1] [--blood 1.0] [--tex 256]

  --skin   肌の色の系統（green：緑がかった灰色／gray：土気色／purple：紫がかった死斑）
  --seed   汚れと血の付き方を変える乱数の種（同じ元でも別のゾンビに見せる）
  --blood  服と肌の血の量（0 で付けない）
  --tex    画像の大きさの上限（ゾンビは暗い場所で動くので 256 で十分）
表情とモーフ、揺れもの（スプリングボーン）は取り除く。
仕上げに tools/vrm_lite.py で、使っていないデータを取り除いて画像を縮める。
"""
import argparse, io, os, subprocess, sys, tempfile
import numpy as np
from PIL import Image, ImageFilter
sys.path.insert(0, os.path.dirname(__file__))
from vrm_lite import read_glb, write_glb

SKIN = {
    'green': (0.60, 0.68, 0.52),
    'gray': (0.70, 0.64, 0.56),
    'purple': (0.62, 0.55, 0.62),
}


def textures_of(m):
    """材質が使う画像の番号（texture の index）をすべて集める"""
    found = set()
    def walk(o):
        if isinstance(o, dict):
            for k, v in o.items():
                if k == 'index' and isinstance(v, int): found.add(v)
                else: walk(v)
        elif isinstance(o, list):
            for v in o: walk(v)
    walk({k: v for k, v in m.items() if k != 'name'})
    return found


def blobs(rng, h, w, n, rmin, rmax, soft=2.0):
    """丸い染みを n 個置いた濃さの地図（0〜1）"""
    yy, xx = np.mgrid[0:h, 0:w]
    out = np.zeros((h, w), np.float32)
    for _ in range(n):
        cy, cx = rng.uniform(0, h), rng.uniform(0, w)
        r = rng.uniform(rmin, rmax) * min(h, w)
        # 少し楕円にして、縁をぼかす
        sy, sx = rng.uniform(0.6, 1.4), rng.uniform(0.6, 1.4)
        d = np.sqrt(((yy - cy) / sy) ** 2 + ((xx - cx) / sx) ** 2) / r
        out = np.maximum(out, np.clip((1 - d) * soft, 0, 1))
    return out


def noise(rng, h, w, scale):
    """ざらついた汚れ（低解像度の乱数を引き伸ばす）"""
    small = rng.uniform(0, 1, (max(2, h // scale), max(2, w // scale))).astype(np.float32)
    im = Image.fromarray((small * 255).astype(np.uint8)).resize((w, h), Image.BICUBIC)
    return np.asarray(im, np.float32) / 255


def load(data):
    im = Image.open(io.BytesIO(data)).convert('RGBA')
    a = np.asarray(im, np.float32) / 255
    return a[..., :3].copy(), a[..., 3:].copy()


def save(rgb, alpha):
    a = np.concatenate([np.clip(rgb, 0, 1), alpha], axis=2)
    out = io.BytesIO()
    Image.fromarray((a * 255 + 0.5).astype(np.uint8), 'RGBA').save(out, 'PNG', optimize=True)
    return out.getvalue()


def lum(rgb):
    return (0.3 * rgb[..., 0] + 0.59 * rgb[..., 1] + 0.11 * rgb[..., 2])[..., None]


def blood_layer(rng, rgb, amount, n, rmin, rmax):
    h, w = rgb.shape[:2]
    m = blobs(rng, h, w, n, rmin, rmax) * amount
    m = np.clip(m * (0.6 + 0.6 * noise(rng, h, w, 6)), 0, 1)[..., None]
    dark = np.array([0.32, 0.03, 0.03], np.float32)
    return rgb * (1 - m * 0.85) + dark * lum(rgb).clip(0.25, 1) * m * 0.85


def skin_fn(rng, rgb, base, blood):
    h, w = rgb.shape[:2]
    l = lum(rgb)
    out = np.array(base, np.float32) * (l / 0.75).clip(0, 1.2)
    # 死斑（紫がかった染み）と、くすみ
    spots = blobs(rng, h, w, 14, 0.03, 0.10)[..., None]
    out = out * (1 - spots * 0.35) + np.array([0.30, 0.20, 0.30], np.float32) * spots * 0.35
    out *= (0.82 + 0.25 * noise(rng, h, w, 8))[..., None]
    return blood_layer(rng, out, blood, 6, 0.02, 0.07)


def cloth_fn(rng, rgb, blood):
    h, w = rgb.shape[:2]
    l = lum(rgb)
    out = rgb * 0.45 + l * 0.55                 # 色あせ
    out = out * 0.72 + np.array([0.06, 0.05, 0.03], np.float32)   # 土埃で黄ばむ
    out *= (0.7 + 0.4 * noise(rng, h, w, 5))[..., None]            # 汚れのむら
    return blood_layer(rng, out, blood, 10, 0.03, 0.12)


def hair_fn(rng, rgb):
    h, w = rgb.shape[:2]
    l = lum(rgb)
    out = rgb * 0.3 + l * 0.7
    return out * 0.7 * (0.8 + 0.3 * noise(rng, h, w, 4))[..., None]


def iris_fn(rgb):
    # 濁った白目がちの目
    l = lum(rgb)
    return np.array([0.78, 0.76, 0.66], np.float32) * (0.55 + 0.45 * l)


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument('src'); ap.add_argument('dst')
    ap.add_argument('--skin', choices=SKIN, default='green')
    ap.add_argument('--seed', type=int, default=1)
    ap.add_argument('--blood', type=float, default=1.0)
    ap.add_argument('--tex', type=int, default=256)
    o = ap.parse_args()
    rng = np.random.default_rng(o.seed)
    j, binary = read_glb(o.src)
    view = lambda i: bytes(binary[j['bufferViews'][i].get('byteOffset', 0):][:j['bufferViews'][i]['byteLength']])
    data = {i: view(i) for i in range(len(j['bufferViews']))}

    # 材質の名前（VRoid の命名）で、画像の種類を見分ける
    kind = {}
    for m in j.get('materials', []):
        n = m.get('name', '')
        u = n.upper()
        k = ('iris' if 'EYEIRIS' in u else 'highlight' if 'EYEHIGHLIGHT' in u else
             'skin' if 'SKIN' in u else 'hair' if 'HAIR' in u else 'cloth' if 'CLOTH' in u else None)
        if not k: continue
        for ti in textures_of(m):
            src = j['textures'][ti].get('source')
            if src is not None: kind.setdefault(src, k)

    for ii, im in enumerate(j.get('images', [])):
        if 'bufferView' not in im or ii not in kind: continue
        raw = data[im['bufferView']]
        pil = Image.open(io.BytesIO(raw))
        if max(pil.size) > o.tex * 2:   # 先に縮めて計算を軽くする（仕上げで o.tex まで縮める）
            s = o.tex * 2 / max(pil.size)
            pil = pil.resize((round(pil.width * s), round(pil.height * s)), Image.LANCZOS)
            buf = io.BytesIO(); pil.save(buf, 'PNG'); raw = buf.getvalue()
        rgb, a = load(raw)
        k = kind[ii]
        if k == 'skin': rgb = skin_fn(rng, rgb, SKIN[o.skin], o.blood * 0.6)
        elif k == 'cloth': rgb = cloth_fn(rng, rgb, o.blood)
        elif k == 'hair': rgb = hair_fn(rng, rgb)
        elif k == 'iris': rgb = iris_fn(rgb)
        elif k == 'highlight': a = a * 0   # 目の光を消す
        data[im['bufferView']] = save(rgb, a)
        im['mimeType'] = 'image/png'

    # 表情・モーフの結び付きと、揺れものを取り除く
    vrm = j['extensions']['VRMC_vrm']
    for grp in ('preset', 'custom'):
        for e in vrm.get('expressions', {}).get(grp, {}).values():
            e.pop('morphTargetBinds', None); e.pop('materialColorBinds', None); e.pop('textureTransformBinds', None)
    j['extensions'].pop('VRMC_springBone', None)
    if 'extensionsUsed' in j: j['extensionsUsed'] = [x for x in j['extensionsUsed'] if x != 'VRMC_springBone']

    with tempfile.NamedTemporaryFile(suffix='.vrm', delete=False) as t: tmp = t.name
    write_glb(tmp, j, [data[i] for i in range(len(j['bufferViews']))])
    subprocess.run([sys.executable, os.path.join(os.path.dirname(__file__), 'vrm_lite.py'), tmp, o.dst, '--tex', str(o.tex), '--no-morph-normals'], check=True)
    os.unlink(tmp)
    print(o.dst, os.path.getsize(o.dst) // 1024, 'KB')


if __name__ == '__main__':
    main()
