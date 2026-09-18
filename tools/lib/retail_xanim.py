"""v14 channel reader: original loader 0x48ef60 / Mach-O 0xba204, quaternion decoder 0x48edb0."""
import struct, math

def decode_xanim(data):
    version, frames, count, flags, rate = struct.unpack_from('<HHHBH', data)
    assert version == 14, f'Unsupported xanim version {version}'
    loop = bool(flags & 1)
    has_delta = bool(flags & 2)
    max_frames = frames + (1 if loop else 0)
    cursor = 9

    def read(fmt):
        nonlocal cursor
        values = struct.unpack_from('<' + fmt, data, cursor)
        cursor += struct.calcsize('<' + fmt)
        return values

    def times(n):
        if n > 1 and n < max_frames:
            return list(read(('B' if max_frames <= 256 else 'H') * n))
        return list(range(n))

    delta = None
    if has_delta:
        n_rot = read('H')[0]
        rt = times(n_rot)
        rot = []
        for _ in range(n_rot):
            v = read('h')[0]
            rem = max(0, 0x3fff0001 - v * v)
            w = math.floor(math.sqrt(rem) + 0.5)
            rot.append([0.0, 0.0, v / 16384.0, w / 16384.0])
        n_trans = read('H')[0]
        tt = times(n_trans)
        trans = [list(read('3f')) for _ in range(n_trans)]
        delta = dict(rotation_times=rt, rotations=rot, translation_times=tt, translations=trans)

    size = (count + 7) // 8
    flip = data[cursor:cursor + size]
    simple = data[cursor + size:cursor + size * 2]
    cursor += size * 2

    names = []
    for _ in range(count):
        end = data.index(0, cursor)
        names.append(data[cursor:end].decode('ascii', errors='ignore'))
        cursor = end + 1

    channels = {}
    for i, name in enumerate(names):
        n = read('H')[0]
        rt = times(n)
        rot = []
        for k in range(n):
            q = list(read('h' if simple[i >> 3] & (1 << (i & 7)) else '3h'))
            if len(q) == 1:
                q = [0, 0, q[0]]
            q.append(math.floor(math.sqrt(max(0, 32767 ** 2 - sum(x * x for x in q))) + 0.5))
            if (not k and flip[i >> 3] & (1 << (i & 7))) or (k and sum(a * b for a, b in zip(q, rot[-1])) < 0):
                q = [-x for x in q]
            rot.append(q)
        n = read('H')[0]
        tt = times(n)
        translations = [list(read('3f')) for _ in range(n)]
        channels[name] = dict(
            rotation_times=rt,
            rotations=[[x / 32767.0 for x in q] for q in rot],
            translation_times=tt,
            translations=translations
        )

    return dict(frames=frames, rate=rate, loop=loop, delta=delta, channels=channels)
