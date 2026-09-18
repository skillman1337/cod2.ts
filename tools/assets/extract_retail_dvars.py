"""Recover literal dvar registrations from executable instructions or bundled database.

Only direct cdecl name arguments are accepted. Dynamic names remain outside this
bounded catalogue; each accepted record retains its call and string addresses.
"""

# Locate shared tools from both the checkout and the browser's virtual filesystem.
import sys as _tool_sys
from pathlib import Path as _ToolPath
_tool_sys.path.insert(0, str(next(p for p in _ToolPath(__file__).resolve().parents
                                    if (p / 'lib/project.py').is_file())))
from lib.project import ROOT as _PROJECT_ROOT, tool_script as _tool_script

from pathlib import Path
import hashlib, json, re, struct, base64, zlib
from lib.retail_paths import EXE, GAME

ROOT = _PROJECT_ROOT

DEFAULT_DVARS_ZLIB = b"""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"""

records = {}; history = []; registers = {}; pushed = {}

if EXE.is_file():
    try:
        import pefile
        from capstone import Cs, CS_ARCH_X86, CS_MODE_32
        from capstone.x86 import X86_OP_IMM, X86_OP_REG, X86_OP_MEM

        pe = pefile.PE(data=EXE.read_bytes()); base = pe.OPTIONAL_HEADER.ImageBase
        md = Cs(CS_ARCH_X86, CS_MODE_32); md.detail = True; md.skipdata = True
        registrars = {0x437ff0:'bool',0x438050:'int',0x4380b0:'float',0x438130:'vec2',0x4381c0:'vec3',0x438250:'vec4',0x4382f0:'string',0x438350:'enum',0x4383c0:'color',0x437d90:'generic'}
        def operand_value(operand):
            if operand.type == X86_OP_IMM: return operand.imm
            if operand.type == X86_OP_REG: return registers.get(operand.reg)
            return None
        def string_at(address):
            if not base <= address < base + pe.OPTIONAL_HEADER.SizeOfImage: return None
            try: return pe.get_data(address-base,256).split(b'\0')[0].decode('ascii')
            except (UnicodeError, ValueError): return None
        for section in pe.sections:
            if not section.Characteristics & 0x20000000: continue
            for ins in md.disasm(section.get_data(),base+section.VirtualAddress):
                if ins.mnemonic == 'mov' and ins.operands[0].type == X86_OP_REG:
                    registers[ins.operands[0].reg]=operand_value(ins.operands[1])
                elif ins.mnemonic == 'xor' and ins.op_str.split(', ')[0] == ins.op_str.split(', ')[-1] and ins.operands[0].type == X86_OP_REG:
                    registers[ins.operands[0].reg]=0
                elif ins.mnemonic == 'push': pushed[ins.address]=operand_value(ins.operands[0])
                elif ins.id:
                    _,writes=ins.regs_access()
                    for register in writes: registers.pop(register,None)
                if ins.mnemonic == 'call' and ins.operands and ins.operands[0].type == X86_OP_IMM:
                    target = ins.operands[0].imm
                    if target in registrars:
                        pushes = [x for x in history if x.mnemonic == 'push']
                        if pushes and pushes[-1].operands[0].type == X86_OP_IMM:
                            address = pushes[-1].operands[0].imm; name = string_at(address)
                            if name and re.fullmatch(r'[a-zA-Z_][a-zA-Z0-9_]*',name):
                                record = records.setdefault(name.lower(),dict(name=name,kind=registrars[target],sites=[]))
                                record['sites'].append(dict(call=hex(ins.address),registrar=hex(target),name_address=hex(address),call_bytes=ins.bytes.hex()))
                                args=[pushed.get(x.address) for x in reversed(pushes)]
                                dimensions={'float':1,'vec2':2,'vec3':3,'vec4':4,'int':1}.get(registrars[target])
                                if dimensions and len(args)>dimensions+2:
                                    for key,index in [('min',dimensions+1),('max',dimensions+2)]:
                                        value=args[index]
                                        if value is not None:
                                            value=struct.unpack('<i' if registrars[target]=='int' else '<f',struct.pack('<I',value&0xffffffff))[0]
                                            if abs(value)<float('inf'):record[key]=value
                                flag_index={0x437ff0:2,0x438050:4,0x4380b0:4,0x4382f0:2,0x438350:3,0x437d90:2}.get(target)
                                if flag_index is not None and len(args)>flag_index and args[flag_index] is not None and 0<=args[flag_index]<=0xffff:
                                    record['flags']=record.get('flags',0)|args[flag_index]
                                if target in [0x437ff0,0x438050,0x4380b0,0x4382f0] and len(args)>1 and args[1] is not None:
                                    value = args[1]
                                    if target == 0x4382f0: value=string_at(value)
                                    elif target == 0x4380b0: value=struct.unpack('<f',struct.pack('<I',value&0xffffffff))[0]
                                    if value is not None: record.setdefault('default',format(value,'.6g') if isinstance(value,float) else str(value))
                                if target == 0x438350 and len(args)>2 and args[1] is not None:
                                    choices=[]
                                    for index in range(128):
                                        raw=pe.get_data(args[1]-base+index*4,4)
                                        if len(raw)!=4: break
                                        pointer=struct.unpack('<I',raw)[0]
                                        if not pointer: break
                                        choice=string_at(pointer)
                                        if choice is None: break
                                        choices.append(choice)
                                    if choices:
                                        record['choices']=choices
                                        if args[2] is not None and 0<=args[2]<len(choices): record['default']=choices[args[2]]
                    history = []
                elif ins.mnemonic.startswith('j') or ins.mnemonic in ['ret','int3','.byte']: history=[]; registers={}
                else: history=(history+[ins])[-24:]
    except Exception as e:
        print(f"Notice: could not extract dvars from PE {EXE}: {e}")

out_path = ROOT / 'assets/ui/dvars.json'
out_path.parent.mkdir(parents=True, exist_ok=True)

if not records:
    # Use bundled fallback database
    raw = zlib.decompress(base64.b64decode(DEFAULT_DVARS_ZLIB))
    out_path.write_bytes(raw)
    parsed = json.loads(raw)
    records = {r['name'].lower(): r for r in parsed.get('dvars', [])}
else:
    exe_hash = hashlib.sha256(EXE.read_bytes()).hexdigest() if EXE.is_file() else ''
    output = dict(executable_sha256=exe_hash, scope='Direct literal registration sites; dynamic names and conditional activation are not reconstructed.', dvars=sorted(records.values(), key=lambda r: r['name'].lower()))
    out_path.write_text(json.dumps(output, indent=2) + '\n', encoding='utf-8')

print(f'Recovered {len(records)} literal dvar registrations; cg_blood = {records.get("cg_blood")}')
