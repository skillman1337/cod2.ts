# Locate shared tools from both the checkout and the browser's virtual filesystem.
import sys as _tool_sys
from pathlib import Path as _ToolPath
_tool_sys.path.insert(0, str(next(p for p in _ToolPath(__file__).resolve().parents
                                    if (p / 'lib/project.py').is_file())))
from lib.project import ROOT as _PROJECT_ROOT, tool_script as _tool_script
from lib.native_paths import NATIVE_DLL
from lib.retail_paths import GAME

from pathlib import Path
import zipfile,struct,pefile
root=GAME
for archive in sorted((root/'main').glob('*.iwd')):
 with zipfile.ZipFile(archive) as z:
  if 'materials/sky_toujane' in z.namelist():print('SKY MATERIAL',z.read('materials/sky_toujane'))
  for n in z.namelist():
   if n.startswith(('materials/shaders/','materials/techniques/','materials/techniquesets/')) and not n.endswith('/'):
    target=Path('artifacts/retail-menu-evidence/renderer')/n;target.parent.mkdir(parents=True,exist_ok=True);target.write_bytes(z.read(n))
  names=[n for n in z.namelist() if ('shader' in n or 'technique' in n) and ('light' in n or 'sky' in n or 'blur' in n)]
  if names:print(archive.name, names[:60])
pe=pefile.PE(str(NATIVE_DLL))
for addr in [0x1019bd38,0x1019bd00]:print(hex(addr),struct.unpack('<f',pe.get_data(addr-0x10000000,4)))
