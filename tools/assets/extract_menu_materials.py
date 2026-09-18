"""Decode menu material color maps from the installed archives, preserving alpha."""

# Locate shared tools from both the checkout and the browser's virtual filesystem.
import sys as _tool_sys
from pathlib import Path as _ToolPath
_tool_sys.path.insert(0, str(next(p for p in _ToolPath(__file__).resolve().parents
                                    if (p / 'lib/project.py').is_file())))
from lib.project import ROOT as _PROJECT_ROOT, tool_script as _tool_script

import argparse, hashlib, json, re, zipfile, subprocess, struct
from pathlib import Path
from lib.iwi import read_iwi
from PIL import Image

root=_PROJECT_ROOT
ap=argparse.ArgumentParser(description=__doc__);ap.add_argument('main',type=Path);args=ap.parse_args()
menus=json.loads((root/'assets/ui/menus.json').read_text())
names={i['background'] for m in menus for i in m['items'] if i.get('background')}
names.update(i['background'] for m in json.loads((root/'assets/ui/hud.json').read_text()) for i in m['items'] if i.get('background'))
names.update(['stance_stand','stance_crouch','stance_prone','stance_flash'])
names.update(w['modeIcon'] for w in json.loads((root/'assets/ui/weapons.json').read_text()).values() if w.get('modeIcon'))
names.update(['background_american_w','ui/assets/slider2.tga','ui/assets/sliderbutt_1','hint_mantle'])
names.update('ui/assets/'+name+'.tga' for name in ['scrollbar','scrollbar_arrow_dwn_a','scrollbar_arrow_up_a','scrollbar_thumb'])
names.update('loadscreen_'+m['map'] for m in json.loads((root/'assets/ui/providers.json').read_text())['maps'])
entries={}
lower_entries={}
for p in sorted(args.main.glob('*.iwd')):
    with zipfile.ZipFile(p) as z:
        for n in z.namelist():
            if n.startswith(('materials/','images/')):
                entries[n]=(p,n)
                lower_entries[n.lower()]=(p,n)
def read(n):
    p,entry=entries.get(n) or lower_entries[n.lower()]
    with zipfile.ZipFile(p) as z:return z.read(entry)
records={}
for name in sorted(names):
    if name=='ui/assets/fadebox.tga':
        out=root/'assets/images/menu_fadebox.png'
        out.parent.mkdir(parents=True,exist_ok=True)
        img=Image.new('RGBA',(16,16),(255,255,255,255))
        img.save(out)
        b=out.read_bytes()
        h=hashlib.sha256(b).hexdigest()
        records[name]=dict(image=out.name,width=16,height=16,material_sha256=h,image_sha256=h)
        continue
    mat_key='materials/'+name
    if mat_key not in entries and mat_key.lower() not in lower_entries:
        print('No archived material:',name);continue
    material=read(mat_key)
    strings=[s.decode('ascii') for s in re.findall(rb'[ -~]{4,}',material)]
    candidates=[s for s in strings[1:] if ('images/'+s+'.iwi') in entries or ('images/'+s+'.iwi').lower() in lower_entries]
    if not candidates:
        print('No archived image (procedural material):',name);continue
    assert len(candidates)==1,(name,candidates)
    image_name=candidates[0];raw=read('images/'+image_name+'.iwi')
    w,h,image=read_iwi(raw)
    out=root/'assets/images'/('menu_'+Path(image_name).name.replace('#','_')+'.png');image.save(out)
    records[name]=dict(image=out.name,width=w,height=h,material_sha256=hashlib.sha256(material).hexdigest(),image_sha256=hashlib.sha256(raw).hexdigest())
(root/'assets/ui/materials.json').write_text(json.dumps(records,indent=2)+'\n')
print('Extracted',len(records),'menu material images.')
