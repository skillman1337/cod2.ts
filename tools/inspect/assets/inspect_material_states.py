"""Capture original renderer state lowering; substitute only D3D SetRenderState."""

# Locate shared tools from both the checkout and the browser's virtual filesystem.
import sys as _tool_sys
from pathlib import Path as _ToolPath
_tool_sys.path.insert(0, str(next(p for p in _ToolPath(__file__).resolve().parents
                                    if (p / 'lib/project.py').is_file())))
from lib.project import ROOT as _PROJECT_ROOT, tool_script as _tool_script
from lib.native_paths import NATIVE_DLL
from lib.retail_paths import GAME

from pathlib import Path
import struct,json,zipfile,hashlib
import pefile
from unicorn import Uc,UC_ARCH_X86,UC_MODE_32,UC_HOOK_CODE
from unicorn.x86_const import UC_X86_REG_ESP,UC_X86_REG_EAX,UC_X86_REG_EIP
from lib.retail_material import material_definition
root=GAME
dll=NATIVE_DLL;raw=dll.read_bytes();pe=pefile.PE(data=raw)
u=Uc(UC_ARCH_X86,UC_MODE_32);base=pe.OPTIONAL_HEADER.ImageBase
u.mem_map(base,(pe.OPTIONAL_HEADER.SizeOfImage+4095)&~4095);u.mem_write(base,pe.get_memory_mapped_image());u.mem_map(0x20000000,0x20000)
def word(address,value):u.mem_write(address,struct.pack('<I',value))
word(0x101ce7f4,0x20000100);word(0x101ce67c,0x20000100)
word(0x101ce674,0x20000200);word(0x101ce69c,0x20000200);word(0x20000208,0xbf800000)
u.mem_write(0x101d4976,b'\1')
word(0x101d1bf8,0x20000300);word(0x20000300,0x20000400);word(0x200004e4,0x20001000)
calls={}
def hook(u,address,size,data):
    if address==0x20002000:u.emu_stop()
    if address==0x20001000:
        sp=u.reg_read(UC_X86_REG_ESP);ret,device,state,value=struct.unpack('<4I',u.mem_read(sp,16));calls[state]=value
        u.reg_write(UC_X86_REG_ESP,sp+16);u.reg_write(UC_X86_REG_EAX,0);u.reg_write(UC_X86_REG_EIP,ret)
u.hook_add(UC_HOOK_CODE,hook)
manifest=json.loads(Path('public/maps/mp_toujane/manifest.json').read_text());names={x['material'] for x in manifest['textures'] if x};entries={}
for archive in sorted((root/'main').glob('*.iwd')):
    with zipfile.ZipFile(archive) as z:
        for name in names:
            if 'materials/'+name in z.namelist():entries[name]=z.read('materials/'+name)
records={}
for name,data in entries.items():
    color,depth=struct.unpack_from('<II',data,44);calls={}
    for address,cache,bits in [(0x1003c880,0x109ba488,color),(0x1003d0b0,0x109ba48c,depth)]:
        word(cache,(~bits)&0xffffffff);word(0x109ba480,(~color)&0xffffffff)
        u.mem_write(0x20010000,struct.pack('<II',0x20002000,bits));u.reg_write(UC_X86_REG_ESP,0x20010000)
        u.emu_start(address,0x20002000,count=1000000)
    records[name]=dict(words=[color,depth],candidate=material_definition(data)['state'],d3d=calls)
    assert records[name]['candidate']['cull']=={0:'none',1:'none',2:'front',3:'back'}[calls[22]],name
dest=Path('artifacts/retail-menu-evidence/renderer/material-states.json')
dest.write_text(json.dumps(dict(dll_sha256=hashlib.sha256(raw).hexdigest(),records=records),indent=2))
print('Captured',len(records),'materials; offset unit:',struct.unpack('<f',u.mem_read(0x1019be38,4))[0])
for name,record in records.items():
    s=record['candidate'];d=record['d3d']
    if s['offset'] or s['alpha']>=0:print(name,s,d)
