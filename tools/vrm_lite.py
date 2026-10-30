"""VRM 1.0（GLB）を軽くする。
   - テクスチャを指定の大きさまで縮小する（サムネイルは256px）
   - 表情に使われていない顔のモーフ（シェイプキー）を取り除く
   - --no-morph-normals でモーフの法線も取り除く（ゲーム内用）
   使い方: python3 tools/vrm_lite.py 入力.vrm 出力.vrm --tex 512 [--no-morph-normals]
"""
import argparse, io, json, struct
from PIL import Image


def read_glb(path):
    b = open(path, 'rb').read()
    clen, _ = struct.unpack('<II', b[12:20])
    j = json.loads(b[20:20 + clen])
    blen, _ = struct.unpack('<II', b[20 + clen:28 + clen])
    return j, b[28 + clen:28 + clen + blen]


def write_glb(path, j, chunks):
    binary = bytearray()
    for i, data in enumerate(chunks):
        while len(binary) % 4: binary.append(0)
        j['bufferViews'][i]['byteOffset'] = len(binary)
        j['bufferViews'][i]['byteLength'] = len(data)
        binary += data
    while len(binary) % 4: binary.append(0)
    j['buffers'] = [{'byteLength': len(binary)}]
    js = json.dumps(j, ensure_ascii=False, separators=(',', ':')).encode()
    js += b' ' * ((4 - len(js) % 4) % 4)
    total = 12 + 8 + len(js) + 8 + len(binary)
    with open(path, 'wb') as f:
        f.write(struct.pack('<4sII', b'glTF', 2, total))
        f.write(struct.pack('<II', len(js), 0x4E4F534A)); f.write(js)
        f.write(struct.pack('<II', len(binary), 0x004E4942)); f.write(binary)


def shrink(data, limit):
    im = Image.open(io.BytesIO(data))
    if max(im.size) <= limit: return data, None
    s = limit / max(im.size)
    im = im.resize((max(1, round(im.width * s)), max(1, round(im.height * s))), Image.LANCZOS)
    out = io.BytesIO(); im.save(out, 'PNG', optimize=True)
    return out.getvalue(), 'image/png'


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument('src'); ap.add_argument('dst')
    ap.add_argument('--tex', type=int, default=1024)
    ap.add_argument('--no-morph-normals', action='store_true')
    a = ap.parse_args()
    j, binary = read_glb(a.src)
    view = lambda i: binary[j['bufferViews'][i].get('byteOffset', 0):][:j['bufferViews'][i]['byteLength']]
    vrm = j['extensions']['VRMC_vrm']

    # 表情が使うモーフだけを残す（メッシュごとに番号を振り直す）
    exprs = [e for grp in ('preset', 'custom') for e in vrm.get('expressions', {}).get(grp, {}).values()]
    used = {}
    for e in exprs:
        for bind in e.get('morphTargetBinds', []):
            used.setdefault(j['nodes'][bind['node']]['mesh'], set()).add(bind['index'])
    remap = {}
    for mi, m in enumerate(j['meshes']):
        n = len(m['primitives'][0].get('targets', []))
        if not n: continue
        keep = sorted(used.get(mi, ()))
        remap[mi] = {old: new for new, old in enumerate(keep)}
        for p in m['primitives']:
            p['targets'] = [p['targets'][k] for k in keep]
            if a.no_morph_normals:
                for t in p['targets']: t.pop('NORMAL', None); t.pop('TANGENT', None)
            if not p['targets']: del p['targets']
            names = p.get('extras', {}).get('targetNames')
            if names: p['extras']['targetNames'] = [names[k] for k in keep]
        names = m.get('extras', {}).get('targetNames')
        if names: m['extras']['targetNames'] = [names[k] for k in keep]
        if 'weights' in m: m['weights'] = [m['weights'][k] for k in keep] or None
        if m.get('weights') is None: m.pop('weights', None)
    for e in exprs:
        for bind in e.get('morphTargetBinds', []):
            bind['index'] = remap[j['nodes'][bind['node']]['mesh']][bind['index']]

    # 使われているアクセサとバッファビューだけを残す
    acc_used = set()
    for m in j['meshes']:
        for p in m['primitives']:
            acc_used.update(p['attributes'].values())
            if 'indices' in p: acc_used.add(p['indices'])
            for t in p.get('targets', []): acc_used.update(t.values())
    for s in j.get('skins', []):
        if 'inverseBindMatrices' in s: acc_used.add(s['inverseBindMatrices'])
    for an in j.get('animations', []):
        for sm in an['samplers']: acc_used.update((sm['input'], sm['output']))
    acc_map = {old: new for new, old in enumerate(sorted(acc_used))}
    j['accessors'] = [j['accessors'][i] for i in sorted(acc_used)]
    fix = lambda d: {k: acc_map[v] for k, v in d.items()}
    for m in j['meshes']:
        for p in m['primitives']:
            p['attributes'] = fix(p['attributes'])
            if 'indices' in p: p['indices'] = acc_map[p['indices']]
            if 'targets' in p: p['targets'] = [fix(t) for t in p['targets']]
    for s in j.get('skins', []):
        if 'inverseBindMatrices' in s: s['inverseBindMatrices'] = acc_map[s['inverseBindMatrices']]
    for an in j.get('animations', []):
        for sm in an['samplers']: sm['input'], sm['output'] = acc_map[sm['input']], acc_map[sm['output']]

    thumb = vrm.get('meta', {}).get('thumbnailImage')
    bv_used = sorted({ac['bufferView'] for ac in j['accessors'] if 'bufferView' in ac} |
                     {im['bufferView'] for im in j.get('images', []) if 'bufferView' in im})
    bv_map = {old: new for new, old in enumerate(bv_used)}
    data = {}
    for old in bv_used: data[old] = bytes(view(old))
    for ii, im in enumerate(j.get('images', [])):
        if 'bufferView' not in im: continue
        out, mime = shrink(data[im['bufferView']], 256 if ii == thumb else a.tex)
        data[im['bufferView']] = out
        if mime: im['mimeType'] = mime
    j['bufferViews'] = [j['bufferViews'][i] for i in bv_used]
    for ac in j['accessors']:
        if 'bufferView' in ac: ac['bufferView'] = bv_map[ac['bufferView']]
    for im in j.get('images', []):
        if 'bufferView' in im: im['bufferView'] = bv_map[im['bufferView']]
    for bv in j['bufferViews']: bv['buffer'] = 0
    write_glb(a.dst, j, [data[i] for i in bv_used])


if __name__ == '__main__':
    main()
