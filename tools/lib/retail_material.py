"""Compiled material bindings and render-state words (retail renderer layout)."""
import struct

def material_definition(data):
    def string(offset):
        assert 0<offset<len(data)
        return data[offset:data.index(0,offset)].decode('ascii')
    color,depth=struct.unpack_from('<II',data,44)
    textures,constants,technique,texture_table,constant_table=struct.unpack_from('<HHIII',data,52)
    bindings={}
    for i in range(textures):
        semantic,sampler,image=struct.unpack_from('<III',data,texture_table+i*12)
        bindings[string(semantic)]=dict(image=string(image),sampler=sampler)
    values={}
    for i in range(constants):
        name,*value=struct.unpack_from('<I4f',data,constant_table+i*20)
        values[string(name)]=value
    # 0x1003c933..0x1003ca43: alpha-test disable bit, mode/ref.
    state=dict(src=color&15,dst=(color>>4)&15,offset=(depth>>4)&3,
               write=bool(depth&1),sort=data[13],alpha=-1 if color&0x800 else (color>>12)&3,
               compare='always' if depth&2 or depth&12 not in (4,8) else ('less-equal' if depth&12==4 else 'equal'))
    technique_name=string(technique)
    # 0x1003cb33..0x1003cb96, table at 0x10190704: D3DCULL 0,1,3,2.
    # Native clockwise faces survive D3DCULL_CCW; the GPU pipeline declares cw.
    state['cull']=('none','none','back','front')[(color>>14)&3]
    # Technique families choose different shipped shader programs. Emissive /
    # vertex-color effects must not enter the lightmap/normal-map calculation.
    state['lit']=technique_name.startswith(('phong_','ambient_','water'))
    state['fog']=not technique_name.endswith('_nofog')
    state['multiply']=technique_name.startswith('effect_multiply')
    return dict(bindings=bindings,constants=values,technique=technique_name,state=state)

if __name__=='__main__':
    import sys,json
    from pathlib import Path
    print(json.dumps(material_definition(Path(sys.argv[1]).read_bytes()),indent=2))
