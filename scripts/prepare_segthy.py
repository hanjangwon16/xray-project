import io
import gzip
import hashlib
import json
from pathlib import Path
import struct
import urllib.request
import zipfile
import numpy as np
from scipy.ndimage import gaussian_filter
from skimage.measure import marching_cubes
import trimesh

URL = 'https://www.campar.in.tum.de/public_datasets/2022_plosone_eilers/US_data.zip'


class RemoteZip(io.RawIOBase):
    def __init__(self):
        self.position = 0
        with urllib.request.urlopen(urllib.request.Request(URL, method='HEAD')) as r:
            self.size = int(r.headers['Content-Length'])

    def seek(self, offset, whence=0):
        self.position = offset + (self.position if whence == 1 else self.size if whence == 2 else 0)
        return self.position

    def tell(self):
        return self.position

    def read(self, count=-1):
        count = min(self.size-self.position, count if count >= 0 else self.size)
        if count <= 0:
            return b''
        if count > 100_000_000:
            raise ValueError('Refusing an unbounded archive download')
        request = urllib.request.Request(URL, headers={'Range': f'bytes={self.position}-{self.position+count-1}'})
        with urllib.request.urlopen(request, timeout=90) as r:
            if r.status != 206:
                raise ValueError('Server did not honor the bounded range request')
            data = r.read(count+1)
        assert len(data) == count
        self.position += count
        return data


