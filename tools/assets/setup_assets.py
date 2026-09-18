"""Build browser assets from a user's retail CoD2 installation (never modifies it)."""

# Locate shared tools from both the checkout and the browser's virtual filesystem.
import sys as _tool_sys
from pathlib import Path as _ToolPath
_tool_sys.path.insert(0, str(next(p for p in _ToolPath(__file__).resolve().parents
                                    if (p / 'lib/project.py').is_file())))
from lib.project import ROOT as _PROJECT_ROOT, tool_script as _tool_script

from pathlib import Path
import argparse, hashlib, importlib.util, json, os, re, shutil, subprocess, sys, zipfile

ROOT = _PROJECT_ROOT
HASHES = {
    'exe': {
        'bc5a7d561cb993cf43d5d4159b71721b4c4dca239d04de83540977769fcb05b8',
        '45017af1568fada4703ad5916817a91cc9fbb6c7a237a78915046c83cd8ce370',
        'e65c4ee7dc2f5b4f46429dd148fe3fa99811a7b0dfcbc905eb0e6d0124644736',
    },
    'dll': {
        'aed5b8de2459304f43e199621ffcc51409d090d63a73c4bb7bb23d9ccaa6561d',
        '3f3d619c0ba6a25062a72fedbaa6363e1c9ba016895ead0ee55d48212bd55d15',
    },
}

def fail(message):
    raise RuntimeError(message)

def binary(folder, name, override):
    if override:
        return Path(override).expanduser().resolve()
    result = next((p for p in folder.iterdir() if p.name.lower() == name.lower()), folder / name)
    return result

