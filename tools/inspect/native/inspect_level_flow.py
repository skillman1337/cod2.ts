# Locate shared tools from both the checkout and the browser's virtual filesystem.
import sys as _tool_sys
from pathlib import Path as _ToolPath
_tool_sys.path.insert(0, str(next(p for p in _ToolPath(__file__).resolve().parents
                                    if (p / 'lib/project.py').is_file())))
from lib.project import ROOT as _PROJECT_ROOT, tool_script as _tool_script
from lib.native_paths import NATIVE_EXE
from lib.retail_paths import GAME

from pathlib import Path
import pefile,capstone,zipfile,struct
root=GAME
pe=pefile.PE(str(NATIVE_EXE))
for address in [0x5ad128,0x5ad0ec]:
    print(hex(address),repr(pe.get_data(address-0x400000,100).split(b'\0')[0]))
md=capstone.Cs(capstone.CS_ARCH_X86,capstone.CS_MODE_32)
out='\n'.join(f'{i.address:08x} {i.bytes.hex()} {i.mnemonic} {i.op_str}' for i in md.disasm(pe.get_data(0x57a70,235),0x457a70))
Path('artifacts/retail-menu-evidence/gametype-validation.asm').write_text(out)
print('Connect heading color',struct.unpack('<4f',pe.get_data(0x59d048-0x400000,16)))
Path('artifacts/retail-menu-evidence/connect-headings.asm').write_text('\n'.join(f'{i.address:08x} {i.bytes.hex()} {i.mnemonic} {i.op_str}' for i in md.disasm(pe.get_data(0x539181-0x400000,0x66),0x539181)))
for archive in sorted((root/'main').glob('*.iwd')):
    with zipfile.ZipFile(archive) as z:
        for name in ['ui_mp/connect.menu','maps/mp/gametypes/_teams.gsc','maps/mp/gametypes/_menus.gsc','maps/mp/gametypes/dm.gsc','maps/mp/mp_toujane.gsc']:
            if name in z.namelist():
                target=Path('artifacts/retail-menu-evidence/level-scripts')/name
                target.parent.mkdir(parents=True,exist_ok=True);target.write_bytes(z.read(name))
                print(archive.name,name)
