"""Export authored retail EFX graphs, impact dispatch table and material bindings."""

# Locate shared tools from both the checkout and the browser's virtual filesystem.
import sys as _tool_sys
from pathlib import Path as _ToolPath
_tool_sys.path.insert(0, str(next(p for p in _ToolPath(__file__).resolve().parents
                                    if (p / 'lib/project.py').is_file())))
from lib.project import ROOT as _PROJECT_ROOT, tool_script as _tool_script

from pathlib import Path
import zipfile,json,csv,re,hashlib
from lib.retail_material import material_definition
from lib.retail_paths import MAIN
root=_PROJECT_ROOT;base=MAIN;out=root/'public/weaponfx';out.mkdir(parents=True,exist_ok=True)
from lib.asset_io import index_iwds, read_iwd, save_json
from lib.retail_texture import decode_rgba_image

entries = index_iwds(MAIN)

def read(name):
    return read_iwd(entries, name)

def parse(raw):
 lines=[s.split('//')[0].strip() for s in raw.decode('cp1252').splitlines()];lines=[s for s in lines if s];i=0
 def block(end):
  nonlocal i
  result={}
  while i<len(lines) and lines[i]!=end:
   s=lines[i];i+=1;parts=s.split();key=parts[0]
   if i<len(lines) and lines[i]=='{':i+=1;value=block('}')
   elif i<len(lines) and lines[i]=='[':
    i+=1;value=[]
    while lines[i]!=']':value.append(lines[i].split());i+=1
    i+=1
   else:value=parts[1:]
   if key in ['Particle','OrientedParticle','Tail','Decal','Light','Emitter','Runner','Sound','Cylinder','Line','Cloud']:
    result.setdefault('children',[]).append(dict(kind=key,**value));continue
   result[key]=value
  i+=1;return result
 result=[]
 while i<len(lines):
  kind=lines[i];i+=1;assert lines[i]=='{';i+=1;result.append(dict(kind=kind,**block('}')))
 return result
weapons=json.loads((root/'assets/ui/weapons.json').read_text());names={w['viewFlashEffect'] for w in weapons.values() if w.get('viewFlashEffect')};impacts={}
for row in csv.reader(read('fx/iw_impacts.csv').decode().splitlines()):
 if len(row)>=3 and row[0].startswith('bullet_'):
  impacts.setdefault(row[0],{})[row[1]]=row[2]
  if row[2]:names.add(row[2])
effects={};materials={}
pending=list(names)
while pending:
 name=pending.pop()
 if name in effects:continue
 raw=read(name);parts=parse(raw);effects[name]=parts
 def walk(parts):
  for part in parts:
   for shader in part.get('shaders',[]):materials[shader[0]]=None
   for field in ['emitfx','fx','playfx','impactfx','deathfx']:
    for ref in part.get(field,[]):
     value=ref[0].lstrip('/');value=value if value.endswith('.efx') else value+'.efx'
     if value.lower() in entries:pending.append(value)
   walk(part.get('children',[]))
 walk(parts)
for w in weapons.values():
 for field in ['reticleSide','reticleCenter']:
  if w.get(field):materials[w[field]]=None
for name in list(materials):
 key=name if ('materials/'+name).lower() in entries else name.removesuffix('.tga');raw=read('materials/'+key);definition=material_definition(raw);definition['atlas']=[raw[14],raw[15]];color=definition['bindings'].get('colorMap',{}).get('image')
 if not color:materials[name]=dict(definition=definition);continue
 image=decode_rgba_image(read('images/'+color+'.iwi'))
 file='textures/'+key.replace('/','_')+'.png';(out/'textures').mkdir(exist_ok=True);image.save(out/file);materials[name]=dict(file=file,definition=definition)
(out/'catalog.json').write_text(json.dumps(dict(effects=effects,impacts=impacts,materials=materials),separators=(',',':')))
print('Exported',len(effects),'retail effects and',len(materials),'materials')


