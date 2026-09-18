# Locate shared tools from both the checkout and the browser's virtual filesystem.
import sys as _tool_sys
from pathlib import Path as _ToolPath
_tool_sys.path.insert(0, str(next(p for p in _ToolPath(__file__).resolve().parents
                                    if (p / 'lib/project.py').is_file())))
from lib.project import ROOT as _PROJECT_ROOT, tool_script as _tool_script

from pathlib import Path
import struct,re,collections
b=Path('artifacts/retail-menu-evidence/mp_toujane.d3dbsp').read_bytes()
lumps=[struct.unpack_from('<II',b,8+i*8) for i in range(39)]
for i,(size,offset) in enumerate(lumps):print(i,size,offset)
def lump(i):n,o=lumps[i];return b[o:o+n]
print('soups',list(struct.iter_unpack('<HHIHHI',lump(7)))[:6])
print('vertices',list(struct.iter_unpack('<6f4B10f',lump(8)))[:1])
print('materials',[lump(0)[i:i+64].split(b'\0')[0] for i in range(0,min(len(lump(0)),720),72)])
text=lump(37).decode('ascii','replace');Path('artifacts/retail-menu-evidence/toujane.entities').write_text(text)
print('entity classes',collections.Counter(re.findall(r'"classname"\s+"([^"]+)"',text)))
