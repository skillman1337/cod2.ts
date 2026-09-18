"""Extract a retail IBSP v4 world mesh, entities and material images.

Layout hypothesis cross-reference: bsp_tool/infinity_ward/call_of_duty2.py.
Every lump, soup and index is checked against this installed BSP before export.
Static models and convex collision volumes are exported; effects, dynamic
collision, native capsule tracing and the game-script VM remain separate.
"""

# Locate shared tools from both the checkout and the browser's virtual filesystem.
import sys as _tool_sys
from pathlib import Path as _ToolPath
_tool_sys.path.insert(0, str(next(p for p in _ToolPath(__file__).resolve().parents
                                    if (p / 'lib/project.py').is_file())))
from lib.project import ROOT as _PROJECT_ROOT, tool_script as _tool_script

from pathlib import Path
import argparse,hashlib,json,re,struct,zipfile,math
from PIL import Image
from lib.iwi import read_iwi_mip0,read_iwi
from lib.retail_model import ModelDecoder,pose_model,skin_vertex,rotate
from lib.retail_material import material_definition
from lib.retail_texture import write_rgba_mips
from lib.retail_lightgrid import LightGridDecoder,BspVisibility
from lib.retail_paths import MAIN,DLL

ROOT=_PROJECT_ROOT
ap=argparse.ArgumentParser();ap.add_argument('map');ap.add_argument('--main',type=Path,default=MAIN);a=ap.parse_args()
assert re.fullmatch(r'mp_[a-z0-9_]+',a.map)
entries={}
for p in sorted(a.main.glob('*.iwd')):
    with zipfile.ZipFile(p) as z:
        for name in z.namelist():
            if name.startswith(('maps/mp/','materials/','images/','xmodel/','xmodelparts/','xmodelsurfs/')):entries[name]=p
def read(name):
    with zipfile.ZipFile(entries[name]) as z:return z.read(name)
raw=read('maps/mp/'+a.map+'.d3dbsp');assert raw[:8]==b'IBSP\x04\0\0\0'
def lump(index,stride=1):
    size,offset=struct.unpack_from('<II',raw,8+8*index)
    assert size%stride==0 and offset+size<=len(raw),(index,size,offset)
    return raw[offset:offset+size]
materials=[lump(0,72)[i:i+64].split(b'\0')[0].decode() for i in range(0,len(lump(0)),72)]
sky_materials={i for i,m in enumerate(materials) if b'\0sky\0' in read('materials/'+m)}
states=[]
for material in materials:
    encoded=read('materials/'+material)
    states.append(material_definition(encoded)['state'])
