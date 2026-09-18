# Locate shared tools from both the checkout and the browser's virtual filesystem.
import sys as _tool_sys
from pathlib import Path as _ToolPath
_tool_sys.path.insert(0, str(next(p for p in _ToolPath(__file__).resolve().parents
                                    if (p / 'lib/project.py').is_file())))
from lib.project import ROOT as _PROJECT_ROOT, tool_script as _tool_script
from lib.native_paths import NATIVE_EXE
from lib.native_paths import NATIVE_DLL
from lib.retail_paths import GAME

from pathlib import Path
import zipfile,struct,json,hashlib,pefile
from capstone import Cs,CS_ARCH_X86,CS_MODE_32
base=GAME;entries={}
for p in sorted((base/'main').glob('*.iwd')):
 with zipfile.ZipFile(p) as z:
  for n in z.namelist():entries[n.lower()]=(p,n)
def read(n):
 p,n=entries[n.lower()]
 with zipfile.ZipFile(p) as z:return z.read(n)
out=Path('artifacts/retail-menu-evidence/weapons');out.mkdir(exist_ok=True)
for n in entries:
 if ('muzzleflashes/heavy_view' in n or 'impact' in n and n.endswith('.csv') or 'bullet' in n and n.endswith('.csv')):
  b=read(n);(out/n.replace('/','_')).write_bytes(b);print(n,len(b),repr(b[:250]))
p=pefile.PE(str(NATIVE_EXE))
for a in [0x5c4064,0x5c405c,0x5c3e60,0x5c3e28,0x5c3e70]:print(hex(a),struct.unpack('<f',p.get_data(a-0x400000,4))[0])
md=Cs(CS_ARCH_X86,CS_MODE_32)
for name,address,size in [('CoD2MP_s.exe',0x4f46c0,0x100),('gfx_d3d_mp_x86_s.dll',0x10035e70,0xe90)]:
 p=pefile.PE(str((NATIVE_EXE if name == 'CoD2MP_s.exe' else NATIVE_DLL)));code=p.get_data(address-p.OPTIONAL_HEADER.ImageBase,size)
 (out/f'{address:x}.asm').write_text('\n'.join(f'{i.address:08x} {i.bytes.hex()} {i.mnemonic} {i.op_str}' for i in md.disasm(code,address)))
 print(name,hex(address),hashlib.sha256(code).hexdigest())

for n in ['gfx_exp_fireball_atlas','gfx_whisp_spiral','gfx/reticle/side_skinny_xenon.tga']:
 b=read('materials/'+n);print(n,b[:52].hex(' '))
