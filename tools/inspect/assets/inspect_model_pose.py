"""Decode model surfaces by executing the original renderer loader in isolation.

Allocation is the only substituted boundary. No target process is patched.
Captured runtime buffers are evidence, not an animated viewmodel implementation.
"""

# Locate shared tools from both the checkout and the browser's virtual filesystem.
import sys as _tool_sys
from pathlib import Path as _ToolPath
_tool_sys.path.insert(0, str(next(p for p in _ToolPath(__file__).resolve().parents
                                    if (p / 'lib/project.py').is_file())))
from lib.project import ROOT as _PROJECT_ROOT, tool_script as _tool_script
from lib.native_paths import NATIVE_DLL
from lib.retail_paths import GAME

from pathlib import Path
import argparse, hashlib, json, re, struct, zipfile
import pefile
from unicorn import Uc, UC_ARCH_X86, UC_MODE_32, UC_HOOK_CODE
from unicorn.x86_const import UC_X86_REG_ESP, UC_X86_REG_EIP, UC_X86_REG_EAX

ap=argparse.ArgumentParser();ap.add_argument('model');args=ap.parse_args()
root=GAME
entries={}
for archive in sorted((root/'main').glob('*.iwd')):
    with zipfile.ZipFile(archive) as z:
        for name in z.namelist():entries[name]=archive
def read(name):
    with zipfile.ZipFile(entries[name]) as z:return z.read(name)
model=read('xmodel/'+args.model)
assert struct.unpack_from('<H',model)[0]==20
cursor=27;lods=[]
for i in range(4):
    distance=struct.unpack_from('<f',model,cursor)[0];cursor+=4
    end=model.index(0,cursor);name=model[cursor:end].decode();cursor=end+1
    lods.append(dict(distance=distance,name=name))
name=lods[0]['name'];encoded=read('xmodelsurfs/'+name)
version,count=struct.unpack_from('<HH',encoded);assert version==20
dll=NATIVE_DLL;pe=pefile.PE(str(dll))
u=Uc(UC_ARCH_X86,UC_MODE_32);base=pe.OPTIONAL_HEADER.ImageBase
u.mem_map(base,(pe.OPTIONAL_HEADER.SizeOfImage+4095)&~4095);u.mem_write(base,pe.get_memory_mapped_image())
u.mem_map(0x20000000,0x2000000)
stack=0x20010000;sentinel=0x20001000;allocate=0x20002000;object=0x20003000;bits=0x20004000;pointer=0x20005000;file=0x20100000;heap=0x20500000
u.mem_write(file,encoded);u.mem_write(pointer,struct.pack('<I',file+4));sizes={}
def hook(u,address,size,data):
    global heap
    if address==sentinel:u.emu_stop()
    if address==allocate:
        sp=u.reg_read(UC_X86_REG_ESP);ret,size=struct.unpack('<II',u.mem_read(sp,8))
        sizes[heap]=size;u.reg_write(UC_X86_REG_EAX,heap);heap+=(size+15)&~15
        u.reg_write(UC_X86_REG_ESP,sp+4);u.reg_write(UC_X86_REG_EIP,ret)
u.hook_add(UC_HOOK_CODE,hook)
dest=Path('artifacts/retail-menu-evidence/models')/args.model;dest.mkdir(parents=True,exist_ok=True)
surfaces=[]
for i in range(count):
    u.mem_write(stack,struct.pack('<5I',sentinel,object,bits,pointer,allocate));u.reg_write(UC_X86_REG_ESP,stack)
    u.emu_start(0x1002d8e0,sentinel,count=10000000)
    p=u.reg_read(UC_X86_REG_EAX);header=bytes(u.mem_read(p,24));_,vertices,triangles,bone,indices,buffer=struct.unpack_from('<BxHHhII',header)
    vb=bytes(u.mem_read(buffer,sizes[buffer]));ib=bytes(u.mem_read(indices,triangles*6))
    (dest/f'{i}.vertices.bin').write_bytes(vb);(dest/f'{i}.indices.bin').write_bytes(ib)
    surfaces.append(dict(vertices=vertices,triangles=triangles,bone=bone//64 if bone>=0 else -1,bytes=len(vb),first_vertex=struct.unpack_from('<16f',vb)))
    print(surfaces[-1])
assert struct.unpack('<I',u.mem_read(pointer,4))[0]==file+len(encoded)
parts=read('xmodelparts/'+name);nonroots,roots=struct.unpack_from('<HH',parts,2);cursor=6;bones=[]
for i in range(roots):bones.append(dict(parent=-1,translation=[0,0,0],quaternion=[0,0,0,1]))
for i in range(roots,roots+nonroots):
    parent=parts[cursor];position=struct.unpack_from('<3f',parts,cursor+1);rotation=struct.unpack_from('<3h',parts,cursor+13);cursor+=19
    w=round(max(0,32767**2-sum(x*x for x in rotation))**.5)
    bones.append(dict(parent=parent,translation=position,quaternion=[x/32767 for x in (*rotation,w)]))
print('Bones',bones,'remaining',parts[cursor:])
materials=[s.decode() for s in re.findall(rb'mtl_[^\0]+',model)]
(dest/'capture.json').write_text(json.dumps(dict(model=args.model,lods=lods,materials=materials,bones=bones,surfaces=surfaces,
    renderer_sha256=hashlib.sha256(dll.read_bytes()).hexdigest(),surface_sha256=hashlib.sha256(encoded).hexdigest(),loader='0x1002d8e0',status='extracted'),indent=2))
(dest/'model.bin').write_bytes(model);(dest/'parts.bin').write_bytes(parts)
