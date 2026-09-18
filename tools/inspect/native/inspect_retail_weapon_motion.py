"""Post-freeze bounded validation against original weapon recoil and light-grid machine code."""

# Locate shared tools from both the checkout and the browser's virtual filesystem.
import sys as _tool_sys
from pathlib import Path as _ToolPath
_tool_sys.path.insert(0, str(next(p for p in _ToolPath(__file__).resolve().parents
                                    if (p / 'lib/project.py').is_file())))
from lib.project import ROOT as _PROJECT_ROOT, tool_script as _tool_script
from lib.native_paths import NATIVE_BACKUP, NATIVE_EXE, NATIVE_DLL

from pathlib import Path
import hashlib,json,struct,random,pefile
from unicorn import Uc,UC_ARCH_X86,UC_MODE_32
from unicorn.x86_const import *
from lib.retail_lightgrid import LightGridDecoder
root=_PROJECT_ROOT;backup=NATIVE_BACKUP
hashes={name:hashlib.sha256((root/name).read_bytes()).hexdigest() for name in ['engine/common/weapon_motion.ts','engine/common/lightgrid.ts']}
exe=NATIVE_EXE;pe=pefile.PE(str(exe));u=Uc(UC_ARCH_X86,UC_MODE_32);base=pe.OPTIONAL_HEADER.ImageBase
u.mem_map(base,(pe.OPTIONAL_HEADER.SizeOfImage+4095)&~4095);u.mem_write(base,pe.get_memory_mapped_image());u.mem_map(0x20000000,0x10000)
cases=[];rng=random.Random(427)
for _ in range(180):
 values=[rng.uniform(-12,12),rng.uniform(-180,180),rng.choice([.001,.005,.016]),rng.choice([5,10]),rng.uniform(20,250),rng.uniform(50,200),rng.uniform(0,20),rng.uniform(0,40)]
 values=list(struct.unpack('<8f',struct.pack('<8f',*values)))
 u.mem_write(0x20001000,struct.pack('<2f',*values[:2]));u.mem_write(0x20002000,struct.pack('<I6f',0x20003000,*values[2:]));u.reg_write(UC_X86_REG_ESP,0x20002000);u.reg_write(UC_X86_REG_EDX,0x20001000);u.reg_write(UC_X86_REG_ECX,0x20001004)
 u.emu_start(0x4f6380,0x20003000,count=10000);cases.append(dict(input=values,output=struct.unpack('<2f',u.mem_read(0x20001000,8))))
view=[]
for index in range(180):
 positions=[rng.choice([0,rng.uniform(-11,11)]) for _ in range(3)];speeds=[rng.uniform(-150,150) for _ in range(3)];ms=rng.choice([1,5,16,66]);center=rng.uniform(5,150);ads=rng.choice([0,.5,1])
 positions=list(struct.unpack('<3f',struct.pack('<3f',*positions)));speeds=list(struct.unpack('<3f',struct.pack('<3f',*speeds)));center=struct.unpack('<f',struct.pack('<f',center))[0]
 for address,value in [(0x143fc50,0),(0x143fd18,1),(0x1654204,0x20004000),(0x143fc2c,ms)]:u.mem_write(address,struct.pack('<I',value))
 for address,value in [(0x143fd20,ads),(0x200044b0,center),(0x200044f8,center)]:u.mem_write(address,struct.pack('<f',value))
 u.mem_write(0x14460b0,struct.pack('<6f',*speeds,*positions));u.mem_write(0x20002000,struct.pack('<I',0x20003000));u.reg_write(UC_X86_REG_ESP,0x20002000)
 u.emu_start(0x4cec10,0x20003000,count=100000)
 result=struct.unpack('<6f',u.mem_read(0x14460b0,24));view.append(dict(position=positions,speed=speeds,msec=ms,center=center,outputPosition=result[3:],outputSpeed=result[:3]))
definitions=json.loads((root/'assets/ui/weapons.json').read_text());bob=[];movement=[];positionMotion=[]
fields={}
for a in range(0x5dbb00,0x5dc800,4):
 try:
  name,offset,kind=struct.unpack('<III',pe.get_data(a-base,12))
  if not 0x12c<=offset<=0x1b0 or kind!=6:continue
  name=pe.get_string_at_rva(name-base).decode('ascii')
  if name in definitions['sten_mp']:fields[offset]=name
 except Exception:pass
