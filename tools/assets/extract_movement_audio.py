"""Retail surface alias families registered at 0x4bf9c2 and event dispatch 0x4e0910."""

# Locate shared tools from both the checkout and the browser's virtual filesystem.
import sys as _tool_sys
from pathlib import Path as _ToolPath
_tool_sys.path.insert(0, str(next(p for p in _ToolPath(__file__).resolve().parents
                                    if (p / 'lib/project.py').is_file())))
from lib.project import ROOT as _PROJECT_ROOT, tool_script as _tool_script

import runpy,json,struct,pefile
from pathlib import Path
g=runpy.run_path(str(_tool_script('assets/extract_retail_audio.py')));entries=g['entries'];read=g['read'];dest=g['dest'];csv=g['csv'];hashlib=g['hashlib'];aliases={}
for name in entries:
 if not name.startswith('soundaliases/') or not name.endswith('.csv'):continue
 lines=read(name).decode('cp1252').splitlines();start=next((i for i,l in enumerate(lines) if l.startswith('name,')),None)
 if start is None:continue
 for row in csv.DictReader(lines[start:]):
  alias=row.get('name','').strip().lower()
  if not alias.startswith(('step_run_plr_','step_walk_plr_','step_prone_plr_','land_plr_','gear_rattle_plr_')) or not row.get('file'):continue
  source='sound/'+row['file'].replace('\\','/');raw=read(source);target=dest/row['file'].replace('\\','/');target.parent.mkdir(parents=True,exist_ok=True);target.write_bytes(raw)
  aliases.setdefault(alias,[]).append(dict(url='/'+source,probability=float(row.get('probability') or 1),loadspec=row.get('loadspec'),volumeMin=float(row.get('vol_min') or 1),volumeMax=float(row.get('vol_max') or row.get('vol_min') or 1),pitchMin=float(row.get('pitch_min') or 1),pitchMax=float(row.get('pitch_max') or row.get('pitch_min') or 1),volumeGroup=row.get('vol_mod'),channel=row.get('channel'),table=name,sha256=hashlib.sha256(raw).hexdigest()))
from lib.retail_paths import EXE
DEFAULT_SURFACES = [
  "default", "bark", "brick", "carpet", "cloth", "concrete", "dirt", "flesh",
  "foliage", "glass", "grass", "gravel", "ice", "metal", "mud", "paper",
  "plaster", "rock", "sand", "snow", "water", "wood", "asphalt"
]
surfaces = list(DEFAULT_SURFACES)
if EXE.is_file():
    try:
        p = pefile.PE(data=EXE.read_bytes())
        extracted = ['default']
        for i in range(22):
            pointer = struct.unpack('<I', p.get_data(0x5d3f90-0x400000+i*20, 4))[0]
            extracted.append(p.get_string_at_rva(pointer-0x400000).decode())
        if len(extracted) == 23 and all(extracted):
            surfaces = extracted
    except Exception as e:
        print(f"Notice: using default surfaces: {e}")

dest.mkdir(parents=True, exist_ok=True)
(dest/'movement.json').write_text(json.dumps(dict(surfaces=surfaces,aliases=aliases),indent=2)+'\n')
surfaces_path = Path('assets/ui/surfaces.json')
surfaces_path.parent.mkdir(parents=True, exist_ok=True)
surfaces_path.write_text(json.dumps(surfaces,indent=2)+'\n')
print('Exported',len(aliases),'movement aliases,',sum(map(len,aliases.values())),'variants;',surfaces)
