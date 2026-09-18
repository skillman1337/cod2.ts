"""Preserve executable RT_GROUP_ICON images in a multi-resolution ICO."""

# Locate shared tools from both the checkout and the browser's virtual filesystem.
import sys as _tool_sys
from pathlib import Path as _ToolPath
_tool_sys.path.insert(0, str(next(p for p in _ToolPath(__file__).resolve().parents
                                    if (p / 'lib/project.py').is_file())))
from lib.project import ROOT as _PROJECT_ROOT, tool_script as _tool_script

from pathlib import Path
import hashlib,json,struct,pefile
root=_PROJECT_ROOT
from lib.retail_paths import EXE
source=EXE
if source.is_file():
    try:
        pe=pefile.PE(data=source.read_bytes())
        if hasattr(pe, 'DIRECTORY_ENTRY_RESOURCE'):
            resources={entry.id:entry for entry in pe.DIRECTORY_ENTRY_RESOURCE.entries}
            def payload(entry):
                leaf=entry.directory.entries[0].data.struct
                return pe.get_data(leaf.OffsetToData,leaf.Size)
            if 14 in resources and 3 in resources:
                group=payload(resources[14].directory.entries[0]);count=struct.unpack_from('<H',group,4)[0]
                icons={entry.id:payload(entry) for entry in resources[3].directory.entries}
                header=bytearray(group[:6]);images=[];offset=6+count*16
                for index in range(count):
                    entry=group[6+index*14:20+index*14];icon_id=struct.unpack_from('<H',entry,12)[0];image=icons[icon_id]
                    header+=entry[:8]+struct.pack('<II',len(image),offset);images.append(image);offset+=len(image)
                out=root/'public/cod2.ico';out.parent.mkdir(parents=True,exist_ok=True);out.write_bytes(bytes(header)+b''.join(images))
                (root/'public/favicon.ico').write_bytes(out.read_bytes())
                evidence=root/'artifacts/retail-menu-evidence/icon.json'
                evidence.parent.mkdir(parents=True,exist_ok=True)
                evidence.write_text(json.dumps(dict(executable_sha256=hashlib.sha256(source.read_bytes()).hexdigest(),icon_sha256=hashlib.sha256(out.read_bytes()).hexdigest(),images=count),indent=2)+'\n')
                print(f'Extracted {count} original icon images to {out}')
    except Exception as e:
        print(f'Notice: could not extract icon from {source}: {e}')
else:
    print('Notice: CoD2MP_s.exe not provided; using default icon')