for i in range(180):
 name=rng.choice([k for k,d in definitions.items() if d.get('clipSize') and d.get('weaponType')=='bullet']);d=definitions[name];stance=rng.choice([11,40,60]);ads=rng.choice([0,.25,.5,1]);speed=rng.choice([0,30,90,190]);cycle=rng.randrange(256);dt=rng.choice([.005,.016,.066]);reload=rng.choice([False,True]);previous=[rng.uniform(-10,10) for _ in range(3)]
 for a,v in [(0x2000500c,0),(0x200050d4,1),(0x200050a0,8 if stance==11 else 4 if stance==40 else 0),(0x20005050,190),(0x200050d8,5 if reload else 0),(0x200050f4,stance),(0x20005008,cycle),(0x20006000,0x20005000),(0x20004278,int(bool(d.get('adsOverlayReticle') and d['adsOverlayReticle']!='none')))]:u.mem_write(a,struct.pack('<I',v))
 for a,v in [(0x200050dc,ads),(0x200050f8,stance),(0x20006004,speed),(0x20006008,dt),(0x20004284,float(d.get('adsBobFactor',1)))]+[(0x20004000+a,float(d[n])) for a,n in fields.items()]:u.mem_write(a,struct.pack('<f',v))
 for a,pointer,value in [(0x186fa64,0x20008000,.03),(0x186fa70,0x20008100,.0075),(0x186fa80,0x20008200,.007)]:u.mem_write(a,struct.pack('<I',pointer));u.mem_write(pointer+8,struct.pack('<f',value))
 u.mem_write(0x20007000,b'\0'*12);u.mem_write(0x20002000,struct.pack('<II',0x20003000,0x20007000));u.reg_write(UC_X86_REG_ESP,0x20002000);u.reg_write(UC_X86_REG_EAX,0x20006000)
 u.emu_start(0x4f6070,0x20003000,count=10000);bob.append(dict(id=name,stance=stance,ads=ads,speed=speed,cycle=cycle,output=struct.unpack('<3f',u.mem_read(0x20007000,12))))
 previous=list(struct.unpack('<3f',struct.pack('<3f',*previous)));u.mem_write(0x2000600c,struct.pack('<3f',*previous));u.mem_write(0x20007000,b'\0'*12);u.mem_write(0x20002000,struct.pack('<II',0x20003000,0x20007000));u.reg_write(UC_X86_REG_ESP,0x20002000);u.reg_write(UC_X86_REG_EDI,0x20006000)
 u.emu_start(0x4f5b90,0x20003000,count=10000);movement.append(dict(id=name,stance=stance,ads=ads,speed=speed,dt=struct.unpack('<f',struct.pack('<f',dt))[0],reload=reload,previous=previous,output=struct.unpack('<3f',u.mem_read(0x2000600c,12))))
 for a in [0x13ef63c,0x1597aec,0x1597adc,0x159a004,0x159a028,0x1597aac,0x13ef640,0x13ef694]:u.mem_write(a,struct.pack('<I',0x20009000))
 for a,v in [(0x143fc2c,round(dt*1000)),(0x14423e4,8 if stance==11 else 4 if stance==40 else 0),(0x143fc94,190),(0x143fd1c,5 if reload else 0),(0x143fd38,stance)]:u.mem_write(a,struct.pack('<I',v))
 for a,v in [(0x1445f9c,speed),(0x143fd20,ads),(0x143fd3c,stance)]:u.mem_write(a,struct.pack('<f',v))
 u.mem_write(0x1442528,struct.pack('<3f',*previous));u.mem_write(0x20007000,b'\0'*12);u.mem_write(0x20002000,struct.pack('<I',0x20003000));u.reg_write(UC_X86_REG_ESP,0x20002000);u.reg_write(UC_X86_REG_EDI,0x20007000)
 u.emu_start(0x4d5360,0x20003000,count=10000);positionMotion.append(dict(id=name,stance=stance,speed=speed,dt=dt,reload=reload,previous=previous,output=struct.unpack('<3f',u.mem_read(0x1442528,12))))
grid=json.loads((root/'public/maps/mp_toujane/lightgrid.json').read_text());rows=b''.join(struct.pack('<IBBH',*r) for r in grid['rows']);colors=bytes(c for row in grid['colors'] for c in row)
dllpe=pefile.PE(str(NATIVE_DLL))
print('Light grid constants',[(hex(a),struct.unpack('<f',dllpe.get_data(a-0x10000000,4))[0]) for a in [0x1019bf98,0x1019be68,0x1019bddc]])
lighting=[]
for blocked in [False,True]:
 decoder=LightGridDecoder(NATIVE_DLL,rows,colors,lambda a,b,mask:blocked)
 for position in [[2569,2274,130],[2109,2008,130],[2569,2274,190],[0,0,60],[-1000,-1000,100]]+[[rng.uniform(-1000,3000),rng.uniform(-1000,3000),rng.uniform(0,250)] for _ in range(25)]:
  position=list(struct.unpack('<3f',struct.pack('<3f',*position)));decoder.sample(position)
  c=struct.unpack('<24f',decoder.u.mem_read(0x20000500,96));sun=struct.unpack('<f',decoder.u.mem_read(0x20000400,4))[0]
  lighting.append(dict(position=position,blocked=blocked,output=[[c[i],c[8+i],c[16+i],sun] for i in range(8)]))
output=root/'artifacts/retail-menu-evidence/weapons/native-motion-lighting.json';output.write_text(json.dumps(dict(candidate_sha256=hashes,exe_sha256=hashlib.sha256(exe.read_bytes()).hexdigest(),gun=cases,view=view,bob=bob,movement=movement,positionMotion=positionMotion,lighting=lighting),indent=2))
print('Captured',len(cases),'native gun spring cases and',len(lighting),'original renderer lighting samples')
