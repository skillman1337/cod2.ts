# Locate shared tools from both the checkout and the browser's virtual filesystem.
import sys as _tool_sys
from pathlib import Path as _ToolPath
_tool_sys.path.insert(0, str(next(p for p in _ToolPath(__file__).resolve().parents
                                    if (p / 'lib/project.py').is_file())))
from lib.project import ROOT as _PROJECT_ROOT, tool_script as _tool_script
from lib.native_paths import NATIVE_DLL

from pathlib import Path
import pefile,re,sys
p=NATIVE_DLL
b=p.read_bytes();pe=pefile.PE(data=b)
for m in re.finditer(rb'[ -~]{5,}',b):
    if re.search(sys.argv[1].encode(),m[0],re.I):print(hex(pe.OPTIONAL_HEADER.ImageBase+pe.get_rva_from_offset(m.start())),m[0].decode())
