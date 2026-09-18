# Locate shared tools from both the checkout and the browser's virtual filesystem.
import sys as _tool_sys
from pathlib import Path as _ToolPath
_tool_sys.path.insert(0, str(next(p for p in _ToolPath(__file__).resolve().parents
                                    if (p / 'lib/project.py').is_file())))
from lib.project import ROOT as _PROJECT_ROOT, tool_script as _tool_script

from pathlib import Path
import struct,collections
b=Path('artifacts/retail-menu-evidence/mp_toujane.d3dbsp').read_bytes()
def lump(n):size,offset=struct.unpack_from('<II',b,8+8*n);return b[offset:offset+size]
rows=list(struct.iter_unpack('<IBBH',lump(2)));colors=lump(3)
print('rows',len(rows),'colors',len(colors)//24)
print('first',rows[:30]);print('last',rows[-12:])
for i in range(4):print('field',i,'range',min(r[i] for r in rows),max(r[i] for r in rows),'common',collections.Counter(r[i] for r in rows).most_common(8))
print('colors',list(colors[:96]))
