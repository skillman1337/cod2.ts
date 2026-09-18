"""Execute frozen movement helper cases in the original PE. No engine calls replaced.

This validates ordinary movement helper branches, not whole Pmove/collision.
"""

# Locate shared tools from both the checkout and the browser's virtual filesystem.
import sys as _tool_sys
from pathlib import Path as _ToolPath
_tool_sys.path.insert(0, str(next(p for p in _ToolPath(__file__).resolve().parents
                                    if (p / 'lib/project.py').is_file())))
from lib.project import ROOT as _PROJECT_ROOT, tool_script as _tool_script
from lib.native_paths import NATIVE_EXE, RE_WORKSPACE

from pathlib import Path
import hashlib,json,struct,re
import pefile
from capstone import Cs,CS_ARCH_X86,CS_MODE_32
from unicorn import Uc,UC_ARCH_X86,UC_MODE_32
from unicorn.x86_const import *
root=_PROJECT_ROOT;dest=root/'artifacts/retail-menu-evidence/physics';dest.mkdir(exist_ok=True)
exe=NATIVE_EXE;raw=exe.read_bytes();pe=pefile.PE(data=raw);base=pe.OPTIONAL_HEADER.ImageBase
assert hashlib.sha256(raw).hexdigest()=='bc5a7d561cb993cf43d5d4159b71721b4c4dca239d04de83540977769fcb05b8'
functions=[0x5153a0,0x515400,0x515510,0x5155f0,0x515650,0x515850,0x515900,0x515f10,0x516050,0x516d10,0x516ff0,0x517360,0x518f00,0x51aee0,0x52fbd0,0x52fca0,0x52fd60,0x52fda0,0x52ff90,0x530210,0x530a30,0x467f40]
dossier=[];md=Cs(CS_ARCH_X86,CS_MODE_32)
for address in functions:
    saved=(RE_WORKSPACE / f'functions/sub_{address:x}/asm.asm').read_text()
    size=int(re.search(r'; size: (\d+)',saved)[1]);code=pe.get_data(address-base,size)
    for line in saved.splitlines():
        match=re.match(r'\s+0x([0-9a-f]+)  ((?:[0-9a-f]{2} )+)',line)
        if match:
            va=int(match[1],16);encoded=bytes.fromhex(match[2]);assert pe.get_data(va-base,len(encoded))==encoded,hex(va)
    (dest/f'{address:x}.asm').write_text('\n'.join(f'{i.address:08x} {i.bytes.hex():24} {i.mnemonic} {i.op_str}' for i in md.disasm(code,address)))
    dossier.append(dict(address=hex(address),size=size,sha256=hashlib.sha256(code).hexdigest()))
u=Uc(UC_ARCH_X86,UC_MODE_32);u.mem_map(base,(pe.OPTIONAL_HEADER.SizeOfImage+4095)&~4095);u.mem_write(base,pe.get_memory_mapped_image());u.mem_map(0x20000000,0x40000)
ps=0x20001000;pml=0x20003000;pm=0x20004000;cmd=0x20005000;vec=0x20006000;stack=0x20020000;ret=0x20030000;result=ret+0x100
def put(a,*v):u.mem_write(a,struct.pack('<'+'I'*len(v),*(x&0xffffffff for x in v)))
def floats(a,*v):u.mem_write(a,struct.pack('<'+'f'*len(v),*v))
def getvec(a):return list(struct.unpack('<3f',u.mem_read(a,12)))
def reset():
    u.mem_write(ps,bytes(0x7000));put(pm,ps);put(ps+0x48,800);put(ps+0x50,190);put(ps+0xf4,60)
    for index,(pointer,value) in enumerate([(0x189bf8c,1),(0x189bf88,64),(0x186f9e0,100),(0x186fa28,5.5),(0x186fa2c,50),(0x186fa54,0),(0x186fa14,0),(0x186fa3c,.7),(0x186fa74,.8)]):
        address=0x20009000+index*32;put(pointer,address)
        if pointer in (0x189bf8c,0x186fa14):put(address+8,int(value))
        else:floats(address+8,value)
    for reg in [UC_X86_REG_EAX,UC_X86_REG_EBX,UC_X86_REG_ECX,UC_X86_REG_EDX,UC_X86_REG_ESI,UC_X86_REG_EDI,UC_X86_REG_EBP]:u.reg_write(reg,0)
    # FNINIT then explicit native default nearest/even control word.
    u.mem_write(ret,b'\xdb\xe3');u.emu_start(ret,ret+2);u.reg_write(UC_X86_REG_FPCW,0x37f)
def run(address,args=(),registers=(),floating=False):
    put(stack,ret,*args);u.reg_write(UC_X86_REG_ESP,stack)
    for reg,value in registers:u.reg_write(reg,value)
    u.emu_start(address,ret,count=100000)
    if floating:
        u.mem_write(ret,b'\xd9\x1d'+struct.pack('<I',result));u.emu_start(ret,ret+6);return struct.unpack('<f',u.mem_read(result,4))[0]
