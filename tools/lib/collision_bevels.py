"""Complete convex-prism/AABB SAT axes missing from the triangle proxy adapter.

This is geometry for the port's box adapter, not native capsule reconstruction.
"""

# Locate shared tools from both the checkout and the browser's virtual filesystem.
import sys as _tool_sys
from pathlib import Path as _ToolPath
_tool_sys.path.insert(0, str(next(p for p in _ToolPath(__file__).resolve().parents
                                    if (p / 'lib/project.py').is_file())))
from lib.project import ROOT as _PROJECT_ROOT, tool_script as _tool_script

import itertools
import numpy as np

def complete_bevels(planes):
    a=np.array(planes,dtype=float);vertices=[];active=[]
    for ids in itertools.combinations(range(len(a)),3):
        matrix=a[list(ids),:3]
        if abs(np.linalg.det(matrix))<1e-9:continue
        point=np.linalg.solve(matrix,a[list(ids),3])
        distances=a[:,:3]@point-a[:,3]
        if max(distances)>1e-5 or any(np.linalg.norm(point-v)<1e-5 for v in vertices):continue
        vertices.append(point);active.append(set(np.where(abs(distances)<1e-5)[0]))
    assert len(vertices)==6,('expected triangular prism',len(vertices))
    result=[list(p) for p in planes]
    for i,j in itertools.combinations(range(len(vertices)),2):
        if len(active[i]&active[j])<2:continue
        edge=vertices[j]-vertices[i]
        for axis in np.eye(3):
            normal=np.cross(edge,axis);length=np.linalg.norm(normal)
            if length<1e-8:continue
            for sign in [-1,1]:
                n=sign*normal/length;d=max(np.dot(n,v) for v in vertices)
                if sum(abs(np.dot(n,v)-d)<1e-5 for v in vertices)<2:continue
                if any(np.linalg.norm(n-np.array(p[:3]))<1e-6 and abs(d-p[3])<1e-4 for p in result):continue
                result.append([*n.tolist(),float(d)])
    return result
