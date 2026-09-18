"""Create a source-only ZIP with a byte-accurate hash manifest; no root game assets."""
# Locate shared tools from both the checkout and the browser's virtual filesystem.
import sys as _tool_sys
from pathlib import Path as _ToolPath
_tool_sys.path.insert(0, str(next(p for p in _ToolPath(__file__).resolve().parents
                                    if (p / 'lib/project.py').is_file())))
from lib.project import ROOT as _PROJECT_ROOT, tool_script as _tool_script

import argparse
import hashlib
import os
from pathlib import Path
import tempfile
import zipfile

# Exclusions are scoped: tools/assets is source; project-root assets is game data.
ROOT_DIRECTORIES = {'engine', 'tools', 'types', 'browser', 'docs'}
CACHE_DIRECTORIES = {'.git', 'node_modules', '__pycache__', '.venv', '.pytest_cache',
                     '.mypy_cache', '.ruff_cache', '.cache', 'vendor-runtime'}
EXTENSIONS = {'.ts', '.tsx', '.mts', '.cts', '.mjs', '.cjs', '.js', '.py', '.json',
              '.md', '.txt', '.cpp', '.h', '.hpp', '.inc', '.html', '.css', '.disabled'}


def source_paths(root: Path, output: Path):
    paths = []
    for directory, children, names in os.walk(root, followlinks=False):
        parent = Path(directory)
        relative_parent = parent.relative_to(root)
        children[:] = sorted(name for name in children
                             if name not in CACHE_DIRECTORIES
                             and not name.startswith('.tools-cleanup-')
                             and not (parent / name).is_symlink()
                             and (relative_parent.parts or name in ROOT_DIRECTORIES))
        for name in sorted(names):
            file = parent / name
            if file.is_symlink() or file == output or not file.is_file():
                continue
            if name in {'SOURCE-SHA256.txt', 'asset-setup.json'}:
                continue
            if file.suffix.lower() not in EXTENSIONS and name not in {'LICENSE', 'NOTICE'}:
                continue
            paths.append(file)
    return sorted(paths, key=lambda p: p.relative_to(root).as_posix())


def package_source(root: Path, output: Path):
    """Atomically write selected source; never follow links or include root game data."""
    root, output = root.resolve(), output.resolve()
    if not root.is_dir():
        raise FileNotFoundError(f'Project root does not exist: {root}')
    paths = source_paths(root, output)
    relative_names = {p.relative_to(root).as_posix() for p in paths}
    required = {'tools/assets/setup_assets.py', 'tools/vendor/iwi/LICENSE'}
    if not required <= relative_names:
        raise ValueError(f'Missing required source: {sorted(required - relative_names)}')
    output.parent.mkdir(parents=True, exist_ok=True)
    handle, temporary_name = tempfile.mkstemp(prefix='.source-', suffix='.zip', dir=output.parent)
    os.close(handle)
    temporary = Path(temporary_name)
    try:
        with zipfile.ZipFile(temporary, 'w', zipfile.ZIP_DEFLATED, compresslevel=9) as archive:
            manifest = []
            for file in paths:
                relative = file.relative_to(root).as_posix()
                data = file.read_bytes()
                archive.writestr('webgpu/' + relative, data)
                manifest.append(hashlib.sha256(data).hexdigest() + '  ' + relative + '\n')
            archive.writestr('webgpu/SOURCE-SHA256.txt', ''.join(manifest))
        with zipfile.ZipFile(temporary) as archive:
            if archive.testzip() is not None:
                raise RuntimeError('Source ZIP integrity check failed')
        os.replace(temporary, output)
    finally:
        temporary.unlink(missing_ok=True)
    return len(paths)


def main(argv=None):
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('output', type=Path)
    parser.add_argument('--root', type=Path, default=_PROJECT_ROOT)
    args = parser.parse_args(argv)
    count = package_source(args.root, args.output)
    print(f'Packaged {count} source files: {args.output.resolve()} ({args.output.stat().st_size} bytes)')


if __name__ == '__main__':
    main()