cases=[]
candidate_hash=hashlib.sha256((root/'engine/common/pm.ts').read_bytes()).hexdigest()
for enabled in [False,True]:
    for time in [0,500,1699,1700,1800,1801]:
        reset();put(0x20009008,int(enabled));put(ps+0xc,0x80000);put(ps+0x10,time);put(pm+4,10000);floats(ps+0x1c,64)
        run(0x52fda0,[struct.unpack('<I',struct.pack('<f',39))[0]],[(UC_X86_REG_ESI,pml),(UC_X86_REG_EDI,pm)])
        cases.append(dict(kind='jump',args=[time,enabled],expected=getvec(ps+0x20)[2]))
for enabled in [False,True]:
    for time in [0,1,500,1200,1699,1700,1800,1801]:
        reset();put(0x20009008,int(enabled));put(ps+0x10,time)
        value=run(0x52fd60,[ps],floating=True);cases.append(dict(kind='factor',args=[time,enabled],expected=value))
    for height in [-10,0,17.99,18,25]:
        for time in [0,1200,1800,1801]:
            reset();put(0x20009008,int(enabled));put(ps+0xc,0x80000);put(ps+0x10,time);floats(ps+0x1c,height);floats(ps+0x74,0);floats(ps+0x20,190,45,-100)
            run(0x52fbd0,registers=[(UC_X86_REG_ECX,ps)])
            cases.append(dict(kind='landing',args=[height,time,enabled],expected=dict(velocity=getvec(ps+0x20),time=struct.unpack('<I',u.mem_read(ps+0x10,4))[0],jumping=bool(struct.unpack('<I',u.mem_read(ps+0xc,4))[0]&0x80000))))
for ground in [False,True]:
    for f,r in [(0,0),(127,0),(-127,0),(0,127),(127,127),(-127,127),(20,-90)]:
        reset();u.mem_write(cmd+24,struct.pack('<bb',f,r))
        registers=[(UC_X86_REG_EAX,pm),(UC_X86_REG_EBX,cmd)] if ground else [(UC_X86_REG_ESI,cmd),(UC_X86_REG_EDI,ps)]
        value=run(0x515900 if ground else 0x515850,registers=registers,floating=True)
        cases.append(dict(kind='scale',args=[f,r,190,ground,.7,.8],expected=value))
for v in [[0,0,0],[.3,.4,0],[190,0,0],[190,40,-25],[300,-100,200]]:
    for ground,slick,time in [(True,False,0),(True,False,1800),(True,True,0),(False,False,0)]:
        reset();floats(ps+0x20,*v);put(pml+0x2c,int(ground));put(pml+0x48,2 if slick else 0);floats(pml+0x24,.008);put(ps+0xc,0x80000 if time else 0);put(ps+0x10,time)
        run(0x515400,registers=[(UC_X86_REG_ESI,ps),(UC_X86_REG_EDI,pml)])
        cases.append(dict(kind='friction',args=[v,ground,slick,.008,5.5,100,time],expected=getvec(ps+0x20)))
for v in [[0,0,0],[190,0,0],[-100,20,0],[150,-90,0]]:
    for speed,accel in [(190,9),(190,1),(10,9),(0,1)]:
        reset();floats(ps+0x20,*v);floats(vec,1,0,0);floats(pml+0x24,.008)
        args=struct.unpack('<2I',struct.pack('<2f',speed,accel))
        run(0x515650,args,[(UC_X86_REG_EAX,vec),(UC_X86_REG_EDI,ps),(UC_X86_REG_EBX,pml)])
        cases.append(dict(kind='accelerate',args=[v,[1,0,0],speed,accel,.008,100],expected=getvec(ps+0x20)))
for old in [[100,0,0],[-100,0,0],[0,100,0]]:
    reset();floats(ps+0x20,-10,0,0);floats(ps+0x2c,*old[:2]);floats(vec,1,0,0);floats(pml+0x24,.066)
    run(0x515650,struct.unpack('<2I',struct.pack('<2f',190,9)),[(UC_X86_REG_EAX,vec),(UC_X86_REG_EDI,ps),(UC_X86_REG_EBX,pml)])
    cases.append(dict(kind='accelerate',args=[[-10,0,0],[1,0,0],190,9,.066,100,old],expected=getvec(ps+0x20)))
(dest/'native-cases.json').write_text(json.dumps(dict(executable_sha256=hashlib.sha256(raw).hexdigest(),candidate_sha256=candidate_hash,scope='Ordinary movement helpers; no whole-Pmove equivalence claim.',functions=dossier,cases=cases),indent=2))
print('Captured',len(cases),'original-machine physics cases')
