from pathlib import Path
import gzip
import hashlib
import io
import json
import zipfile
import numpy as np
from scipy import ndimage
import trimesh

ROOT=Path(__file__).resolve().parents[1]
OUT=ROOT/'web/public/ultrasound/anatomical-phantom'
PITCH=4.0
FLIP=np.array([-1.,-1.,1.])


def obj(archive,filename):
    name=next(n for n in archive.namelist() if n.endswith('/'+filename+'.obj'))
    mesh=trimesh.load(io.BytesIO(archive.read(name)),file_type='obj',process=False,force='mesh')
    if not isinstance(mesh,trimesh.Trimesh):raise TypeError('Expected a single anatomy mesh')
    mesh.vertices*=FLIP
    return mesh


def main():
    OUT.mkdir(parents=True,exist_ok=True)
    with zipfile.ZipFile(ROOT/'data/bodyparts3d/isa.zip') as archive:
        skin=obj(archive,'FJ2810')
        organs={1:obj(archive,'FJ2561'),2:obj(archive,'FJ3147'),3:obj(archive,'FJ3145'),6:obj(archive,'FJ2564')}
    assert organs[2].centroid[0]>0 and organs[3].centroid[0]<0,'Verify patient R/L before exporting'
    origin=np.floor(skin.bounds[0]/PITCH)*PITCH-2*PITCH
    dims=np.ceil((skin.bounds[1]-origin)/PITCH).astype(int)+3
    labels=np.zeros(tuple(dims),np.uint8)

    def paint(mesh,label):
        voxels=mesh.voxelized(PITCH).fill()
        ijk=np.rint((voxels.points-origin)/PITCH).astype(int)
        valid=np.all((ijk>=0)&(ijk<dims),axis=1);ijk=ijk[valid]
        labels[ijk[:,0],ijk[:,1],ijk[:,2]]=label
        print('voxelized',label,'points',len(ijk),flush=True)

    paint(skin,10)
    shell=labels>0
    body=np.zeros_like(shell)
    for z in range(dims[2]):
        body[:,:,z]=np.asarray(ndimage.binary_fill_holes(ndimage.binary_closing(shell[:,:,z],iterations=2)),dtype=bool)
    body|=shell
    labels[body]=10
    for label,mesh in organs.items():paint(mesh,label)
    raw=gzip.decompress((ROOT/'web/public/atlas/bones.mesh').read_bytes())
    points=np.frombuffer(raw,dtype='<f4').reshape(-1,3).astype(float)*FLIP
    bones=trimesh.Trimesh(vertices=points,faces=np.arange(len(points)).reshape(-1,3),process=True)
    paint(bones,11)
    labels[~body]=0
    material=labels.tobytes(order='F')
    (OUT/'materials.mesh').write_bytes(gzip.compress(material,mtime=0))
    triangles=np.asarray(skin.triangles,dtype='<f4').reshape(-1,3)
    (OUT/'skin.mesh').write_bytes(gzip.compress(triangles.tobytes(),mtime=0))
    counts={str(k):int(v) for k,v in zip(*np.unique(labels,return_counts=True))}
    print('material counts',counts,flush=True)
    meta={
        'id':'bodyparts3d-acoustic-phantom','title':'실제 해부 메시 기반 전신 인체 팬텀',
        'sourceKind':'anatomical_material_phantom','source':'BodyParts3D / DBCLS 4.0',
        'sourceUrl':'https://dbarchive.biosciencedbc.jp/en/bodyparts3d/download.html',
        'dims':dims.tolist(),'spacing':[PITCH]*3,'origin':origin.tolist(),
        'direction':[1,0,0,0,1,0,0,0,1],
        'coordinateTransform':'Native mesh coordinates -> patient RAS by (-x,-y,z); kidney laterality checked',
        'file':'materials.mesh','skin':'skin.mesh','skinVertices':len(triangles),
        'sha256':hashlib.sha256(material).hexdigest(),
        'materials':{'0':'air','10':'generic soft tissue','11':'bone','1':'spleen','2':'right kidney','3':'left kidney','6':'stomach'},
        'limitations':'4mm material voxels, no acquired HU or ultrasound. No complete liver/lung/vessels/muscle differentiation. No deformation.',
        'counts':counts,
    }
    assert all(counts.get(str(k),0)>1000 for k in [1,2,3,6,10,11])
    (OUT/'case.json').write_text(json.dumps(meta,ensure_ascii=False,indent=2))
    (OUT/'ATTRIBUTION.txt').write_text((ROOT/'web/public/atlas/ATTRIBUTION.txt').read_text()+'\nDerived acoustic phantom: skin and four organ meshes voxelized at 4mm; bones voxelized; native coordinates flipped (-x,-y,z), laterality checked. Material labels are illustrative, not measured tissue properties. Skin triangles preserved.\n')
    print(json.dumps(meta,ensure_ascii=False,indent=2))


if __name__=='__main__':main()
