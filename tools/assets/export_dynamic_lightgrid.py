# Locate shared tools from both the checkout and the browser's virtual filesystem.
import sys as _tool_sys
from pathlib import Path as _ToolPath
_tool_sys.path.insert(0, str(next(p for p in _ToolPath(__file__).resolve().parents
                                    if (p / 'lib/project.py').is_file())))
from lib.project import ROOT as _PROJECT_ROOT, tool_script as _tool_script

from pathlib import Path
import struct,json,zipfile
from lib.retail_paths import MAIN
root=_PROJECT_ROOT;main=MAIN
for folder in (root/'public/maps').iterdir():
 if not folder.is_dir():continue
 name='maps/mp/'+folder.name+'.d3dbsp';raw=None
 for archive in sorted(main.glob('*.iwd')):
  with zipfile.ZipFile(archive) as z:
   if name in z.namelist():raw=z.read(name)
 if raw is None:continue
 def lump(i):n,p=struct.unpack_from('<II',raw,8+8*i);return raw[p:p+n]
 rows=list(struct.iter_unpack('<IBBH',lump(2)));colors=[list(v) for v in struct.iter_unpack('<24B',lump(3))]
 (folder/'lightgrid.json').write_text(json.dumps(dict(rows=rows,colors=colors),separators=(',',':')))
 print(folder.name,len(rows),'lightgrid nodes')
