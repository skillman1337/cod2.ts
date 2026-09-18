"""Restore native brush-side material flags to existing exports without rebuilding models."""

# Locate shared tools from both the checkout and the browser's virtual filesystem.
import sys as _tool_sys
from pathlib import Path as _ToolPath
_tool_sys.path.insert(0, str(next(p for p in _ToolPath(__file__).resolve().parents
                                    if (p / 'lib/project.py').is_file())))
from lib.project import ROOT as _PROJECT_ROOT, tool_script as _tool_script
from lib.retail_paths import MAIN

from pathlib import Path
import json,struct,zipfile,hashlib,sys
root=_PROJECT_ROOT;dest=root/'public/maps'/sys.argv[1];manifest=json.loads((dest/'manifest.json').read_text())
raw=None
for archive in sorted(MAIN.glob('*.iwd')):
    with zipfile.ZipFile(archive) as z:
        name='maps/mp/'+manifest['name']+'.d3dbsp'
        if name in z.namelist():raw=z.read(name)
assert raw and hashlib.sha256(raw).hexdigest()==manifest['source_sha256']
def lump(n):
    size,offset=struct.unpack_from('<II',raw,8+n*8);return raw[offset:offset+size]
materials=lump(0);sides=lump(5);model=struct.unpack_from('<6f6I',lump(35));cursor=0;count=0
for index,(sidecount,material) in enumerate(struct.iter_unpack('<HH',lump(6))):
    contents=struct.unpack_from('<I',materials,material*72+68)[0]&0xdffffffb
    if model[10]<=index<model[10]+model[11] and contents&0x10001:
        bounds=list(struct.unpack_from('<f',sides,cursor+i*8)[0] for i in range(6));brush=manifest['collision'][count]
        assert brush['bounds']==bounds and brush['contents']==contents
        brush['surfaceFlags']=[struct.unpack_from('<I',materials,struct.unpack_from('<I',sides,cursor+i*8+4)[0]*72+64)[0] for i in range(sidecount)];count+=1
    cursor+=sidecount*8
assert cursor==len(sides)
temporary=dest/'manifest.json.tmp';temporary.write_text(json.dumps(manifest,separators=(',',':'))+'\n');temporary.replace(dest/'manifest.json')
print('Restored surface flags on',count,'static world brushes; collision-triangle material mapping still separate')
