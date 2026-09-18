"""Retail v20 model decoding. Pure-code surface and vertex unpacking.

The returned mesh supports rigid and weighted vertices. Animation application is
performed by the caller; material rendering and collision are separate systems.
"""
import struct, math

def rotate(q,v):
    x,y,z,w=q
    t=[2*(y*v[2]-z*v[1]),2*(z*v[0]-x*v[2]),2*(x*v[1]-y*v[0])]
    return [v[0]+w*t[0]+y*t[2]-z*t[1],v[1]+w*t[1]+z*t[0]-x*t[2],v[2]+w*t[2]+x*t[1]-y*t[0]]

def multiply(a,b):
    x,y,z,w=a;X,Y,Z,W=b
    return [w*X+x*W+y*Z-z*Y,w*Y-x*Z+y*W+z*X,w*Z+x*Y-y*X+z*W,w*W-x*X-y*Y-z*Z]

def compose(parent,local):
    q,p=parent;r,t=local;v=rotate(q,t)
    return multiply(q,r),[v[i]+p[i] for i in range(3)]

IDENTITY=([0,0,0,1],[0,0,0])

def _unpack_surface(data, offset):
    flag = data[offset]; offset += 1
    nv, nt = struct.unpack_from('<HH', data, offset); offset += 4
    bone = struct.unpack_from('<h', data, offset)[0]; offset += 2

    if bone < 0:
        extra_size = struct.unpack_from('<H', data, offset)[0]
        offset += 2

    vb_out = bytearray()
    for _ in range(nv):
        normal = data[offset:offset+12]; offset += 12
        color = data[offset:offset+4]; offset += 4
        uv = data[offset:offset+8]; offset += 8
        tangent = data[offset:offset+12]; offset += 12
        binormal = data[offset:offset+12]; offset += 12
        u_val = uv[:4]
        v_val = uv[4:8]

        if bone < 0:
            extra = data[offset]; offset += 1
            primary_joint = struct.unpack_from('<h', data, offset)[0]; offset += 2
            pos = data[offset:offset+12]; offset += 12
            v_block = bytearray(64)
            v_block[0:12] = normal
            v_block[12:16] = color
            v_block[16:28] = tangent
            v_block[28:32] = u_val
            v_block[32:44] = binormal
            v_block[44:48] = v_val
            v_block[48:60] = pos
            v_block[60] = extra
            v_block[61] = 0
            struct.pack_into('<H', v_block, 62, primary_joint << 6)
            vb_out.extend(v_block)

            if extra > 0:
                pad = data[offset]; offset += 1
                for _ in range(extra):
                    joint = struct.unpack_from('<h', data, offset)[0]; offset += 2
                    pos_inf = data[offset:offset+12]; offset += 12
                    weight = struct.unpack_from('<H', data, offset)[0]; offset += 2
                    e_block = bytearray(16)
                    e_block[0:12] = pos_inf
                    struct.pack_into('<H', e_block, 12, joint << 6)
                    struct.pack_into('<H', e_block, 14, weight)
                    vb_out.extend(e_block)
        else:
            pos = data[offset:offset+12]; offset += 12
            v_block = bytearray(64)
            v_block[0:12] = normal
            v_block[12:16] = color
            v_block[16:28] = tangent
            v_block[28:32] = u_val
            v_block[32:44] = binormal
            v_block[44:48] = v_val
            v_block[48:60] = pos
            v_block[60] = 0
            v_block[61] = 0
            struct.pack_into('<H', v_block, 62, bone << 6)
            vb_out.extend(v_block)

    indices = bytearray()
    for _ in range(nt * 3):
        idx = data[offset:offset+2]; offset += 2
        indices.extend(idx)

    actual_nt = nt
    if nt % 2 != 0:
        actual_nt += 1
        indices.extend(indices[-2:] * 3)

    return offset, nv, actual_nt, bone, bytes(vb_out), bytes(indices)

