"""Prepare bounded, attributed teaching assets; never publish source archives."""

import csv
import hashlib
import io
import json
from pathlib import Path
import zipfile
import zlib

ROOT = Path(__file__).resolve().parents[1]
SOURCES = ROOT / 'data/sources'
PUBLIC = ROOT / 'web/public'


def write_json(path, value):
    path.parent.mkdir(parents=True, exist_ok=True)
    path.write_text(json.dumps(value, ensure_ascii=False, indent=2))


def main():
    src = SOURCES / 'pluslibdata/TestImages/SpinePhantomFreehandReconstructed.mha'
    header, payload = src.read_bytes().split(b'ElementDataFile = LOCAL', 1)
    values = dict(line.split(' = ', 1) for line in header.decode().splitlines() if ' = ' in line)
    dims = [int(v) for v in values['DimSize'].split()]
    assert values['ElementType'] == 'MET_UCHAR' and values['CompressedData'] == 'True'
    raw = zlib.decompress(payload.lstrip(b'\r\n'))
    assert len(raw) == dims[0] * dims[1] * dims[2]
    folder = PUBLIC / 'ultrasound/plus-phantom'
    folder.mkdir(parents=True, exist_ok=True)
    (folder / 'volume_u8.bin').write_bytes(raw)
    assert (folder / 'volume_u8.bin').read_bytes() == raw
    write_json(folder / 'case.json', {
        'id': 'plus-phantom', 'title': 'PLUS 척추 팬텀 · 실측 3D 초음파',
        'dims': dims, 'spacing': [float(v) for v in values['ElementSpacing'].split()],
        'origin': [float(v) for v in values['Offset'].split()],
        'direction': [float(v) for v in values['TransformMatrix'].split()],
        'coordinateSystem': 'PLUS phantom native physical coordinates; not patient RAS',
        'dtype': 'uint8', 'file': 'volume_u8.bin', 'sha256': hashlib.sha256(raw).hexdigest(),
        'source': 'https://github.com/PlusToolkit/PlusLibData/blob/51dcbb76d9f29fad94cf80788a7a0b7c704fb5dc/TestImages/SpinePhantomFreehandReconstructed.mha',
        'license': 'BSD-3-Clause', 'changes': 'Lossless MHA decompression, native x-fastest voxel order retained',
    })
    (folder / 'LICENSE.txt').write_bytes((SOURCES / 'pluslibdata/LICENSE').read_bytes())

    folder = PUBLIC / 'learning'
    folder.mkdir(exist_ok=True)
    cases = []
    with zipfile.ZipFile(SOURCES / 'fracatlas/FracAtlas.zip') as archive:
        rows = list(csv.DictReader(io.StringIO(archive.read('FracAtlas/dataset.csv').decode('utf-8-sig'))))
        excluded = {'IMG0003375.jpg', 'IMG0003376.jpg'}
        selected = []
        for region in ['hand', 'leg', 'hip', 'shoulder']:
            for fractured in ['0', '1']:
                row = next(r for r in rows if r[region] == '1' and r['fractured'] == fractured and r['image_id'] not in excluded)
                if row not in selected:
                    selected.append(row)
        regions = {'hand': '상지', 'leg': '하지', 'hip': '골반·고관절', 'shoulder': '어깨'}
        reviewed_regions = {'IMG0000006.jpg':'팔꿈치·전완','IMG0000019.jpg':'발·발목','IMG0000000.jpg':'무릎·하퇴','IMG0000092.jpg':'하퇴','IMG0000041.jpg':'골반·고관절','IMG0000453.jpg':'고관절·대퇴','IMG0000011.jpg':'상완·팔꿈치','IMG0000044.jpg':'상완·팔꿈치'}
        for row in selected:
            name = row['image_id']
            member = next(n for n in archive.namelist() if n.endswith('/' + name) and '/images/' in n)
            file = 'xray-' + name
            (folder / file).write_bytes(archive.read(member))
            cases.append({
                'id': file, 'modality': 'xray', 'image': file,
                'title': reviewed_regions[name],
                'view': '원자료 방향 표기: ' + (' / '.join(ko for k, ko in [('frontal', '정면'), ('lateral', '측면'), ('oblique', '사위')] if row[k] == '1') or '미기록'),
                'note': '부위명은 영상 외형 검토로 보정. 원자료 부위: ' + ' · '.join(regions[k] for k in regions if row[k] == '1') + ' / 골절 표기: ' + ('있음' if row['fractured'] == '1' else '없음') + ' · 개별 임상 검수 전 표본',
                'source': 'https://figshare.com/articles/dataset/22363012',
                'citation': 'Abedeen et al., FracAtlas, Scientific Data 10, 521 (2023)',
                'license': 'CC BY 4.0', 'changes': 'Original image, no pixel modifications',
            })
    with zipfile.ZipFile(SOURCES / 'busbra/BUSBRA.zip') as archive:
        names = sorted(n for n in archive.namelist() if '/Images/' in n and n.endswith('.png'))[:6]
        for i, member in enumerate(names):
            file = f'ultrasound-{i + 1}.png'
            mask = f'ultrasound-{i + 1}-mask.png'
            (folder / file).write_bytes(archive.read(member))
            mask_member = member.replace('/Images/', '/Masks/').replace('/bus_', '/mask_')
            if mask_member not in archive.namelist():
                # BUS-BRA uses the same basename for image and mask in version 1.0.
                mask_member = member.replace('/Images/', '/Masks/')
            (folder / mask).write_bytes(archive.read(mask_member))
            cases.append({
                'id': file, 'modality': 'ultrasound', 'image': file, 'mask': mask,
                'title': f'유방 B-mode · 사례 {i + 1:02}', 'view': '실제 2D 초음파 · 공간 추적 없음',
                'note': '병변 mask와 원영상 비교 · CT 복부 사례와 다른 인체',
                'source': 'https://zenodo.org/records/8231412',
                'citation': 'Gómez-Flores et al., BUS-BRA, Medical Physics 51, 3110–3123 (2024)',
                'license': 'CC BY 4.0 metadata + bundled permission notice',
                'changes': 'Original image and mask, no pixel modifications',
            })
        (folder / 'BUSBRA-LICENSE.txt').write_bytes(archive.read('BUSBRA/LICENSE.txt'))
    write_json(folder / 'catalog.json', {'cases': cases, 'reviewStatus': 'Dataset labels; not individually clinically validated'})
    print(json.dumps({'phantom_voxels': len(raw), 'teaching_cases': len(cases)}, ensure_ascii=False))


if __name__ == '__main__':
    main()
