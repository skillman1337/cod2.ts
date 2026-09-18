"""Read the effective installed asset without changing retail archives."""

# Locate shared tools from both the checkout and the browser's virtual filesystem.
import sys as _tool_sys
from pathlib import Path as _ToolPath
_tool_sys.path.insert(0, str(next(p for p in _ToolPath(__file__).resolve().parents
                                    if (p / 'lib/project.py').is_file())))
from lib.project import ROOT as _PROJECT_ROOT, tool_script as _tool_script
from lib.retail_paths import MAIN

from pathlib import Path
import argparse,zipfile
ap=argparse.ArgumentParser();ap.add_argument('name');ap.add_argument('--output',type=Path);a=ap.parse_args()
data=None
for archive in sorted(MAIN.glob('*.iwd')):
    with zipfile.ZipFile(archive) as z:
        if a.name in z.namelist():data=z.read(a.name)
assert data is not None,a.name
if a.output:
    a.output.parent.mkdir(parents=True,exist_ok=True);a.output.write_bytes(data)
else:print(data.decode('ascii','replace'))
