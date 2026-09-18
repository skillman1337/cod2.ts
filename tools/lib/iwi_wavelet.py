"""Portable equivalent of tools/vendor/iwi/decoder_core.inc (GPL-3.0).

Tables are parsed from the retained source rather than maintained twice. This
module needs no native compiler and is suitable for Pyodide. See the vendor
LICENSE and README.md for the upstream OpenAssetTools attribution.
"""
from pathlib import Path
import re
import struct

ESCAPE = -32768

def _load_tables():
    source = (Path(__file__).resolve().parents[1] / 'vendor/iwi/decoder_core.inc').read_text()
    tables = []
    for name in ('BLUE', 'RED_GREEN', 'ALPHA'):
        block = re.search(rf'{name}_CODEWORDS\s*=.*?\(\{{(.*?)\}}\);', source, re.S)
        if not block:
            raise RuntimeError(f'Missing wavelet codewords: {name}')
        table = [None] * 4096
        for code, length, value in re.findall(r'\{(0x[0-9A-Fa-f]+),\s*(\d+),\s*(-?\d+|ESCAPE_VALUE)\}', block.group(1)):
            code, length = int(code, 16), int(length)
            value = ESCAPE if value == 'ESCAPE_VALUE' else int(value)
            for suffix in range(1 << (12 - length)):
                index = code | (suffix << length)
                if table[index] is not None:
                    raise RuntimeError('Overlapping wavelet codewords')
                table[index] = (value, length)
        if any(item is None for item in table):
            raise RuntimeError('Incomplete wavelet lookup table')
        tables.append(table)
    return tables

_TABLES = None

class Reader:
    def __init__(self, data):
        self.data = data
        self.byte = 0
        self.bit = None
    def raw(self):
        if self.bit is not None or self.byte >= len(self.data):
            raise ValueError('Truncated/invalid wavelet raw level')
        value = self.data[self.byte]
        self.byte += 1
        return value
    def peek(self, count):
        if self.bit is None:
            self.bit = self.byte * 8
        start = self.bit // 8
        return (int.from_bytes(self.data[start:start + 6], 'little') >> (self.bit % 8)) & ((1 << count) - 1)
    def bits(self, count):
        value = self.peek(count)
        if count > 32 or self.bit + count > len(self.data) * 8:
            raise ValueError('Truncated wavelet bitstream')
        self.bit += count
        return value

def value(reader, table, escape_bits, bias):
    result, count = table[reader.peek(12)]
    reader.bits(count)
    return reader.bits(escape_bits) - bias if result == ESCAPE else result

def reconstruct(destination, at, width, channel, base, parity, coefficients):
    horizontal, vertical, diagonal = coefficients
    destination[at + channel] = (parity + ((diagonal + vertical + horizontal + 2 * base) >> 1)) & 255
    destination[at + 4 + channel] = ((horizontal + 2 * base - diagonal - vertical) >> 1) & 255
    destination[at + width * 4 + channel] = ((vertical - diagonal + 2 * base - horizontal) >> 1) & 255
    destination[at + width * 4 + 4 + channel] = ((2 * base - horizontal - vertical + diagonal) >> 1) & 255

def decode_bgra(data):
    global _TABLES
    if len(data) < 28 or data[:3] != b'IWi' or data[4] not in (6, 7):
        raise ValueError('Not a supported wavelet IWI')
    width, height = struct.unpack_from('<HH', data, 6)
    if not width or not height or width & (width - 1) or height & (height - 1) or width * height > 16_777_216:
        raise ValueError('Invalid or excessive wavelet dimensions')
    if _TABLES is None:
        _TABLES = _load_tables()
    blue, red_green, alpha = _TABLES
    channels = 4 if data[4] == 6 else 3
    reader = Reader(data[28:])
    previous = None
    for mip in range(max(width, height).bit_length() - 1, -1, -1):
        w, h = max(1, width >> mip), max(1, height >> mip)
        output = bytearray(w * h * 4)
        if w <= 1 or h <= 1:
            for at in range(0, len(output), 4):
                for c in range(channels):
                    output[at + c] = reader.raw()
                if channels == 3:
                    output[at + 3] = 255
        else:
            if previous is None or len(previous) < w * h:
                raise ValueError('Missing source wavelet mip')
            if reader.bits(1):
                previous = bytearray(previous)
                for at in range(0, w * h, 4):
                    for c in range(channels):
                        previous[at + c] = (previous[at + c] + value(reader, alpha, 9, 255)) & 255
            for y in range(0, h, 2):
                for x in range(0, w, 2):
                    src = ((y // 2) * (w // 2) + x // 2) * 4
                    at = (y * w + x) * 4
                    parity = reader.bits(1)
                    b = [value(reader, blue, 9, 255) for _ in range(3)]
                    reconstruct(output, at, w, 0, previous[src], parity, b)
                    for c in (1, 2):
                        parity = reader.bits(1)
                        coefficients = [value(reader, red_green, 10, 510) + b[i] for i in range(3)]
                        reconstruct(output, at, w, c, previous[src + c], parity, coefficients)
                    if channels == 3:
                        for offset in (0, 4, w * 4, w * 4 + 4):
                            output[at + offset + 3] = 255
                    else:
                        parity = reader.bits(1)
                        coefficients = [value(reader, alpha, 9, 255) for _ in range(3)]
                        reconstruct(output, at, w, 3, previous[src + 3], parity, coefficients)
        previous = output
    return width, height, bytes(previous)