def main():
    ap = argparse.ArgumentParser(description=__doc__)
    ap.add_argument('game', type=Path, help='CoD2 installation folder, or the main folder containing IWDs')
    ap.add_argument('--exe', help='Original CoD2MP_s.exe (if outside the installation folder)')
    ap.add_argument('--dll', help='Original gfx_d3d_mp_x86_s.dll (if outside the installation folder)')
    ap.add_argument('--cpp', help='GCC/Clang C preprocessor executable')
    ap.add_argument('--cxx', help='G++/Clang++ C++20 compiler executable')
    ap.add_argument('--maps', nargs='+', default=['mp_toujane'], help='Map names, or all (default: mp_toujane)')
    ap.add_argument('--check', action='store_true', help='Check inputs and tools without generating assets')
    args = ap.parse_args()
    folder = args.game.expanduser().resolve()
    if not folder.is_dir(): fail(f'Game folder does not exist: {folder}')
    main_folder = folder / 'main' if (folder / 'main').is_dir() else folder
    game = main_folder.parent if main_folder.name.lower() == 'main' else folder
    archives = sorted((p for p in main_folder.iterdir() if p.suffix.lower() == '.iwd'), key=lambda p:p.name.lower())
    if not archives: fail(f'No .iwd archives found in {main_folder}')
    if any(p.suffix != '.iwd' for p in archives): fail('Archive extensions must be lowercase .iwd for the extractors (rename the copied archives on Linux).')
    exe = binary(game, 'CoD2MP_s.exe', args.exe)
    dll = binary(game, 'gfx_d3d_mp_x86_s.dll', args.dll)
    for module, package in [('PIL', 'Pillow'), ('numpy', 'numpy'), ('pefile', 'pefile')]:
        if importlib.util.find_spec(module) is None:
            fail(f'Missing Python package {package}. Run: "{sys.executable}" -m pip install -r tools/requirements-assets.txt')
    cpp = args.cpp or shutil.which('gcc') or shutil.which('clang')
    cxx = args.cxx or shutil.which('g++') or shutil.which('clang++')
    if not cpp or not cxx: fail('GCC/G++ or Clang/Clang++ is required. Install a C++20 compiler, or pass --cpp and --cxx with executable paths.')
    for tool in [cpp,cxx]:
        subprocess.run([tool,'--version'],check=True,stdout=subprocess.DEVNULL)
    entries = {}
    for archive in archives:
        with zipfile.ZipFile(archive) as z:
            for name in z.namelist():
                if name.endswith('/'): continue
                if name.startswith(('/', '\\')) or '..' in Path(name.replace('\\','/')).parts:
                    fail(f'Unsafe archive entry: {archive.name}: {name}')
                entries[name.lower()] = (archive, name)
    def read(name):
        if name.lower() not in entries: fail(f'Missing retail archive entry: {name}. Supply the full main folder, including localized IWDs.')
        archive, entry = entries[name.lower()]
        with zipfile.ZipFile(archive) as z: return z.read(entry)
    maps = sorted(Path(n).stem for n in entries if re.fullmatch(r'maps/mp/mp_[a-z0-9_]+\.d3dbsp',n)) if args.maps == ['all'] else args.maps
    if not maps: fail('No multiplayer map BSPs found in these archives.')
    for name in maps:
        if not re.fullmatch(r'mp_[a-z0-9_]+',name): fail(f'Invalid map name: {name}')
        read(f'maps/mp/{name}.d3dbsp')
    for name in ['ui_mp/menus.txt','ui_mp/hud.menu','default_mp.cfg','fonts/normalFont','images/gamefonts.iwi','sound/music/menu_GRTEMP.mp3']:
        read(name)
    print(f'Inputs checked: {len(archives)} archives; maps: {", ".join(maps)}',flush=True)
    if args.check: return
    os.chdir(ROOT)
    for name in ['assets/ui','assets/fonts','assets/images','assets/sound','public/maps','public/sound','artifacts/retail-menu-evidence/renderer']:
        (ROOT/name).mkdir(parents=True,exist_ok=True)
    env = dict(os.environ, COD2_MAIN=str(main_folder), COD2_GAME=str(game), COD2_EXE=str(exe), COD2_DLL=str(dll), COD2_CPP=str(cpp), COD2_CXX=str(cxx), PYTHONUTF8='1')
    env['PATH']=str(Path(cxx).resolve().parent)+os.pathsep+env.get('PATH','')
    os.environ.update(env)
    def run(script,*arguments):
        print(f'Extracting: {script} {" ".join(arguments)}',flush=True)
        subprocess.run([sys.executable,str(_tool_script('assets/' + script)),*arguments],cwd=ROOT,env=env,check=True)
    from lib.iwi import read_iwi, read_iwi_mip0
    for name in ['sound/music/menu_GRTEMP.mp3','sound/misc/mouse_ylover.wav','sound/misc/mouse_ylselect.wav']:
        target=ROOT/'assets'/name;target.parent.mkdir(parents=True,exist_ok=True);target.write_bytes(read(name))
    for name in ['gamefonts','3_cursor3','background_american_w']:
        raw=read('images/'+name+'.iwi');read_iwi(raw)[2].save(ROOT/'assets/images'/f'{name}.png')
        if name=='gamefonts':
            fmt,w,h,pixels=read_iwi_mip0(raw)
            if fmt!=13: fail('Expected the supported retail DXT5 font atlas.')
            (ROOT/'assets/images/gamefonts.bc3').write_bytes(pixels)
    run('extract_retail_fonts.py',str(main_folder))
    run('extract_retail_menus.py',str(main_folder),'--cpp',cpp)
    run('extract_retail_hud.py')
    run('extract_menu_materials.py',str(main_folder))
    run('extract_retail_dvars.py')
    run('extract_retail_stance.py')
    run('extract_movement_audio.py')
    run('extract_retail_mantle.py','--curves-only')
    run('extract_lightmap_weights.py')
    run('extract_exe_icon.py')
    run('extract_viewmodels.py')
    run('extract_weapon_effects.py')
    for name in maps: run('extract_retail_map.py',name,'--main',str(main_folder))
    run('export_dynamic_lightgrid.py')
    missing=[]
    for source in (ROOT/'engine').rglob('*.ts'):
        for relative in re.findall(r'[\'\"]@/(assets/[^\'\"?]+)',source.read_text(encoding='utf-8')):
            if not (ROOT/relative).is_file(): missing.append(relative)
    if missing: fail('Missing generated imports: '+', '.join(sorted(set(missing))))
    (ROOT/'asset-setup.json').write_text(json.dumps({'maps':maps,'binaries':{kind: sorted(values) for kind, values in HASHES.items()},'archives':[p.name for p in archives]},indent=2)+'\n')
    print('Asset setup complete. Run npm ci, npm run exec:map, then npm run dev. Map console command: map '+maps[0],flush=True)

if __name__=='__main__':
    try: main()
    except (RuntimeError,OSError,subprocess.CalledProcessError,zipfile.BadZipFile) as error:
        print(f'Asset setup failed: {error}',file=sys.stderr)
        sys.exit(1)
