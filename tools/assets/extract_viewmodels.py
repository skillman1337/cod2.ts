"""Extract all selected bullet weapon viewmodels and authored animation channels."""

# Locate shared tools from both the checkout and the browser's virtual filesystem.
import sys as _tool_sys
from pathlib import Path as _ToolPath
_tool_sys.path.insert(0, str(next(p for p in _ToolPath(__file__).resolve().parents
                                    if (p / 'lib/project.py').is_file())))
from lib.project import ROOT as _PROJECT_ROOT, tool_script as _tool_script

from pathlib import Path
import json,zipfile,hashlib,csv
from lib.retail_model import ModelDecoder
from lib.retail_xanim import decode_xanim
from lib.retail_material import material_definition
from lib.retail_paths import MAIN,DLL
root=_PROJECT_ROOT;main=MAIN;dest=root/'public/viewmodels';dest.mkdir(parents=True,exist_ok=True)
from lib.asset_io import index_iwds, read_iwd, save_json
from lib.retail_texture import decode_rgba_image

entries = index_iwds(MAIN)

def read(name):
    return read_iwd(entries, name)

save = save_json
image = decode_rgba_image

weapons=json.loads((root/'assets/ui/weapons.json').read_text());decoder=ModelDecoder(DLL,read);models=set();animations=set();aliases=set();materials={};catalog={}
for name,w in weapons.items():
 if w.get('weaponType')!='bullet' or not w.get('gunModel') or not w.get('handModel'):continue
 models.update([w['gunModel'],w['handModel']]);animations.update(value for key,value in w.items() if key.endswith('Anim') and value)
 aliases.update(value.lower() for key,value in w.items() if 'Sound' in key and value)
 catalog[name]=dict(gun=w['gunModel'],hands=w['handModel'])
for name in sorted(models):
 model=decoder.load(name)
 for surface in model['surfaces']:
  mat=surface['material']
  if mat not in materials:
   definition=material_definition(read('materials/'+mat));color=definition['bindings'].get('colorMap',{}).get('image')
   assert color,(name,mat,definition)
   target=dest/'textures'/f'{mat}.png';target.parent.mkdir(exist_ok=True);image(read('images/'+color+'.iwi')).save(target)
   materials[mat]=dict(file=f'textures/{mat}.png',definition=definition)
 save(dest/'models'/f'{name}.json',model)
for name in sorted(animations):
 save(dest/'animations'/f'{name}.json',decode_xanim(read('xanim/'+name)))
sound={}
for name in entries:
 if not name.startswith('soundaliases/') or not name.endswith('.csv'):continue
 lines=read(name).decode('cp1252').splitlines();start=next((i for i,l in enumerate(lines) if l.startswith('name,')),None)
 if start is None:continue
 for row in csv.DictReader(lines[start:]):
  alias=row.get('name','').strip().lower()
  if alias not in aliases or not row.get('file'):continue
  source='sound/'+row['file'].replace('\\','/');raw=read(source);target=root/'public'/source;target.parent.mkdir(parents=True,exist_ok=True);target.write_bytes(raw)
  sound.setdefault(alias,[]).append(dict(url='/'+source,probability=float(row.get('probability') or 1),loadspec=row.get('loadspec'),volumeMin=float(row.get('vol_min') or 1),volumeMax=float(row.get('vol_max') or row.get('vol_min') or 1),pitchMin=float(row.get('pitch_min') or 1),pitchMax=float(row.get('pitch_max') or row.get('pitch_min') or 1),sha256=hashlib.sha256(raw).hexdigest()))
save(dest/'catalog.json',dict(weapons=catalog,materials=materials));save(root/'public/sound/weapons.json',dict(aliases=sound))
print('Exported',len(catalog),'weapons,',len(models),'models,',len(animations),'animations,',len(sound),'sound aliases')
