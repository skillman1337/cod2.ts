import struct
from PIL import Image
IWI_FORMAT_DXT1=11
IWI_FORMAT_DXT3=12
IWI_FORMAT_DXT5=13
def _unpack_rgb565(value: int) -> tuple[int, int, int]:
    r = ((value >> 11) & 0x1F) * 255 // 31
    g = ((value >> 5) & 0x3F) * 255 // 63
    b = (value & 0x1F) * 255 // 31
    return r, g, b


def _dxt5_alpha_value(a0: int, a1: int, code: int) -> int:
    if code == 0:
        return a0
    if code == 1:
        return a1
    if a0 > a1:
        return ((8 - code) * a0 + (code - 1) * a1) // 7
    if code == 6:
        return 0
    if code == 7:
        return 255
    return ((6 - code) * a0 + (code - 1) * a1) // 5


def _decode_dxt5_block(block: bytes) -> list[list[tuple[int, int, int, int]]]:
    a0, a1 = block[0], block[1]
    alpha_bits = int.from_bytes(block[2:8], "little")
    c0, c1 = struct.unpack_from("<HH", block, 8)
    color_bits = int.from_bytes(block[12:16], "little")

    rgb0 = _unpack_rgb565(c0)
    rgb1 = _unpack_rgb565(c1)
    if c0 > c1:
        colors = [
            rgb0,
            rgb1,
            ((2 * rgb0[0] + rgb1[0]) // 3, (2 * rgb0[1] + rgb1[1]) // 3, (2 * rgb0[2] + rgb1[2]) // 3),
            ((rgb0[0] + 2 * rgb1[0]) // 3, (rgb0[1] + 2 * rgb1[1]) // 3, (rgb0[2] + 2 * rgb1[2]) // 3),
        ]
    else:
        colors = [rgb0, rgb1, ((rgb0[0] + rgb1[0]) // 2, (rgb0[1] + rgb1[1]) // 2, (rgb0[2] + rgb1[2]) // 2), (0, 0, 0)]

    out: list[list[tuple[int, int, int, int]]] = []
    for row in range(4):
        pixels: list[tuple[int, int, int, int]] = []
        for col in range(4):
            idx = row * 4 + col
            alpha_code = (alpha_bits >> (idx * 3)) & 0x7
            color_code = (color_bits >> (idx * 2)) & 0x3
            r, g, b = colors[color_code]
            pixels.append((r, g, b, _dxt5_alpha_value(a0, a1, alpha_code)))
        out.append(pixels)
    return out


def binarize_alpha(image: Image.Image, threshold: int = 8) -> Image.Image:
    px = image.load()
    width, height = image.size
    for y in range(height):
        for x in range(width):
            r, g, b, a = px[x, y]
            px[x, y] = (r, g, b, 255 if a >= threshold else 0)
    return image


def decode_dxt5(data: bytes, width: int, height: int) -> Image.Image:
    img = Image.new("RGBA", (width, height))
    px = img.load()
    blocks_x = max(1, width // 4)
    blocks_y = max(1, height // 4)
    offset = 0
    for by in range(blocks_y):
        for bx in range(blocks_x):
            block = data[offset : offset + 16]
            offset += 16
            decoded = _decode_dxt5_block(block)
            for row in range(4):
                for col in range(4):
                    x = bx * 4 + col
                    y = by * 4 + row
                    if x < width and y < height:
                        px[x, y] = decoded[row][col]
    return img


def _decode_dxt1_block(block: bytes) -> list[tuple[int, int, int, int]]:
    c0, c1 = struct.unpack_from("<HH", block, 0)
    color_bits = struct.unpack_from("<I", block, 4)[0]
    rgb0 = _unpack_rgb565(c0)
    rgb1 = _unpack_rgb565(c1)
    if c0 > c1:
        colors = [
            rgb0,
            rgb1,
            ((2 * rgb0[0] + rgb1[0]) // 3, (2 * rgb0[1] + rgb1[1]) // 3, (2 * rgb0[2] + rgb1[2]) // 3),
            ((rgb0[0] + 2 * rgb1[0]) // 3, (rgb0[1] + 2 * rgb1[1]) // 3, (rgb0[2] + 2 * rgb1[2]) // 3),
        ]
    else:
        colors = [rgb0, rgb1, ((rgb0[0] + rgb1[0]) // 2, (rgb0[1] + rgb1[1]) // 2, (rgb0[2] + rgb1[2]) // 2), (0, 0, 0)]

    out: list[tuple[int, int, int, int]] = []
    for i in range(16):
        r, g, b = colors[(color_bits >> (i * 2)) & 0x3]
        alpha = 0 if c0 <= c1 and (color_bits >> (i * 2)) & 0x3 == 3 else 255
        out.append((r, g, b, alpha))
    return out


def decode_dxt1(data: bytes, width: int, height: int) -> Image.Image:
    img = Image.new("RGBA", (width, height))
    px = img.load()
    blocks_x = max(1, (width + 3) // 4)
    blocks_y = max(1, (height + 3) // 4)
    offset = 0
    for by in range(blocks_y):
        for bx in range(blocks_x):
            block = data[offset : offset + 8]
            offset += 8
            decoded = _decode_dxt1_block(block)
            for row in range(4):
                for col in range(4):
                    x = bx * 4 + col
                    y = by * 4 + row
                    if x < width and y < height:
                        px[x, y] = decoded[row * 4 + col]
    return img


def _decode_dxt3_block(block: bytes) -> list[tuple[int, int, int, int]]:
    alphas: list[int] = []
    for row in range(4):
        word = struct.unpack_from("<H", block, row * 2)[0]
        for col in range(4):
            alphas.append(((word >> (col * 4)) & 0xF) * 17)

    c0, c1 = struct.unpack_from("<HH", block, 8)
    color_bits = struct.unpack_from("<I", block, 12)[0]
    rgb0 = _unpack_rgb565(c0)
    rgb1 = _unpack_rgb565(c1)
    if c0 > c1:
        colors = [
            rgb0,
            rgb1,
            ((2 * rgb0[0] + rgb1[0]) // 3, (2 * rgb0[1] + rgb1[1]) // 3, (2 * rgb0[2] + rgb1[2]) // 3),
            ((rgb0[0] + 2 * rgb1[0]) // 3, (rgb0[1] + 2 * rgb1[1]) // 3, (rgb0[2] + 2 * rgb1[2]) // 3),
        ]
    else:
        colors = [rgb0, rgb1, ((rgb0[0] + rgb1[0]) // 2, (rgb0[1] + rgb1[1]) // 2, (rgb0[2] + rgb1[2]) // 2), (0, 0, 0)]

    out: list[tuple[int, int, int, int]] = []
    for i in range(16):
        r, g, b = colors[(color_bits >> (i * 2)) & 0x3]
        out.append((r, g, b, alphas[i]))
    return out


def decode_dxt3(data: bytes, width: int, height: int) -> Image.Image:
    img = Image.new("RGBA", (width, height))
    px = img.load()
    blocks_x = max(1, (width + 3) // 4)
    blocks_y = max(1, (height + 3) // 4)
    offset = 0
    for by in range(blocks_y):
        for bx in range(blocks_x):
            block = data[offset : offset + 16]
            offset += 16
            decoded = _decode_dxt3_block(block)
            for row in range(4):
                for col in range(4):
                    x = bx * 4 + col
                    y = by * 4 + row
                    if x < width and y < height:
                        px[x, y] = decoded[row * 4 + col]
    return img


def _iwi_mip_maps(offsets: tuple[int, ...], first: int, file_size: int) -> list[tuple[int, int]]:
    """Match mauserzjeh/iwi offsets.mipMaps — largest mip is full resolution."""
    mipmaps: list[tuple[int, int]] = []
    for i, off in enumerate(offsets):
        if i == 0:
            mipmaps.append((off, file_size - off))
        elif i == len(offsets) - 1:
            mipmaps.append((first, off - first))
        else:
            mipmaps.append((off, offsets[i - 1] - off))
    return mipmaps


def read_iwi_mip0(data: bytes) -> tuple[int, int, int, bytes]:
    if len(data) < 28 or data[:3] != b"IWi":
        raise ValueError("not an IWI file")

    fmt, _usage, width, height, _depth = struct.unpack_from("<BBHHH", data, 4)
    if not width or not height or width * height > 16_777_216:
        raise ValueError('Invalid or excessive IWI dimensions')
    if fmt in (6, 7):
        return fmt, width, height, data[28:]
    offsets = struct.unpack_from("<4i", data, 12)
    file_size = len(data)
    first = 28

    tex_off, tex_size = max(_iwi_mip_maps(offsets, first, file_size), key=lambda item: item[1])
    tex_data = data[tex_off : tex_off + tex_size]

    if fmt not in (1, 2, 4, IWI_FORMAT_DXT1, IWI_FORMAT_DXT3, IWI_FORMAT_DXT5):
        raise ValueError(f"unsupported IWI format 0x{fmt:02x}")

    return fmt, width, height, tex_data


def read_iwi(data: bytes) -> tuple[int, int, Image.Image]:
    if len(data) >= 28 and data[:3] == b'IWi' and data[4] in (6, 7):
        from .iwi_wavelet import decode_bgra
        width, height, pixels = decode_bgra(data)
        return width, height, Image.frombytes('RGBA', (width, height), pixels, 'raw', 'BGRA')
    fmt, width, height, tex_data = read_iwi_mip0(data)
    if fmt==4:
        image=Image.new('RGBA',(width,height),(255,255,255,255));image.putalpha(Image.frombytes('L',(width,height),tex_data[:width*height]));return width,height,image
    if fmt in (1,2):
        mode='BGRA' if fmt==1 else 'BGR'
        size=width*height*(4 if fmt==1 else 3)
        return width,height,Image.frombytes('RGBA' if fmt==1 else 'RGB',(width,height),tex_data[:size],'raw',mode).convert('RGBA')
    if fmt == IWI_FORMAT_DXT1:
        return width, height, decode_dxt1(tex_data, width, height)
    if fmt == IWI_FORMAT_DXT3:
        return width, height, decode_dxt3(tex_data, width, height)
    return width, height, decode_dxt5(tex_data, width, height)


