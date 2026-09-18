# Locate shared tools from both the checkout and the browser's virtual filesystem.
import sys as _tool_sys
from pathlib import Path as _ToolPath
_tool_sys.path.insert(0, str(next(p for p in _ToolPath(__file__).resolve().parents
                                    if (p / 'lib/project.py').is_file())))
from lib.project import ROOT as _PROJECT_ROOT, tool_script as _tool_script

from pathlib import Path
import sys,struct,collections
from PIL import Image
from lib.iwi import read_iwi_mip0,read_iwi
b=Path(sys.argv[1]).read_bytes();fmt,w,h,p=read_iwi_mip0(b)
print('header',b[:28].hex(),'format',fmt,'size',w,h,'data',len(p))
image=Image.frombytes('RGBA',(w,h),p,'bcn',({11:1,12:2,13:3}[fmt],{11:'DXT1',12:'DXT3',13:'DXT5'}[fmt])) if fmt in (11,12,13) else read_iwi(b)[2]
print('samples',image.getpixel((int(w*.084),int(h*.827))),image.getpixel((w//2,h-1)))
print('frequent',collections.Counter(image.getdata()).most_common(5))
image.convert('RGB').save('artifacts/retail-menu-evidence/decoded-rgb.png')