if __name__ == '__main__':
    folder = Path(__file__).resolve().parents[1] / 'data/sources/segthy'
    folder.mkdir(parents=True, exist_ok=True)
    with zipfile.ZipFile(RemoteZip()) as archive:
        members = ['US_volunteer_dataset/Readme.txt',
                   'US_volunteer_dataset/ground_truth_data/US/001_P1_1_left_US.nii',
                   'US_volunteer_dataset/ground_truth_data/US_thyroid_label/001_P1_1_left.nii']
        expected = ['3704e4b782df5634a45dad554bc83a52ea70cf357103411b70518ded509f9474',
                    'a121ae56daad64b91183190faa08dc53fa71a27608e41919034076fc4538b293',
                    'a77aa43696526e6167445ddbc72a99d300390c99f312740e4a673b1072e6cf87']
        records = []
        for member, checksum in zip(members, expected):
            target = folder / Path(member).name
            if not target.exists():
                target.write_bytes(archive.read(member))
            raw = target.read_bytes()
            assert hashlib.sha256(raw).hexdigest() == checksum, 'Original source changed or local cache is damaged'
            records.append({'member': member, 'bytes': len(raw), 'sha256': hashlib.sha256(raw).hexdigest()})
        (folder/'source.json').write_text(json.dumps({'url': URL, 'assets': records}, indent=2))
    for target in folder.glob('*.nii'):
        header = target.read_bytes()[:352]
        print(target.name, 'dims', struct.unpack_from('<8h', header, 40), 'type', struct.unpack_from('<2h', header, 70), 'spacing', struct.unpack_from('<8f', header, 76), 'offset', struct.unpack_from('<f', header, 108))
    def load(name):
        raw = (folder/name).read_bytes()
        assert struct.unpack_from('<i', raw)[0] == 348
        assert struct.unpack_from('<2h', raw, 70) == (2, 8)
        dims = struct.unpack_from('<3h', raw, 42)
        offset = int(struct.unpack_from('<f', raw, 108)[0])
        assert len(raw)-offset == int(np.prod(dims))
        assert struct.unpack_from('<f', raw, 112)[0] in (0, 1)
        return raw[:352], np.frombuffer(raw, dtype=np.uint8, offset=offset).reshape(dims[::-1])
    header, image = load('001_P1_1_left_US.nii')
    mask_header, mask = load('001_P1_1_left.nii')
    assert header[40:108] == mask_header[40:108] and header[252:328] == mask_header[252:328]
    assert set(np.unique(mask)) == {0, 1, 2, 3}
    output = folder.parents[2]/'web/public/ultrasound/segthy'
    output.mkdir(parents=True, exist_ok=True)
    assets = {}
    for filename, array in [('volume.bin', image), ('labels.bin', mask)]:
        raw = array[::2, ::2, ::2].copy().tobytes()
        (output/(filename+'.mesh')).write_bytes(gzip.compress(raw, mtime=0))
        assets[filename] = hashlib.sha256(raw).hexdigest()
    spacing = list(struct.unpack_from('<3f', header, 80))
    dims = list(image[::2, ::2, ::2].shape[::-1])
    surfaces, chunks, offset = [], [], 0
    coarse_spacing = np.array(spacing[::-1])*6
    for label in [0, 1, 2, 3]:
        occupancy = (image[::6, ::6, ::6]>0) if label == 0 else (mask[::6, ::6, ::6] == label)
        field = gaussian_filter(np.pad(occupancy.astype(np.float32), 2), .7)
        vertices, faces, _, _ = marching_cubes(field, .5, spacing=coarse_spacing)
        vertices = (vertices-coarse_spacing*2)[:, ::-1]
        mesh = trimesh.Trimesh(vertices=vertices, faces=faces, process=True)
        mesh.fix_normals()
        trimesh.smoothing.filter_laplacian(mesh, lamb=.3, iterations=4, volume_constraint=True)
        if label == 0:
            mesh = mesh.convex_hull
        entry: dict[str, int | float] = {'id': label, 'vertices': len(mesh.vertices), 'triangles': len(mesh.faces), 'offset': offset}
        if label:
            source_points = np.argwhere(mask == label)[:, ::-1]*np.array(spacing)
            bbox_error = float(np.max(np.abs(mesh.bounds-np.array([source_points.min(axis=0), source_points.max(axis=0)]))))
            ratio = float(abs(mesh.volume)/(len(source_points)*np.prod(spacing)))
            assert .95 < ratio < 1.05, (label, ratio)
            assert bbox_error < 1, (label, bbox_error)
            entry.update(volumeRatio=ratio, maxBoundsChangeMm=bbox_error)
        polygons = np.column_stack([np.full(len(mesh.faces), 3), mesh.faces]).astype('<u4')
        chunk = mesh.vertices.astype('<f4').tobytes()+mesh.vertex_normals.astype('<f4').tobytes()+polygons.tobytes()
        chunks.append(chunk)
        entry['bytes'] = len(chunk)
        offset += len(chunk)
        surfaces.append(entry)
    surface_raw = b''.join(chunks)
    (output/'surfaces.bin.mesh').write_bytes(gzip.compress(surface_raw, mtime=0))
    metadata = {'id': 'segthy-001-left', 'dims': dims, 'spacing': [x*2 for x in spacing], 'origin': [0, 0, 0],
                'coordinateSystem': 'Native reconstruction voxel axes in mm, local origin; not registered to the whole-body atlas',
                'nativeSform': list(struct.unpack_from('<12f', header, 280)),
                'nativeQformCode': struct.unpack_from('<h', header, 252)[0],
                'nativeSformCode': struct.unpack_from('<h', header, 254)[0],
                'file': 'volume.bin.mesh', 'labels': 'labels.bin.mesh', 'sha256': assets,
                'surfaceFile': 'surfaces.bin.mesh', 'surfaces': surfaces, 'surfaceSha256': hashlib.sha256(surface_raw).hexdigest(),
                'surfaceChanges': 'Display only: 0.72mm grid, Gaussian sigma 0.504mm, four volume-constrained Laplacian passes. Capture support uses a convex hull for picking, not anatomical skin. Original signal and label voxels unchanged.',
                'changes': 'Every second original voxel retained in each axis, spacing doubled, local origin. No generated acoustic texture.',
                'source': URL, 'sourceAssets': records, 'license': 'CC BY, version unspecified by original publisher; commercial use explicitly permitted',
                'labelMap': {'1': '갑상선 · 왼쪽 엽', '2': '혈관 분할 #2', '3': '혈관 분할 #3'}, 'originalDims': list(image.shape[::-1])}
    (output/'case.json').write_text(json.dumps(metadata, ensure_ascii=False, indent=2))
    (output/'LICENSE.txt').write_text('\n'.join(line.rstrip() for line in (folder/'Readme.txt').read_text().splitlines()).rstrip()+'\n')
    print(json.dumps({'dims': dims, 'labels': int(np.count_nonzero(mask[::2,::2,::2])), 'source': records}, indent=2))
