"""Discover and run Python tools from any working directory; archives stay disabled."""
import argparse
import json
from pathlib import Path
import subprocess
import sys

TOOLS = Path(__file__).resolve().parent
ROOT = TOOLS.parent


def main(argv=None):
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('command', nargs='?', default='list', help='list, info, canonical path, or original script name')
    parser.add_argument('arguments', nargs=argparse.REMAINDER)
    argv = list(sys.argv[1:] if argv is None else argv)
    if argv == ['--list']:
        argv = ['list']
    args = parser.parse_args(argv)
    manifest = json.loads((TOOLS / 'catalog.json').read_text(encoding='utf-8'))
    commands = manifest['commands']
    if args.command in {'list', '--list'}:
        for command in commands:
            if command['runtime'] == 'python':
                print(f"{command['id']:<54} {command['description']}")
        return 0
    info = args.command == 'info'
    name = args.arguments[0] if info and args.arguments else args.command
    options = args.arguments[1:] if info else args.arguments
    command = next((c for c in commands if name in [c['id'], c['path'], *c['aliases']]), None)
    if command is None:
        parser.error(f'Unknown or archived command: {name}. Run: python tools/run.py list')
    if info:
        print(json.dumps(command, indent=2))
        return 0
    if command['runtime'] != 'python':
        parser.error(f"Use node tools/run.mjs {command['id']} for this command")
    target = (TOOLS / command['path']).resolve()
    if not target.is_relative_to(TOOLS) or 'archive' in target.relative_to(TOOLS).parts or not target.is_file():
        parser.error('Command target is missing or outside the active tool tree')
    defaults = command.get('aliasArguments', {}).get(name, [])
    if options and options[0] == '--':
        options = options[1:]
    # A real subprocess preserves __main__, module-local globals, and SystemExit.
    result = subprocess.run([sys.executable, str(target), *defaults, *options], cwd=ROOT)
    return result.returncode if result.returncode >= 0 else 128 - result.returncode


if __name__ == '__main__':
    try:
        raise SystemExit(main())
    except KeyboardInterrupt:
        raise SystemExit(130)
