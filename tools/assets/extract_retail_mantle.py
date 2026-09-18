"""Export authored mantle volumes and v14 root-motion translation channels."""

# Locate shared tools from both the checkout and the browser's virtual filesystem.
import sys as _tool_sys
from pathlib import Path as _ToolPath
_tool_sys.path.insert(0, str(next(p for p in _ToolPath(__file__).resolve().parents
                                    if (p / 'lib/project.py').is_file())))
from lib.project import ROOT as _PROJECT_ROOT, tool_script as _tool_script

from pathlib import Path
import json,struct,zipfile,hashlib,sys
from lib.retail_paths import MAIN
root=_PROJECT_ROOT;entries={}
for archive in sorted(MAIN.glob('*.iwd')):
 with zipfile.ZipFile(archive) as z:
  for name in z.namelist():
   if name.startswith(('xanim/','animtrees/','maps/mp/','materials/hint_mantle','images/hint_mantle')):entries[name]=archive
def read(name):
 with zipfile.ZipFile(entries[name]) as z:return z.read(name)
animations={}
for name in entries:
 if not (name.startswith('xanim/mp_mantle_') and not name.endswith('over_low') or name=='xanim/player_mantle_over_low'):continue
 data=read(name);version,frames,bones,flags,rate=struct.unpack_from('<HHHBH',data);assert version==14 and flags==2
 cursor=9
 def take(fmt):
  global cursor
  value=struct.unpack_from('<'+fmt,data,cursor);cursor+=struct.calcsize('<'+fmt);return value
 rotations=take('H')[0];assert rotations==0,'Expected no root yaw in mantle assets'
 count=take('H')[0];times=list(take(('B' if frames<=256 else 'H')*count)) if 1<count<frames else list(range(count))
 points=[list(take('3f')) for _ in range(count)]
 key=name.split('mantle_')[-1]
 animations[key]={'duration':int((frames-1)*1000/rate),'frames':frames,'times':times,'points':points,'sha256':hashlib.sha256(data).hexdigest()}
 print(name,animations[key]['duration'],points[-1])
(root/'assets/ui/mantle.json').write_text(json.dumps(animations,indent=2)+'\n')
if '--curves-only' in sys.argv:sys.exit(0)
target=root/'public/maps/mp_toujane/manifest.json';manifest=json.loads(target.read_text());raw=read('maps/mp/mp_toujane.d3dbsp')
def lump(n):size,offset=struct.unpack_from('<II',raw,8+n*8);return raw[offset:offset+size]
model=struct.unpack_from('<6f6I',lump(35));planes=list(struct.iter_unpack('<4f',lump(4)));sides=lump(5);materials=lump(0);cursor=0;volumes=[]
for index,(count,material) in enumerate(struct.iter_unpack('<HH',lump(6))):
 bounds=[struct.unpack_from('<f',sides,cursor+i*8)[0] for i in range(6)];contents=struct.unpack_from('<I',materials,material*72+68)[0]&0xdffffffb
 if model[10]<=index<model[10]+model[11] and contents&0x1000000:
  faces=[]
  for axis in range(3):
   n=[0,0,0];n[axis]=-1;faces.append(n+[-bounds[2*axis]]);n=[0,0,0];n[axis]=1;faces.append(n+[bounds[2*axis+1]])
  faces.extend(list(planes[struct.unpack_from('<I',sides,cursor+i*8)[0]]) for i in range(6,count))
  flags=[struct.unpack_from('<I',materials,struct.unpack_from('<I',sides,cursor+i*8+4)[0]*72+64)[0] for i in range(count)]
  volumes.append({'bounds':bounds,'planes':faces,'contents':contents,'surfaceFlags':flags})
 cursor+=count*8
manifest['mantle']=volumes;temp=target.with_suffix('.json.tmp');temp.write_text(json.dumps(manifest,separators=(',',':'))+'\n');temp.replace(target);print('Authored mantle volumes',len(volumes))
from lib.iwi import read_iwi
width,height,image=read_iwi(read('images/hint_mantle.iwi'));image.save(root/'assets/images/menu_hint_mantle.png')
