"""GPU-ready mip payloads retain RGB even when alpha is zero."""
from PIL import Image

def write_rgba_mips(image,path,size=512):
    # RGBA resize premultiplies in Pillow. D3D samples independent channels;
    # multiply shaders can intentionally read RGB from transparent texels.
    bands=image.convert('RGBA').split();payload=bytearray()
    for mip in range(size.bit_length()):
        edge=max(1,size>>mip)
        payload+=Image.merge('RGBA',tuple(band.resize((edge,edge),Image.Resampling.LANCZOS) for band in bands)).tobytes()
    path.write_bytes(payload)


def decode_rgba_image(data):
    """Decode using the original viewmodel/character/effect image policy."""
    from .iwi import read_iwi, read_iwi_mip0
    fmt, width, height, pixels = read_iwi_mip0(data)
    if fmt in (11, 12, 13):
        return Image.frombytes(
            'RGBA', (width, height), pixels, 'bcn',
            ({11: 1, 12: 2, 13: 3}[fmt], {11: 'DXT1', 12: 'DXT3', 13: 'DXT5'}[fmt]),
        )
    return read_iwi(data)[2]
