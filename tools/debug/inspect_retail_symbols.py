#!/usr/bin/env python3
"""Report named call edges from a user-supplied Mach-O without copying its code."""
import argparse
import hashlib
import json
import re
import subprocess
from pathlib import Path

SYMBOLS = {
    'FS_AddIwdFilesForGameDirectory': '__Z30FS_AddIwdFilesForGameDirectoryPKcS0_',
    'FS_Startup': '__Z10FS_StartupPKc',
    'FS_ReadFile': '_FS_ReadFile',
    'UI_Init': '__Z7UI_Initv',
    'UI_LoadMenus': '__Z12UI_LoadMenusPKci',
    'SV_SpawnServer': '__Z14SV_SpawnServerPKc',
    'CL_InitCGame': '__Z12CL_InitCGamev',
    'CG_Init': '__Z7CG_Initiii',
    'CG_RegisterGraphics': '__Z19CG_RegisterGraphicsPKc',
    'CG_RegisterSounds': '__Z17CG_RegisterSoundsv',
    'CG_RegisterWeapon': '__Z17CG_RegisterWeaponi',
    'Com_LoadBsp': '__Z11Com_LoadBspPKc',
    'R_LoadWorld': '__Z11R_LoadWorldPKcPi',
    'XModelPrecache': '__Z14XModelPrecachePKcPFPviES3_',
    'XAnimPrecache': '__Z13XAnimPrecachePKcPFPviE',
    'R_InterpretSunLightParseParamsIntoLights': '__Z40R_InterpretSunLightParseParamsIntoLightsP19SunLightParseParamsP8GfxLight',
    'R_ParseSunLight': '__Z15R_ParseSunLightP19SunLightParseParamsPKc',
}


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('binary', type=Path)
    parser.add_argument('--objdump', default='llvm-objdump')
    parser.add_argument('--output', type=Path, required=True)
    args = parser.parse_args()
    data = args.binary.read_bytes()
    if data[:4] != b'\xce\xfa\xed\xfe':
        raise SystemExit('Expected a 32-bit little-endian Mach-O reference binary.')
    report = {'reference_name': args.binary.name, 'format': 'Mach-O i386',
              'sha256': hashlib.sha256(data).hexdigest(), 'size': len(data),
              'method': 'Static named direct-call inspection; no executable run; no raw code included.',
              'functions': []}
    for label, symbol in SYMBOLS.items():
        result = subprocess.run([args.objdump, '--macho', '--disassemble', '--dis-symname', symbol,
                                 str(args.binary)], check=True, capture_output=True, text=True)
        assembly = result.stdout
        address = re.search(r'^\s*([0-9a-f]+):', assembly, re.M)
        calls = []
        for line in assembly.splitlines():
            match = re.search(r'\bcalll?\s+(\S+)(?:\s+##\s*(.*))?', line)
            if match:
                target = match.group(2) or match.group(1)
                if target not in calls:
                    calls.append(target)
        report['functions'].append({'name': label, 'symbol': symbol,
                                    'address': '0x' + address.group(1) if address else None,
                                    'direct_calls': calls})
    args.output.parent.mkdir(parents=True, exist_ok=True)
    args.output.write_text(json.dumps(report, indent=2) + '\n')


if __name__ == '__main__':
    main()
