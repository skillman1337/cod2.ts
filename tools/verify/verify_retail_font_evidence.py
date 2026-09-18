"""Validate the bounded UI_FONT_NORMAL selector against original x86 bytes.

Requires pefile and unicorn. This is not whole-renderer equivalence or an exact-IR proof.
The candidate renderer is frozen by hash before native execution; discrepancies fail.
"""

# Locate shared tools from both the checkout and the browser's virtual filesystem.
import sys as _tool_sys
from pathlib import Path as _ToolPath
_tool_sys.path.insert(0, str(next(p for p in _ToolPath(__file__).resolve().parents
                                    if (p / 'lib/project.py').is_file())))
from lib.project import ROOT as _PROJECT_ROOT, tool_script as _tool_script

import argparse
import hashlib
import json
from pathlib import Path
import re
import struct

import pefile
from unicorn import Uc, UC_ARCH_X86, UC_MODE_32
from unicorn.x86_const import UC_X86_REG_EAX, UC_X86_REG_ESP, UC_X86_REG_FPCW


def f32(value):
    return struct.unpack('<f', struct.pack('<f', value))[0]


def expected_font(height, scale):
    physical = f32(f32(scale) * f32(height * f32(1 / 480)))
    if physical <= f32(.25):
        return 'smallFont'
    if physical >= f32(.55):
        return 'extraBigFont'
    if physical >= f32(.4):
        return 'bigFont'
    return 'normalFont'


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('workspace', type=Path)
    parser.add_argument('binary', type=Path)
    args = parser.parse_args()
    root = _PROJECT_ROOT
    candidate = root / 'engine/com/client/screen/scr_draw/rgpu/rgpu_menu/internal/rgpu_menu_text.ts'
    candidate_hash = hashlib.sha256(candidate.read_bytes()).hexdigest()
    raw = args.binary.read_bytes()
    pe = pefile.PE(data=raw)
    base = pe.OPTIONAL_HEADER.ImageBase
    asm_path = args.workspace / 'functions/sub_532380/asm.asm'
    asm = asm_path.read_text()
    for address, encoded in re.findall(r'^\s*(0x[0-9a-f]+)\s+((?:[0-9a-f]{2} )+)', asm, re.M):
        instruction = bytes.fromhex(encoded)
        assert pe.get_data(int(address, 16) - base, len(instruction)) == instruction, address
    code = pe.get_data(0x532380 - base, 169)
    assert pe.get_data(0x5c4014 - base, 4) == struct.pack('<f', 1 / 480)
    uc = Uc(UC_ARCH_X86, UC_MODE_32)
    uc.mem_map(base, (pe.OPTIONAL_HEADER.SizeOfImage + 4095) & ~4095)
    uc.mem_write(base, pe.get_memory_mapped_image())
    uc.mem_map(0x3000000, 0x10000)
    stack = 0x3008000
    font_slots = {0x18a5110: 'bigFont', 0x18a5114: 'smallFont',
                  0x18a5120: 'normalFont', 0x18a5124: 'extraBigFont'}
    for slot in font_slots:
        uc.mem_write(slot, struct.pack('<I', slot))
    for index, (slot, value) in enumerate([(0x18a50e0, .25), (0x189bff4, .4), (0x189bffc, .55)]):
        ptr = 0x3001000 + index * 16
        uc.mem_write(slot, struct.pack('<I', ptr))
        uc.mem_write(ptr + 8, struct.pack('<f', value))
    cases = []
    # Fixed policy, including both sides and exact values of each native threshold.
    for height in [240, 480, 600, 660, 720, 1080, 1440]:
        for scale in [.125, .2499, .25, .2501, .3, .3999, .4, .4001, .5, .5499, .55, .5501]:
            expected = expected_font(height, scale)
            uc.mem_write(0xbdcc0c, struct.pack('<f', f32(height * f32(1 / 480))))
            uc.mem_write(stack, struct.pack('<If', 0x3000000, scale))
            uc.reg_write(UC_X86_REG_ESP, stack)
            uc.reg_write(UC_X86_REG_EAX, 1)
            uc.reg_write(UC_X86_REG_FPCW, 0x37f)
            uc.emu_start(0x532380, 0x3000000, count=100)
            actual = font_slots[uc.reg_read(UC_X86_REG_EAX)]
            assert actual == expected, (height, scale, expected, actual)
            font = json.loads((root / f'assets/fonts/{actual}.json').read_text())
            cases.append(dict(height=height, textscale=scale, font=actual,
                              font_size=font['font_size'], glyph=font['glyphs']['A']))
    assert hashlib.sha256(candidate.read_bytes()).hexdigest() == candidate_hash
    result = dict(status='bounded-native-selector-validation',
                  binary_sha256=hashlib.sha256(raw).hexdigest(),
                  manifest_sha256=hashlib.sha256((args.workspace / 'manifest.json').read_bytes()).hexdigest(),
                  asm_sha256=hashlib.sha256(asm_path.read_bytes()).hexdigest(),
                  function_address='0x532380', function_size=len(code),
                  function_sha256=hashlib.sha256(code).hexdigest(),
                  candidate_sha256=candidate_hash, cases=cases)
    destination = root / 'tools/fixtures/retail_font_selection.json'
    destination.parent.mkdir(exist_ok=True)
    destination.write_text(json.dumps(result, indent=2) + '\n', encoding='utf-8')
    print(f'Original instruction bytes match; {len(cases)} frozen selector cases pass native emulation.')


if __name__ == '__main__':
    main()