verts=lump(8,68);indices=struct.unpack('<'+'H'*(len(lump(9))//2),lump(9,2))
soups=list(struct.iter_unpack('<HHIHHI',lump(7,16)))
model=struct.unpack_from('<6f6I',lump(35,48));first,count=model[6:8]
mesh=bytearray();used=set();draws=[]
for material,lightmap,start,vertexcount,indexcount,indexstart in soups[first:first+count]:
    assert material<len(materials) and start+vertexcount<=len(verts)//68
    assert indexcount%3==0 and indexstart+indexcount<=len(indices)
    used.add(material)
    draws.append(dict(start=len(mesh)//72,count=indexcount,state=states[material]))
    for index in indices[indexstart:indexstart+indexcount]:
        assert index<vertexcount
        mesh+=verts[(start+index)*68:(start+index+1)*68]+struct.pack('<I',material|(lightmap<<16)|(0x80000000 if material in sky_materials else 0))
dest=ROOT/'public/maps'/a.map;dest.mkdir(parents=True,exist_ok=True)
entities=[dict(re.findall(r'"([^"\n]+)"\s+"([^"\n]*)"',block)) for block in re.findall(r'\{([^}]*)\}',lump(37).decode('ascii','replace'))]
decoder=ModelDecoder(DLL,read)
lightgrid=LightGridDecoder(DLL,lump(2,8),lump(3,24),BspVisibility(lump))
probes=[]
instances=0
for entity in entities:
    if entity.get('classname')!='misc_model' or not entity.get('model','').startswith('xmodel/'):continue
    asset=decoder.load(entity['model']);transforms=pose_model(asset)
    pitch,yaw,roll=[math.radians(float(x)) for x in entity.get('angles','0 '+entity.get('angle','0')+' 0').split()]
    cp,sp,cy,sy,cr,sr=math.cos(pitch),math.sin(pitch),math.cos(yaw),math.sin(yaw),math.cos(roll),math.sin(roll)
    axes=[[cp*cy,cp*sy,-sp],[sr*sp*cy-cr*sy,sr*sp*sy+cr*cy,sr*cp],[cr*sp*cy+sr*sy,cr*sp*sy-sr*cy,cr*cp]]
    origin=list(map(float,entity.get('origin','0 0 0').split()));scale=float(entity.get('modelscale','1'))
    positions=[];probe_index=len(probes);assert probe_index<0x4000
    def direction(v):return [sum(v[j]*axes[j][i] for j in range(3)) for i in range(3)]
    for surface in asset['surfaces']:
        material=surface['material']
        if material not in materials:
            materials.append(material);states.append(material_definition(read('materials/'+material))['state'])
        layer=materials.index(material);used.add(layer)
        draws.append(dict(start=len(mesh)//72,count=len(surface['indices']),state=states[layer]))
        transformed=[]
        for vertex in surface['vertices']:
            p,n,t,b=skin_vertex(vertex,transforms);p=direction(p);p=[p[i]*scale+origin[i] for i in range(3)]
            positions.append(p)
            transformed.append(struct.pack('<6f4B10fI',*p,*direction(n),255,255,255,255,*vertex['uv'],0,0,*direction(t),*direction(b),layer|((0x4000|probe_index)<<16)))
        for index in surface['indices']:mesh+=transformed[index]
    center=[(min(p[i] for p in positions)+max(p[i] for p in positions))*.5 for i in range(3)]
    probes.append(lightgrid.sample(center));instances+=1
(dest/'world.bin').write_bytes(mesh)
print('Extracted',instances,'model instances from',len(decoder.cache),'unique models')
textures=[]
sky=[]
def decode(data,face=0):
    if data[4] in (6,7):return read_iwi(data)[2]
    fmt,w,h,pixels=read_iwi_mip0(data)
    size=max(1,(w+3)//4)*max(1,(h+3)//4)*(8 if fmt==11 else 16)
    if fmt in (11,12,13):return Image.frombytes('RGBA',(w,h),pixels[face*size:(face+1)*size],'bcn',({11:1,12:2,13:3}[fmt],{11:'DXT1',12:'DXT3',13:'DXT5'}[fmt]))
    return read_iwi(data)[2]
for index,material in enumerate(materials):
    if index not in used: textures.append(None);continue
    encoded=read('materials/'+material)
    definition=material_definition(encoded);bindings=definition['bindings']
    images=[binding['image'] for binding in bindings.values()]
    image_name=bindings.get('colorMap',{}).get('image')
    if image_name is None: textures.append(None);continue
    data=read('images/'+image_name+'.iwi')
    try:
        image=decode(data)
        image.resize((512,512),Image.Resampling.LANCZOS).save(dest/f'{index}.png')
        entry=dict(file=f'{index}.png',material=material,image=image_name,bindings=bindings,technique=definition['technique'],sha256=hashlib.sha256(data).hexdigest())
        write_rgba_mips(image,dest/f'{index}.rgba');entry['rgba']=f'{index}.rgba'
        normal=bindings.get('normalMap',{}).get('image')
        if normal:
            normal_data=read('images/'+normal+'.iwi');normal_image=decode(normal_data)
            if normal_data[4]==13:
                r,g,b,alpha=normal_image.split();normal_image=Image.merge('RGBA',(alpha,g,b,Image.new('L',normal_image.size,255)))
            normal_image.resize((512,512),Image.Resampling.LANCZOS).save(dest/f'{index}_normal.png');entry['normal']=f'{index}_normal.png'
            write_rgba_mips(normal_image,dest/f'{index}_normal.rgba');entry['normal_rgba']=f'{index}_normal.rgba'
        if index in sky_materials:
            assert data[5]&4,'Sky colorMap is not a cubemap'
            for face in range(6):
                name=f'sky_{face}.png';decode(data,face).resize((512,512),Image.Resampling.LANCZOS).save(dest/name);sky.append(name)
        textures.append(entry)
    except ValueError as error:
        raise ValueError(f'Unable to decode material {material}: {image_name}') from error
lm=lump(1,0x400000);lightmaps=[];sunmaps=[]
for block in range(len(lm)//0x400000):
    for channel in range(3):
        offset=block*0x400000+channel*0x100000;name=f'lightmap_{block}_{channel}.png'
        Image.frombytes('RGBA',(512,512),lm[offset:offset+0x100000],'raw','BGRA').save(dest/name);lightmaps.append(name)
    offset=block*0x400000+0x300000;name=f'sunlight_{block}.png'
    Image.frombytes('L',(1024,1024),lm[offset:offset+0x100000]).convert('RGBA').save(dest/name);sunmaps.append(name)
entities=[dict(re.findall(r'"([^"\n]+)"\s+"([^"\n]*)"',block)) for block in re.findall(r'\{([^}]*)\}',lump(37).decode('ascii','replace'))]
script=read('maps/mp/'+a.map+'.gsc').decode('ascii','replace');world=entities[0]
nationalities=dict(re.findall(r'game\["(allies|axis)"\]\s*=\s*"([^"]+)"',script))
# CMod_LoadBrushes 0x417070: <HH> brushes, six axial <float,material>
# sides followed by <plane index,material>; materials carry contents at +68.
planes=list(struct.iter_unpack('<4f',lump(4,16)))
sides=lump(5,8);cursor=0;collision=[];mantle=[]
for index,(sidecount,material) in enumerate(struct.iter_unpack('<HH',lump(6,4))):
    assert sidecount>=6 and material<len(lump(0,72))//72
    bounds=[struct.unpack_from('<f',sides,cursor+axis*8)[0] for axis in range(6)]
    brushplanes=[]
    for axis in range(3):
        normal=[0,0,0];normal[axis]=-1;brushplanes.append(normal+[-bounds[axis*2]])
        normal=[0,0,0];normal[axis]=1;brushplanes.append(normal+[bounds[axis*2+1]])
    for side in range(6,sidecount):
        plane=struct.unpack_from('<I',sides,cursor+side*8)[0]
        assert plane<len(planes);brushplanes.append(list(planes[plane]))
    contents=struct.unpack_from('<I',lump(0,72),material*72+68)[0]&0xdffffffb
    if model[10]<=index<model[10]+model[11] and contents&0x1010001:
        flags=[struct.unpack_from('<I',lump(0,72),struct.unpack_from('<I',sides,cursor+side*8+4)[0]*72+64)[0] for side in range(sidecount)]
        brush=dict(bounds=bounds,planes=brushplanes,contents=contents,surfaceFlags=flags)
        if contents&0x10001:collision.append(brush)
        if contents&0x1000000:mantle.append(brush)
    cursor+=sidecount*8
assert cursor==len(sides)
# Native collision vertices (0x4176c0) skip the first word of each 16-byte
# disk record. Triangle loader 0x417aa0 retains plane/barycentric/indices.
collision_vertices=[list(v[1:]) for v in struct.iter_unpack('<4f',lump(29,16))]
from lib.collision_materials import triangle_materials
triangle_surfaces=triangle_materials(raw)
for triangle_index,triangle in enumerate(struct.iter_unpack('<12f6I',lump(31,72))):
    def cross(a,b):return [a[1]*b[2]-a[2]*b[1],a[2]*b[0]-a[0]*b[2],a[0]*b[1]-a[1]*b[0]]
    n,s,t=triangle[:3],triangle[4:7],triangle[8:11]
    st,tn,ns=cross(s,t),cross(t,n),cross(n,s)
    determinant=sum(n[i]*st[i] for i in range(3));assert abs(determinant)>1e-15
    points=[]
    for index,(u,v) in zip(triangle[12:15],[(0,0),(1,0),(0,1)]):
        # -1 means the vertex feature is omitted, not that the triangle is absent.
        point=[(triangle[3]*st[i]+(triangle[7]+u)*tn[i]+(triangle[11]+v)*ns[i])/determinant for i in range(3)]
        points.append(collision_vertices[index] if index!=0xffffffff else point)
    normal=list(triangle[:3]);distance=triangle[3]
    assert all(abs(sum(p[i]*normal[i] for i in range(3))-distance)<.2 for p in points)
    brushplanes=[normal+[distance],[-x for x in normal]+[-distance+.25]]
    for edge in range(3):
        p,q,other=points[edge],points[(edge+1)%3],points[(edge+2)%3]
        v=[q[i]-p[i] for i in range(3)]
        n=[v[1]*normal[2]-v[2]*normal[1],v[2]*normal[0]-v[0]*normal[2],v[0]*normal[1]-v[1]*normal[0]]
        length=math.sqrt(sum(x*x for x in n))
        if length<1e-6:break
        n=[x/length for x in n];d=sum(n[i]*p[i] for i in range(3))
        if sum(n[i]*other[i] for i in range(3))>d:n=[-x for x in n];d=-d
        brushplanes.append(n+[d])
    if len(brushplanes)==5:
        # A box sweep also requires each prism-edge x box-axis supporting plane.
        # Omitting these produces false vertical walls at terrain triangle seams.
        from lib.collision_bevels import complete_bevels
        brushplanes=complete_bevels(brushplanes)
        flags,contents=triangle_surfaces.get(triangle_index,(0,0))
        collision.append(dict(bounds=[x for axis in range(3) for x in (min(p[axis] for p in points)-.25,max(p[axis] for p in points)+.25)],planes=brushplanes,contents=contents,triangle=points,surfaceFlags=[flags]))
angles=[math.radians(float(x)) for x in world.get('sundirection','-45 0 0').split()]
direction=[-math.cos(angles[0])*math.cos(angles[1]),-math.cos(angles[0])*math.sin(angles[1]),math.sin(angles[0])]
direction=[-x for x in direction] if direction[2]<0 else direction
suncolor=[float(x)*float(world.get('sunlight','1')) for x in world.get('suncolor','1 1 1').split()]
fog=re.search(r'setExpFog\(([^)]+)\)',script);fogvalues=[float(x.strip()) for x in fog[1].split(',')] if fog else [0,0,0,0]
manifest=dict(name=a.map,source_sha256=hashlib.sha256(raw).hexdigest(),vertices=len(mesh)//72,vertex_stride=72,world='world.bin',textures=textures,lightmaps=lightmaps,sunmaps=sunmaps,sky=sky,sun={'direction':direction,'color':suncolor},fog=fogvalues[:4],nationalities=nationalities,entities=entities,bounds=list(model[:6]),limitations=['Static BSP mesh only; xmodels/effects/collision/game VM not yet exported.','Diffuse selection is a material-string hypothesis; full native material stages are not reconstructed.'])
(dest/'manifest.json').write_text(json.dumps(manifest,separators=(',',':'))+'\n')
manifest['collision']=collision
manifest['mantle']=mantle
manifest['probes']=probes
manifest['draws']=sorted(draws,key=lambda draw:draw['state']['sort'])
(dest/'manifest.json').write_text(json.dumps(manifest,separators=(',',':'))+'\n')
print('Extracted',a.map,manifest['vertices']//3,'triangles',sum(t is not None for t in textures),'material images',len(entities),'entities')
