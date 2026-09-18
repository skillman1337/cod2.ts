# Locate shared tools from both the checkout and the browser's virtual filesystem.
import sys as _tool_sys
from pathlib import Path as _ToolPath
_tool_sys.path.insert(0, str(next(p for p in _ToolPath(__file__).resolve().parents
                                    if (p / 'lib/project.py').is_file())))
from lib.project import ROOT as _PROJECT_ROOT, tool_script as _tool_script
from lib.retail_paths import MAIN

from pathlib import Path
import zipfile,struct
main=MAIN
for path in sorted(main.glob('*.iwd')):
    with zipfile.ZipFile(path) as z:
        for name in z.namelist():
            if name.endswith('.d3dbsp') and 'toujane' in name:
                data=z.read(name);out=Path('artifacts/retail-menu-evidence/mp_toujane.d3dbsp');out.write_bytes(data)
                print(path.name,name,len(data),data[:16].hex())
            if name.startswith('ui_mp/') and any(s in name for s in ['team','weapon','ingame','briefing','connect']):print(path.name,name)
