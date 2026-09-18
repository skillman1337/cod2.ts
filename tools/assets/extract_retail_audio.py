"""Export startup ambient aliases referenced by retail MP map scripts.

This preserves alias metadata and archive precedence; it is not a GSC interpreter.
"""

# Locate shared tools from both the checkout and the browser's virtual filesystem.
import sys as _tool_sys
from pathlib import Path as _ToolPath
_tool_sys.path.insert(0, str(next(p for p in _ToolPath(__file__).resolve().parents
                                    if (p / 'lib/project.py').is_file())))
from lib.project import ROOT as _PROJECT_ROOT, tool_script as _tool_script

from pathlib import Path
import csv, hashlib, io, json, re, zipfile

ROOT = _PROJECT_ROOT
from lib.retail_paths import MAIN
entries = {}
for archive in sorted(MAIN.glob('*.iwd')):
    with zipfile.ZipFile(archive) as z:
        for name in z.namelist():
            if name.startswith(('sound/', 'soundaliases/', 'maps/mp/')):
                entries[name] = archive
def read(name):
    name = next((key for key in entries if key.lower() == name.lower()), name)
    with zipfile.ZipFile(entries[name]) as z:
        return z.read(name)
maps = {}
for name in entries:
    if re.fullmatch(r'maps/mp/mp_[^/]+\.gsc', name):
        match = re.search(r'\bambientPlay\(\s*"([^"]+)"\s*\)', read(name).decode('cp1252'))
        if match:
            maps[Path(name).stem] = match[1]
aliases = {}
dest = ROOT/'public/sound'
dest.mkdir(parents=True, exist_ok=True)
for name in entries:
    if not name.startswith('soundaliases/') or not name.endswith('.csv'):
        continue
    lines = read(name).decode('cp1252').splitlines()
    start = next((i for i, line in enumerate(lines) if line.startswith('name,')), None)
    if start is None:
        continue
    for row in csv.DictReader(lines[start:]):
        alias = row.get('name', '')
        if alias not in maps.values() or not row.get('file'):
            continue
        source = 'sound/'+row['file'].replace('\\', '/')
        raw = read(source)
        target = dest/row['file'].replace('\\','/')
        target.parent.mkdir(parents=True, exist_ok=True)
        target.write_bytes(raw)
        aliases.setdefault(alias, []).append(dict(url='/'+source, volume=float(row.get('vol_min') or 1),
            loop=row.get('loop') == 'looping', channel=row.get('channel'), loadspec=row.get('loadspec'),
            archive=entries[next(key for key in entries if key.lower() == source.lower())].name, table=name, sha256=hashlib.sha256(raw).hexdigest()))
(dest/'ambient.json').write_text(json.dumps(dict(maps=maps, aliases=aliases), indent=2)+'\n')
print('Exported', len(aliases), 'ambient aliases for', len(maps), 'maps')