class ModelDecoder:
    def __init__(self, dll=None, read=None):
        self.read = read
        self.cache = {}

    def load(self, name):
        name = name.removeprefix('xmodel/')
        if name in self.cache: return self.cache[name]
        model = self.read('xmodel/' + name)
        assert struct.unpack_from('<H', model)[0] == 20
        cursor = 27; lods = []
        for _ in range(4):
            cursor += 4; end = model.index(0, cursor); lods.append(model[cursor:end].decode()); cursor = end + 1
        cursor += 4
        collision_count = struct.unpack_from('<I', model, cursor)[0]; cursor += 4
        for _ in range(collision_count):
            triangles = struct.unpack_from('<I', model, cursor)[0]; cursor += 4 + triangles * 48 + 36
        count = struct.unpack_from('<H', model, cursor)[0]; cursor += 2; materials = []
        for _ in range(count):
            end = model.index(0, cursor); materials.append(model[cursor:end].decode()); cursor = end + 1
        encoded = self.read('xmodelsurfs/' + lods[0]); version, surfacecount = struct.unpack_from('<HH', encoded)
        assert version == 20 and surfacecount == count, (name, count, surfacecount)
        parts = self.read('xmodelparts/' + lods[0]); nonroots, roots = struct.unpack_from('<HH', parts, 2); cursor = 6; bones = []
        for _ in range(roots): bones.append(dict(parent=-1, pose=IDENTITY))
        for i in range(roots, roots + nonroots):
            parent = parts[cursor]; position = list(struct.unpack_from('<3f', parts, cursor + 1)); rotation = struct.unpack_from('<3h', parts, cursor + 13); cursor += 19
            w = math.floor(math.sqrt(max(0, 32767 ** 2 - sum(x * x for x in rotation))) + .5)
            assert parent < i
            bones.append(dict(parent=parent, pose=([x / 32767 for x in (*rotation, w)], position)))
        for bone in bones:
            end = parts.index(0, cursor); bone['name'] = parts[cursor:end].decode(); cursor = end + 1

        enc_cursor = 4
        surfaces = []
        for i in range(count):
            enc_cursor, nv, nt, bone, vb, ib_raw = _unpack_surface(encoded, enc_cursor)
            indices = struct.unpack('<' + 'H' * (nt * 3), ib_raw)
            vertices = []
            offset = 0
            for _ in range(nv):
                values = struct.unpack_from('<16f', vb, offset)
                influences = []
                extra = vb[offset + 60] if bone < 0 else 0
                primary = struct.unpack_from('<H', vb, offset + 62)[0] // 64 if bone < 0 else bone
                offset += 64
                total = 0
                for _ in range(extra):
                    px, py, pz, joint, weight = struct.unpack_from('<3fHH', vb, offset)
                    offset += 16
                    weight /= 65535
                    total += weight
                    influences.append((joint // 64, weight, [px, py, pz]))
                influences.insert(0, (primary, 1 - total, list(values[12:15])))
                assert all(j < len(bones) for j, w, p in influences)
                vertices.append(dict(
                    normal=list(values[:3]),
                    tangent=list(values[4:7]),
                    binormal=list(values[8:11]),
                    uv=[values[7], values[11]],
                    influences=influences
                ))
            assert offset == len(vb), (name, i, offset, len(vb))
            surfaces.append(dict(material=materials[i], vertices=vertices, indices=indices))
        assert enc_cursor == len(encoded), (enc_cursor, len(encoded))
        result = dict(name=name, bones=bones, surfaces=surfaces)
        self.cache[name] = result
        return result

def pose_model(model,channels=None,attachment=IDENTITY):
    transforms=[]
    for bone in model['bones']:
        q,p=bone['pose'];channel=(channels or {}).get(bone['name'],{})
        if channel.get('rotations'):q=channel['rotations'][0]
        if channel.get('translations'):p=channel['translations'][0]
        parent=transforms[bone['parent']] if bone['parent']>=0 else attachment
        transforms.append(compose(parent,(q,p)))
    return transforms

def skin_vertex(vertex,transforms):
    position=[0,0,0]
    for joint,weight,local in vertex['influences']:
        q,p=transforms[joint];v=rotate(q,local)
        for i in range(3):position[i]+=weight*(v[i]+p[i])
    q=transforms[vertex['influences'][0][0]][0]
    return position,rotate(q,vertex['normal']),rotate(q,vertex['tangent']),rotate(q,vertex['binormal'])
