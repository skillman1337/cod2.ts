"""Compile retail HUD owner-draw definitions and weapon data providers."""

# Locate shared tools from both the checkout and the browser's virtual filesystem.
import sys as _tool_sys
from pathlib import Path as _ToolPath
_tool_sys.path.insert(0, str(next(p for p in _ToolPath(__file__).resolve().parents
                                    if (p / 'lib/project.py').is_file())))
from lib.project import ROOT as _PROJECT_ROOT, tool_script as _tool_script

from pathlib import Path
import json,zipfile,subprocess,re
from extract_retail_menus import Parser,menu
from lib.retail_paths import MAIN,CPP
root=_PROJECT_ROOT;evidence=root/'artifacts/retail-menu-evidence';weapons={}
for archive in sorted(MAIN.glob('*.iwd')):
    with zipfile.ZipFile(archive) as z:
        for name in z.namelist():
            if name.startswith('weapons/mp/') and not name.endswith('/'):
                tokens=z.read(name).decode('ascii').split('\\');assert tokens[0]=='WEAPONFILE'
                assert len(tokens)%2==1
                weapons[Path(name).name]=dict(zip(tokens[1::2],tokens[2::2]))
text=subprocess.run([CPP,'-E','-P','-x','c','-I',str(evidence),str(evidence/'ui_mp/hud.menu')],capture_output=True,text=True,check=True).stdout
parser=Parser(text);hud=[]
while parser.i<len(parser.t):
    token=parser.take().lower()
    if token=='menudef':hud.append(menu(parser.props()))
    elif token=='assetglobaldef':parser.block_tokens()
(root/'assets/ui/hud.json').write_text(json.dumps(hud,indent=2)+'\n')
(root/'assets/ui/weapons.json').write_text(json.dumps(weapons,indent=2)+'\n')
(evidence/'hud.expanded').write_text(text)
print('Compiled',len(hud),'HUD menus and',len(weapons),'weapon definitions')
