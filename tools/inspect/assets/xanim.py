"""Inspect v14 animations with the same channel decoder as both asset exporters."""
# Locate shared tools from both the checkout and the browser's virtual filesystem.
import sys as _tool_sys
from pathlib import Path as _ToolPath
_tool_sys.path.insert(0, str(next(p for p in _ToolPath(__file__).resolve().parents
                                    if (p / 'lib/project.py').is_file())))
from lib.project import ROOT as _PROJECT_ROOT, tool_script as _tool_script

import argparse
import json
from pathlib import Path, PurePosixPath
import struct
from lib.asset_io import index_iwds, read_iwd
from lib.retail_paths import MAIN
from lib.retail_xanim import decode_xanim


def inspect_animation(data):
    result = decode_xanim(data)
    result['flags'] = struct.unpack_from('<HHHBH', data)[3]
    return result


def main(argv=None):
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('animation', help='Archive-relative animation name, without xanim/')
    parser.add_argument('--main', type=Path, default=MAIN)
    parser.add_argument('--output', type=Path, default=_PROJECT_ROOT / 'artifacts/retail-menu-evidence/models')
    args = parser.parse_args(argv)
    name = PurePosixPath(args.animation)
    if not name.parts or name.is_absolute() or '..' in name.parts or '\\' in args.animation or ':' in args.animation:
        parser.error('Animation must be a safe relative asset name')
    entries = index_iwds(args.main)
    try:
        result = inspect_animation(read_iwd(entries, 'xanim/' + args.animation))
    except KeyError:
        parser.error(f'Animation not found in {args.main}: {args.animation}')
    target = args.output / (args.animation + '.json')
    target.parent.mkdir(parents=True, exist_ok=True)
    target.write_text(json.dumps(result, indent=2), encoding='utf-8')
    print('frames', result['frames'], 'rate', result['rate'], 'bones', len(result['channels']),
          'delta', result['delta'] is not None)
    print({n: v for n, v in result['channels'].items() if n in ('j_gun', 'tag_weapon', 'tag_camera', 'j_mainroot')})
    print('Saved', target)


if __name__ == '__main__':
    main()
