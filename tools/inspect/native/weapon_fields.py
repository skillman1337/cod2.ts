"""Inspect the supported native weapon field table; presets replace three copies."""
# Locate shared tools from both the checkout and the browser's virtual filesystem.
import sys as _tool_sys
from pathlib import Path as _ToolPath
_tool_sys.path.insert(0, str(next(p for p in _ToolPath(__file__).resolve().parents
                                    if (p / 'lib/project.py').is_file())))
from lib.project import ROOT as _PROJECT_ROOT, tool_script as _tool_script

import argparse
from pathlib import Path
import struct
from lib.native_paths import NATIVE_EXE

GENERAL = ('fire', 'ads', 'reload', 'clip', 'ammo', 'semiauto', 'idle', 'kick', 'reticle')
PRESETS = {
    'general': GENERAL,
    'flash': GENERAL + ('flash',),
    'transition': GENERAL + ('drop', 'raise'),
    'all': GENERAL + ('flash', 'drop', 'raise'),
}


def scan_fields(pe, needles):
    """Yield the original (address, name, offset, kind) results in table order."""
    for address in range(0x5dbc00, 0x5dc800, 4):
        name, offset, kind = struct.unpack('<III', pe.get_data(address - 0x400000, 12))
        if 0x590000 < name < 0x600000:
            text = pe.get_string_at_rva(name - 0x400000).decode(errors='replace')
            if any(needle in text.lower() for needle in needles):
                yield address, text, offset, kind


def main(argv=None):
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--preset', choices=PRESETS, default='general')
    parser.add_argument('--contains', action='append', help='Replace preset with substring(s); repeatable')
    parser.add_argument('--exe', type=Path, default=NATIVE_EXE,
                        help='Supported Windows reference EXE; not an arbitrary version')
    args = parser.parse_args(argv)
    if not args.exe.is_file():
        parser.error(f'Native executable not found: {args.exe}. Set COD2_NATIVE_EXE or --exe.')
    import pefile
    with pefile.PE(data=args.exe.read_bytes()) as pe:
        needles = tuple(s.lower() for s in args.contains) if args.contains else PRESETS[args.preset]
        for address, name, offset, kind in scan_fields(pe, needles):
            print(hex(address), name, hex(offset), kind)


if __name__ == '__main__':
    main()
