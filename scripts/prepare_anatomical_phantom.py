from pathlib import Path
import gzip
import hashlib
import io
import json
import zipfile
import numpy as np
from scipy import ndimage
import trimesh
from skimage import measure

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
        liver=[obj(archive,f'FJ{n}') for n in [1858,2409,2816,2818,2819,2820,2821,2822,2823,2824]]
        organs={1:obj(archive,'FJ2561'),2:obj(archive,'FJ3147'),3:obj(archive,'FJ3145'),6:obj(archive,'FJ2564'),
                5:trimesh.util.concatenate(liver),
                7:obj(archive,'FJ1895'),8:obj(archive,'FJ2817'),9:obj(archive,'FJ3149')}
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
    for label,mesh in organs.items():
        for part in liver if label==5 else [mesh]:paint(part,label)
    raw=gzip.decompress((ROOT/'web/public/atlas/bones.mesh').read_bytes())
    points=np.frombuffer(raw,dtype='<f4').reshape(-1,3).astype(float)*FLIP
    bones=trimesh.Trimesh(vertices=points,faces=np.arange(len(points)).reshape(-1,3),process=True)
    paint(bones,11)
    labels[~body]=0
    material=labels.tobytes(order='F')
    (OUT/'materials.mesh').write_bytes(gzip.compress(material,mtime=0))
    triangles=np.asarray(skin.triangles,dtype='<f4').reshape(-1,3)
    (OUT/'skin.mesh').write_bytes(gzip.compress(triangles.tobytes(),mtime=0))
    surface_data=bytearray();surfaces=[]
    for label in [0,11,*organs]:
        mask=body if label==0 else labels==label
        values=ndimage.gaussian_filter(np.pad(mask.astype(np.float32),1),.65)
        vertices,faces,_,_=measure.marching_cubes(values,.5,spacing=(PITCH,)*3)
        vertices+=origin-PITCH
        mesh=trimesh.Trimesh(vertices=vertices,faces=faces,process=True)
        if label==0:
            cells=np.rint(mesh.vertices/12).astype(int)
            unique,inverse=np.unique(cells,axis=0,return_inverse=True)
            points=np.zeros((len(unique),3));np.add.at(points,inverse,mesh.vertices)
            points/=np.bincount(inverse)[:,None]
            mesh=trimesh.Trimesh(vertices=points,faces=inverse[mesh.faces],process=True)
            mesh.update_faces(mesh.nondegenerate_faces());mesh.remove_unreferenced_vertices()
        mesh.fix_normals()
        points=np.asarray(mesh.vertices,dtype='<f4');normals=np.asarray(mesh.vertex_normals,dtype='<f4')
        polys=np.column_stack([np.full(len(mesh.faces),3),mesh.faces]).astype('<u4')
        raw=points.tobytes()+normals.tobytes()+polys.tobytes()
        surfaces.append({'id':label,'vertices':len(points),'triangles':len(mesh.faces),'offset':len(surface_data),'bytes':len(raw)})
        surface_data.extend(raw)
    (OUT/'surfaces.mesh').write_bytes(gzip.compress(surface_data,mtime=0))
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
        'surfaceFile':'surfaces.mesh','surfaces':surfaces,'surfaceSha256':hashlib.sha256(surface_data).hexdigest(),
        'sha256':hashlib.sha256(material).hexdigest(),
        'materials':{'0':'air','10':'generic soft tissue','11':'bone','1':'spleen','2':'right kidney','3':'left kidney','5':'liver','6':'stomach','7':'pancreas','8':'gallbladder','9':'urinary bladder'},
        'limitations':'4mm material voxels, no acquired HU or ultrasound. No lung/vessels/muscle differentiation. No deformation. Display surfaces smoothed; skin reduced to 12mm clusters for picking.',
        'counts':counts,
    }
    assert all(counts.get(str(k),0)>20 for k in organs)
    (OUT/'case.json').write_text(json.dumps(meta,ensure_ascii=False,indent=2))
    (OUT/'ATTRIBUTION.txt').write_text((ROOT/'web/public/atlas/ATTRIBUTION.txt').read_text()+'\nDerived acoustic phantom: skin, eight organs and bones voxelized at 4mm. Liver assembled from source segments. Coordinates flipped (-x,-y,z), kidney laterality checked. Display surfaces smoothed; skin clustered at 12mm for picking. Materials are illustrative, not measured tissue properties.\n')
    print(json.dumps(meta,ensure_ascii=False,indent=2))


if __name__=='__main__':main()
