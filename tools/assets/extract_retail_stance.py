"""View-height/forward-shift tables selected by 0x517440 and sampled by 0x5172d0."""

# Locate shared tools from both the checkout and the browser's virtual filesystem.
import sys as _tool_sys
from pathlib import Path as _ToolPath
_tool_sys.path.insert(0, str(next(p for p in _ToolPath(__file__).resolve().parents
                                    if (p / 'lib/project.py').is_file())))
from lib.project import ROOT as _PROJECT_ROOT, tool_script as _tool_script

import pefile,struct,json,hashlib
from pathlib import Path
from lib.retail_paths import EXE

DEFAULT_STANCE = {
  "60_40": [[0, 60.0, 0], [1, 59.5, 0], [4, 58.5, 0], [30, 56.0, 0], [80, 44.0, 0], [90, 41.5, 0], [95, 40.5, 0], [100, 40.0, 0]],
  "40_60": [[0, 40.0, 0], [5, 40.5, 0], [10, 41.5, 0], [20, 44.0, 0], [70, 56.0, 0], [96, 58.5, 0], [99, 59.5, 0], [100, 60.0, 0]],
  "40_11": [[0, 40.0, 0], [11, 38.0, 0], [22, 33.0, 0], [34, 25.0, 0], [45, 16.0, 0], [50, 15.0, 0], [55, 16.0, 0], [66, 21.0, 0], [78, 25.0, 0], [89, 23.0, 0], [100, 11.0, 0]],
  "11_40": [[0, 11.0, 0], [11, 23.0, 0], [22, 25.0, 0], [34, 21.0, 0], [45, 16.0, 0], [50, 15.0, 0], [55, 16.0, 0], [66, 25.0, 0], [78, 33.0, 0], [89, 38.0, 0], [100, 40.0, 0]]
}

tables = dict(DEFAULT_STANCE)
if EXE.is_file():
    try:
        raw = EXE.read_bytes()
        p = pefile.PE(data=raw)
        extracted = {}
        for name, address in [('60_40', 0x5db630), ('40_60', 0x5db6a0), ('40_11', 0x5db710), ('11_40', 0x5db7b8)]:
            points = []
            for i in range(32):
                row = struct.unpack('<ifi', p.get_data(address-0x400000+i*12, 12))
                if row[0] == -1: break
                points.append(row)
            if points:
                extracted[name] = points
        if len(extracted) == 4:
            tables = extracted
    except Exception as e:
        print(f"Notice: using default stance tables: {e}")

dest = Path('assets/ui/stance.json')
dest.parent.mkdir(parents=True, exist_ok=True)
dest.write_text(json.dumps(tables, indent=2) + '\n')
