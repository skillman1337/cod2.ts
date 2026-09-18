"""Freeze the tail candidate and capture the original endpoint routine, including zero motion."""

# Locate shared tools from both the checkout and the browser's virtual filesystem.
import sys as _tool_sys
from pathlib import Path as _ToolPath
_tool_sys.path.insert(0, str(next(p for p in _ToolPath(__file__).resolve().parents
                                    if (p / 'lib/project.py').is_file())))
from lib.project import ROOT as _PROJECT_ROOT, tool_script as _tool_script
from lib.native_paths import NATIVE_EXE

from pathlib import Path
import hashlib,json,struct,random,pefile
from unicorn import Uc,UC_ARCH_X86,UC_MODE_32
from unicorn.x86_const import *
binary=NATIVE_EXE;pe=pefile.PE(str(binary))
u=Uc(UC_ARCH_X86,UC_MODE_32);u.mem_map(0x400000,(pe.OPTIONAL_HEADER.SizeOfImage+4095)&~4095);u.mem_write(0x400000,pe.get_memory_mapped_image());u.mem_map(0x20000000,0x10000)
rng=random.Random(497460);cases=[]
for i in range(120):
 point=[rng.uniform(-5000,5000) for _ in range(3)];previous=point if i%10==0 else [v+rng.uniform(-100,100) for v in point];length=rng.choice([0,1,8,80])
 point=list(struct.unpack('<3f',struct.pack('<3f',*point)));previous=list(struct.unpack('<3f',struct.pack('<3f',*previous)))
 obj=0x20001000;u.mem_write(obj+4,struct.pack('<3f',*point));u.mem_write(obj+0x24c,struct.pack('<3f',*previous));u.mem_write(obj+0x258,struct.pack('<f',length));u.mem_write(obj+0x9c,struct.pack('<3f',11,22,33))
 u.mem_write(0x20002000,struct.pack('<I',0x20003000));u.reg_write(UC_X86_REG_ESP,0x20002000);u.reg_write(UC_X86_REG_ECX,obj);u.reg_write(UC_X86_REG_ESI,0);u.emu_start(0x497460,0x20003000,count=10000)
 cases.append(dict(point=point,previous=previous,length=length,output=list(struct.unpack('<3f',u.mem_read(obj+0x9c,12)))))
candidate=Path('engine/common/weapon_fx.ts')
Path('artifacts/retail-menu-evidence/weapons/native-tail.json').write_text(json.dumps(dict(binary_sha256=hashlib.sha256(binary.read_bytes()).hexdigest(),candidate_sha256=hashlib.sha256(candidate.read_bytes()).hexdigest(),cases=cases),indent=2))
print('Captured',len(cases),'original tail endpoint cases')
