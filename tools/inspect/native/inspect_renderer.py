# Locate shared tools from both the checkout and the browser's virtual filesystem.
import sys as _tool_sys
from pathlib import Path as _ToolPath
_tool_sys.path.insert(0, str(next(p for p in _ToolPath(__file__).resolve().parents
                                    if (p / 'lib/project.py').is_file())))
from lib.project import ROOT as _PROJECT_ROOT, tool_script as _tool_script
from lib.native_paths import NATIVE_DLL

from pathlib import Path
import pefile,capstone,re,hashlib,json
p=NATIVE_DLL
b=p.read_bytes();pe=pefile.PE(data=b);base=pe.OPTIONAL_HEADER.ImageBase
out=Path('artifacts/retail-menu-evidence/renderer');out.mkdir(exist_ok=True)
(out/'identity.json').write_text(json.dumps({'path':str(p),'sha256':hashlib.sha256(b).hexdigest(),'base':hex(base)},indent=2))
md=capstone.Cs(capstone.CS_ARCH_X86,capstone.CS_MODE_32);md.skipdata=True
with (out/'asm.txt').open('w') as f:
 for s in pe.sections:
  if s.Characteristics&0x20000000:
   for i in md.disasm(s.get_data(),base+s.VirtualAddress):f.write(f'{i.address:08x} {i.bytes.hex():24} {i.mnemonic} {i.op_str}\n')
for m in re.finditer(rb'[ -~]{5,}',b):
 if re.search(rb'lightmap|blur|sky|lump',m[0],re.I):print(hex(base+pe.get_rva_from_offset(m.start())),m[0].decode())
