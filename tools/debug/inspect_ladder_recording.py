# Locate shared tools from both the checkout and the browser's virtual filesystem.
import sys as _tool_sys
from pathlib import Path as _ToolPath
_tool_sys.path.insert(0, str(next(p for p in _ToolPath(__file__).resolve().parents
                                    if (p / 'lib/project.py').is_file())))
from lib.project import ROOT as _PROJECT_ROOT, tool_script as _tool_script
from lib.native_paths import NATIVE_EXE

from pathlib import Path
import json,struct,pefile,collections
root=_PROJECT_ROOT
p=pefile.PE(str(NATIVE_EXE))
print('Constants', {hex(a):struct.unpack('<f',p.get_data(a-0x400000,4))[0] for a in [0x5c4050,0x5c4048,0x5c3e24,*range(0x5c419c,0x5c41cc,4)]})
path=max((root/'logs/trace/movement').glob('*.json'),key=lambda p:p.stat().st_mtime)
d=json.loads(path.read_text());frames=d['frames'];print(path.name,len(frames))
print('dt',collections.Counter(round(f['dt']*1000,2) for f in frames).most_common(8))
print('settings',d['contexts'][0]['settings'])
for f in frames[::max(1,len(frames)//12)]:
 print(f['sequence'],f['before']['origin'],f['command'],f['after']['velocity'])
hits=collections.Counter(t['result'].get('hitBrush') for f in frames for t in f['traces'] if t['result']['surfaceFlags']&8)
print('ladder trace hits',hits)
for c in d['contexts']:
 ladders=[(i,b) for i,b in enumerate(c.get('collision',[])) if any(x&8 for x in b.get('surfaceFlags',[]))]
 print('ladder brushes',len(ladders));print([(i,b['bounds'],b['contents']) for i,b in ladders][:20])
