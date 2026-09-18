"""Capture original tail draw vertices, including atlas UVs and both renderer paths."""

# Locate shared tools from both the checkout and the browser's virtual filesystem.
import sys as _tool_sys
from pathlib import Path as _ToolPath
_tool_sys.path.insert(0, str(next(p for p in _ToolPath(__file__).resolve().parents
                                    if (p / 'lib/project.py').is_file())))
from lib.project import ROOT as _PROJECT_ROOT, tool_script as _tool_script
from lib.native_paths import NATIVE_DLL

from pathlib import Path
import pefile, struct, json, hashlib
from unicorn import Uc, UC_ARCH_X86, UC_MODE_32
from unicorn.x86_const import *
path=NATIVE_DLL
raw=path.read_bytes(); pe=pefile.PE(data=raw); base=0x10000000
assert hashlib.sha256(raw).hexdigest()=='aed5b8de2459304f43e199621ffcc51409d090d63a73c4bb7bb23d9ccaa6561d'
u=Uc(UC_ARCH_X86,UC_MODE_32); u.mem_map(base,(pe.OPTIONAL_HEADER.SizeOfImage+4095)&~4095); u.mem_write(base,pe.get_memory_mapped_image()); u.mem_map(0x20000000,0x10000)
def word(a,v):u.mem_write(a,struct.pack('<I',v))
def floats(a,v):u.mem_write(a,struct.pack('<'+'f'*len(v),*v))
entity=0x20000100; material=0x20000200; camera=0x20000300; config=0x20000400; stack=0x20008000; stop=0x20009000
word(0x10981bc8,camera); word(0x101ce710,config); word(0x109817b0,0x20001000); word(entity+0x54,material); word(entity+0x58,0xffffffff)
cases=[]
for renderer in [0,2]:
 for start,end,eye,width,atlas,frame in [([10,2,3],[9,-8,4],[0,0,0],2,[1,1],0),([50,20,30],[48,22,39],[4,8,7],3,[4,4],6),([8,4,2],[2,1,0],[0,0,0],.5,[2,2],3)]:
  word(config+8,renderer); floats(entity+0x3c,start); floats(entity+0x48,end); floats(entity+0x64,[width]); floats(camera,eye)
  u.mem_write(material+0xe,bytes(atlas)); word(entity+0x60,frame); word(0x109817d0,0); word(0x109817d4,0); word(stack,stop)
  u.reg_write(UC_X86_REG_ESP,stack);u.reg_write(UC_X86_REG_EAX,entity);u.emu_start(0x10041490,stop,count=10000)
  stride=36 if renderer==2 else 64; offset=28 if renderer==2 else 32
  vertices=[dict(position=list(struct.unpack('<3f',u.mem_read(0x10927000+i*stride,12))),uv=list(struct.unpack('<2f',u.mem_read(0x10927000+i*stride+offset,8)))) for i in range(4)]
  cases.append(dict(renderer=renderer,start=start,end=end,eye=eye,width=width,atlas=atlas,frame=frame,vertices=vertices))
out=Path('artifacts/retail-menu-evidence/weapons/native-tail-vertices.json');out.write_text(json.dumps(dict(binary_sha256=hashlib.sha256(raw).hexdigest(),cases=cases),indent=2));print('Captured',len(cases),'native tail meshes across both renderer paths')
