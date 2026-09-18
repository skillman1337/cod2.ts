"""Refresh compiled render states without re-decoding unchanged model geometry."""

# Locate shared tools from both the checkout and the browser's virtual filesystem.
import sys as _tool_sys
from pathlib import Path as _ToolPath
_tool_sys.path.insert(0, str(next(p for p in _ToolPath(__file__).resolve().parents
                                    if (p / 'lib/project.py').is_file())))
from lib.project import ROOT as _PROJECT_ROOT, tool_script as _tool_script
from lib.retail_paths import MAIN

from pathlib import Path
import argparse,json,zipfile,struct
from lib.retail_material import material_definition
ap=argparse.ArgumentParser();ap.add_argument('map');a=ap.parse_args()
root=_PROJECT_ROOT;dest=root/'public/maps'/a.map
manifest=json.loads((dest/'manifest.json').read_text());geometry=(dest/manifest['world']).read_bytes()
names={t['material'] for t in manifest['textures'] if t};definitions={}
for archive in sorted(MAIN.glob('*.iwd')):
    with zipfile.ZipFile(archive) as z:
        for name in names:
            if 'materials/'+name in z.namelist():definitions[name]=material_definition(z.read('materials/'+name))
for draw in manifest['draws']:
    layer=struct.unpack_from('<I',geometry,draw['start']*72+68)[0]&0xffff
    draw['state']=definitions[manifest['textures'][layer]['material']]['state']
manifest['draws'].sort(key=lambda d:d['state']['sort'])
temporary=dest/'manifest.json.tmp';temporary.write_text(json.dumps(manifest,separators=(',',':'))+'\n');temporary.replace(dest/'manifest.json')
print('Updated',len(manifest['draws']),'draw states')
