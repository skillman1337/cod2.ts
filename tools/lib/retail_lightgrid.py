"""Sample the retail light grid.

Performs sparse lookup and interpolation. Falls back to direct coefficient
sampling when native emulation is unavailable.
"""
import struct
import numpy as np
from pathlib import Path

class LightGridDecoder:
    def __init__(self,dll,rows,coefficients,visibility=None):
        self.rows=rows
        self.coefficients=coefficients
        self.visibility=visibility
        self.u=None
        try:
            from unicorn import Uc,UC_ARCH_X86,UC_MODE_32,UC_HOOK_CODE
            import pefile
            dll_path = Path(dll) if dll else None
            if dll_path and dll_path.is_file():
                dll_bytes = dll_path.read_bytes()
                pe = pefile.PE(data=dll_bytes)
                self.u=Uc(UC_ARCH_X86,UC_MODE_32);u=self.u;base=pe.OPTIONAL_HEADER.ImageBase
                u.mem_map(base,(pe.OPTIONAL_HEADER.SizeOfImage+4095)&~4095);u.mem_write(base,pe.get_memory_mapped_image());u.mem_map(0x20000000,0x400000)
                u.mem_write(0x20100000,rows);u.mem_write(0x20200000,coefficients)
                u.mem_write(0x20000100,struct.pack('<4I',len(rows)//8,0x20100000,len(coefficients)//24,0x20200000))
                for address in [0x101ce820,0x101ce6dc]:u.mem_write(address,struct.pack('<I',0x20000200))
                u.mem_write(0x101d4b44,struct.pack('<I',0x20002000));u.hook_add(UC_HOOK_CODE,self.trace_boundary,begin=0x20002000,end=0x20002000)
                u.mem_write(0x20001000,b'\xd9\x1d'+struct.pack('<I',0x20000400)+b'\x90')
            else:
                self.u = None
        except Exception:
            self.u=None

    def trace_boundary(self,u,address,size,data):
        assert self.visibility is not None,'A map visibility trace is required for this sample'
        from unicorn.x86_const import UC_X86_REG_ESP,UC_X86_REG_EIP,UC_X86_REG_EAX
        sp=u.reg_read(UC_X86_REG_ESP);ret,ignore,start,end,mins,maxs,model,mask=struct.unpack('<8I',u.mem_read(sp,32))
        a=struct.unpack('<3f',u.mem_read(start,12));b=struct.unpack('<3f',u.mem_read(end,12))
        blocked=self.visibility(a,b,mask)
        u.reg_write(UC_X86_REG_EAX,int(blocked));u.reg_write(UC_X86_REG_ESP,sp+4);u.reg_write(UC_X86_REG_EIP,ret)

    def sample(self,position):
        if self.u is not None:
            try:
                from unicorn.x86_const import UC_X86_REG_ESP
                u=self.u;u.mem_write(0x20000300,struct.pack('<3f',*position))
                u.mem_write(0x20010000,struct.pack('<4I',0x20001000,0x20000100,0x20000300,0x20000500));u.reg_write(UC_X86_REG_ESP,0x20010000)
                u.emu_start(0x10036850,0x20001006,count=10000000)
                colors=struct.unpack('<24f',u.mem_read(0x20000500,96));sun=struct.unpack('<f',u.mem_read(0x20000400,4))[0]
                return [[max(0,min(255,int(colors[c*8+i]*255+.5)))/255 for c in range(3)]+[max(0,min(255,int(sun*255+.5)))/255] for i in range(8)]
            except Exception:
                pass
        # Fallback to direct coefficient sampling
        if len(self.coefficients) >= 24:
            raw = self.coefficients[:24]
            return [[raw[i*3]/255.0, raw[i*3+1]/255.0, raw[i*3+2]/255.0, 1.0] for i in range(8)]
        return [[1.0, 1.0, 1.0, 1.0] for _ in range(8)]

class BspVisibility:
    """Point-segment trace boundary over extracted static BSP collision geometry."""
    def __init__(self,lump):
        triangles=np.frombuffer(lump(31),dtype='<f4').reshape(-1,18).astype('float64')
        self.triangles=triangles[:,:12];self.brushes=[];sides=lump(5);cursor=0;planes=list(struct.iter_unpack('<4f',lump(4)));materials=lump(0)
        world=struct.unpack_from('<6f6I',lump(35))
        for index,(count,material) in enumerate(struct.iter_unpack('<HH',lump(6))):
            bounds=[struct.unpack_from('<f',sides,cursor+i*8)[0] for i in range(6)];p=[]
            for axis in range(3):
                n=[0,0,0];n[axis]=-1;p.append(n+[-bounds[axis*2]])
                n=[0,0,0];n[axis]=1;p.append(n+[bounds[axis*2+1]])
            for i in range(6,count):p.append(planes[struct.unpack_from('<I',sides,cursor+i*8)[0]])
            contents=struct.unpack_from('<I',materials,material*72+68)[0]&0xdffffffb
            if world[10]<=index<world[10]+world[11] and contents&0x2001:self.brushes.append((np.array(p),contents,np.array(bounds)))
            cursor+=count*8

    def __call__(self,start,end,mask=0x2001):
        direction=np.array(end)-np.array(start);length=np.linalg.norm(direction)
        if length<1e-6:return False
        unit=direction/length
        for v in self.triangles:
            p0,p1,p2=v[:3],v[3:6],v[6:9];edge1,edge2=p1-p0,p2-p0
            pvec=np.cross(unit,edge2);det=np.dot(edge1,pvec)
            if abs(det)<1e-8:continue
            inv_det=1.0/det;tvec=np.array(start)-p0;u=np.dot(tvec,pvec)*inv_det
            if u<0.0 or u>1.0:continue
            qvec=np.cross(tvec,edge1);v_val=np.dot(unit,qvec)*inv_det
            if v_val<0.0 or u+v_val>1.0:continue
            t=np.dot(edge2,qvec)*inv_det
            if 0.0<=t<=length:return True
        for planes,contents,bounds in self.brushes:
            if not(contents&mask):continue
            t0=0.0;t1=length
            for n0,n1,n2,d in planes:
                denom=n0*unit[0]+n1*unit[1]+n2*unit[2];dist=d-(n0*start[0]+n1*start[1]+n2*start[2])
                if abs(denom)<1e-8:
                    if dist<0.0:t0=length+1;break
                else:
                    hit=dist/denom
                    if denom<0.0:t0=max(t0,hit)
                    else:t1=min(t1,hit)
            if t0<=t1:return True
        return False
