"""Preserve native triangle vertices for capsule contact instead of closed prisms."""

# Locate shared tools from both the checkout and the browser's virtual filesystem.
import sys as _tool_sys
from pathlib import Path as _ToolPath
_tool_sys.path.insert(0, str(next(p for p in _ToolPath(__file__).resolve().parents
                                    if (p / 'lib/project.py').is_file())))
from lib.project import ROOT as _PROJECT_ROOT, tool_script as _tool_script
from lib.retail_paths import MAIN

from pathlib import Path
import hashlib,json,struct,sys,zipfile
root=_PROJECT_ROOT;target=root/'public/maps'/sys.argv[1]/'manifest.json';m=json.loads(target.read_text())
raw=None
for archive in sorted(MAIN.glob('*.iwd')):
 with zipfile.ZipFile(archive) as z:
  name='maps/mp/'+m['name']+'.d3dbsp'
  if name in z.namelist():raw=z.read(name)
assert raw and hashlib.sha256(raw).hexdigest()==m['source_sha256']
def lump(n):size,offset=struct.unpack_from('<II',raw,8+n*8);return raw[offset:offset+size]
vertices=[list(v[1:]) for v in struct.iter_unpack('<4f',lump(29))]
proxies=[b for b in m['collision'] if 'triangle' in b or 'surfaceFlags' not in b];count=0
from lib.collision_materials import triangle_materials
triangle_surfaces=triangle_materials(raw)
def cross(a,b):return [a[1]*b[2]-a[2]*b[1],a[2]*b[0]-a[0]*b[2],a[0]*b[1]-a[1]*b[0]]
for triangle_index,t in enumerate(struct.iter_unpack('<12f6I',lump(31))):
 n,s,v=t[:3],t[4:7],t[8:11];sv,vn,ns=cross(s,v),cross(v,n),cross(n,s);det=sum(n[i]*sv[i] for i in range(3));points=[]
 for index,(u,w) in zip(t[12:15],[(0,0),(1,0),(0,1)]):
  points.append(vertices[index] if index!=0xffffffff else [(t[3]*sv[i]+(t[7]+u)*vn[i]+(t[11]+w)*ns[i])/det for i in range(3)])
 if any(sum(x*x for x in cross([points[(i+1)%3][j]-points[i][j] for j in range(3)],n))<1e-12 for i in range(3)):continue
 b=proxies[count];assert all(abs(b['planes'][0][i]-t[i])<1e-5 for i in range(4));b['triangle']=points;flags,contents=triangle_surfaces.get(triangle_index,(0,0));b['surfaceFlags']=[flags];b['contents']=contents;count+=1
assert count==len(proxies)
m['collision_adapter']='capsule-triangle-distance-v1';temporary=target.with_suffix('.json.tmp');temporary.write_text(json.dumps(m,separators=(',',':'))+'\n');temporary.replace(target)
print('Preserved',count,'native collision triangles')
print('Material coverage',len(triangle_surfaces),'of',len(lump(31))//72,'triangles; unreferenced triangles have no collision contents')
