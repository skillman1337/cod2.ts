"""Extract the retail menu glyph tables without altering the shared atlas."""

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
import struct
import zipfile


def parse_font(data):
    _, size, count, _ = struct.unpack_from('<4I', data)
    glyphs = {}
    for index in range(count):
        offset = 16 + index * 24
        code, left, top, advance, width, height = struct.unpack_from('<HbbBBB', data, offset)
        if not 0 < code <= 255:
            continue
        u0, t0, u1, t1 = struct.unpack_from('<4f', data, offset + 8)
        glyphs[chr(code)] = dict(ml=left, mt=top, mr=advance, pw=width, ph=height,
                                u0=u0, t0=t0, u1=u1, t1=t1)
    return dict(font_size=size, glyphs=glyphs)


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('main', type=Path, help='Retail CoD2 main directory')
    args = parser.parse_args()
    root = _PROJECT_ROOT
    records = {}
    with zipfile.ZipFile(args.main / 'iw_00.iwd') as archive:
        for name in ['smallFont', 'normalFont', 'bigFont', 'extraBigFont', 'consoleFont']:
            entry = 'fonts/' + name
            raw = archive.read(entry)
            output = root / 'assets' / (entry + '.json')
            output.write_text(json.dumps(parse_font(raw), indent=2) + '\n', encoding='utf-8')
            records[entry] = dict(source='iw_00.iwd/' + entry,
                                 source_sha256=hashlib.sha256(raw).hexdigest(),
                                 output_sha256=hashlib.sha256(output.read_bytes()).hexdigest())
    (root / 'assets/fonts/provenance.json').write_text(
        json.dumps(records, indent=2) + '\n', encoding='utf-8')
    print('Extracted five retail font tables; atlas unchanged.')


if __name__ == '__main__':
    main()
