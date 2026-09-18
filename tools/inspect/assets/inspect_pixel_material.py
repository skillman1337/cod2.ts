"""Find world surfaces beneath a recorded browser pixel for material diagnosis."""

# Locate shared tools from both the checkout and the browser's virtual filesystem.
import sys as _tool_sys
from pathlib import Path as _ToolPath
_tool_sys.path.insert(0, str(next(p for p in _ToolPath(__file__).resolve().parents
                                    if (p / 'lib/project.py').is_file())))
from lib.project import ROOT as _PROJECT_ROOT, tool_script as _tool_script

from pathlib import Path
import json,sys,numpy as np,math
root=Path('public/maps/mp_toujane');m=json.loads((root/'manifest.json').read_text());camera=json.loads(Path(sys.argv[3] if len(sys.argv)>3 else 'artifacts/retail-menu-evidence/playing-camera.json').read_text())
raw=(root/m['world']).read_bytes();v=np.frombuffer(raw,dtype='<f4').reshape(-1,18);p=v[:,:3].reshape(-1,3,3).astype('float64')
x,y=map(float,sys.argv[1:3]);w,h=map(int,sys.argv[4:6]) if len(sys.argv)>5 else (1920,920);scale=1/(math.tan(80*math.pi/360)*.75)
axis=np.array(camera['viewaxis']);origin=np.array(camera['vieworg']);ray=axis[0]+axis[1]*((x/w*2-1)*w/h/scale)+axis[2]*((1-y/h*2)/scale);ray/=np.linalg.norm(ray)
a=p[:,1]-p[:,0];b=p[:,2]-p[:,0];cross=np.cross(ray,b);det=np.einsum('ij,ij->i',a,cross);valid=np.abs(det)>1e-8;inv=np.divide(1,det,out=np.zeros_like(det),where=valid)
t=origin-p[:,0];u=np.einsum('ij,ij->i',t,cross)*inv;q=np.cross(t,a);vv=q@ray*inv;distance=np.einsum('ij,ij->i',b,q)*inv
hits=np.nonzero(valid&(u>=0)&(vv>=0)&(u+vv<=1)&(distance>0))[0];hits=sorted(hits,key=lambda i:distance[i])
for i in hits[:14]:
    vertex=v[i*3:(i+1)*3];material=np.frombuffer(raw,dtype='<u4')[i*54+17]&65535;entry=m['textures'][material]
    weights=np.array([1-u[i]-vv[i],u[i],vv[i]])
    colors=np.frombuffer(raw,dtype='u1').reshape(-1,72)[i*3:(i+1)*3,24:28]
    print(round(distance[i],5),i,entry['material'],entry['technique'],'uv',weights@vertex[:,7:9],'color',weights@colors,'normals',vertex[:,3:6].tolist())
