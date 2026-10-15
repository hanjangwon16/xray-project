from pathlib import Path
import hashlib
import io
import json
import urllib.request
import zipfile
from PIL import Image, ImageDraw

ROOT=Path(__file__).resolve().parents[1]
OUT=ROOT/'web/public/learning'
SOURCES=[
    ('kidney-ultrasound.zip','h6jc4xm4py','3793a043-ad32-4c9b-b038-2d0b98aadf2f','d4145a5b14db5778298081bcd0db6d3cd423a693bd54c5112a83d6f1467136a8'),
    ('lus-7seg.zip','cwc37g672d','a14dbc9c-7193-4434-ba5f-41fe541a7828','edde42182d385da431dbe71d863e1a69520b10ec8b0efcdcbf07888cc0deda40'),
]


def main():
    catalog_path=OUT/'catalog.json'
    catalog=json.loads(catalog_path.read_text())
    catalog['cases']=[c for c in catalog['cases'] if not c['id'].startswith(('kidney-real-','lus-real-'))]
    manifest=[];summary=[];exported=0
    for filename,dataset,file_id,checksum in SOURCES:
        path=ROOT/'data/sources'/filename
        url=f'https://data.mendeley.com/public-files/datasets/{dataset}/files/{file_id}/file_downloaded'
        if not path.exists():urllib.request.urlretrieve(url,path)
        assert hashlib.sha256(path.read_bytes()).hexdigest()==checksum,'Source archive checksum mismatch'
        with zipfile.ZipFile(path) as archive:
            images=sorted(n for n in archive.namelist() if n.lower().endswith('.jpg'))
            exports=[]
            record={'dataset':dataset,'version':1,'archive':filename,'url':url,'sha256':checksum,'sourceImageCount':len(images),'license':'CC BY 4.0','exports':exports}
            groups=['Normal','stone'] if dataset=='h6jc4xm4py' else sorted({n.split('/')[1] for n in images})
            for group in groups:
                candidates=[n for n in images if (f'/{group}/' in n)]
                for member in candidates[:8 if dataset=='h6jc4xm4py' else 4]:
                    raw=archive.read(member)
                    image=Image.open(io.BytesIO(raw));image.verify()
                    index=len(exports)+1
                    stem=('kidney-real-' if dataset=='h6jc4xm4py' else 'lus-real-')+str(index)
                    target=stem+'.jpg';(OUT/target).write_bytes(raw)
                    ids=[2,3] if dataset=='h6jc4xm4py' else []
                    mask=None
                    if dataset=='cwc37g672d':
                        annotation=json.loads(archive.read(member[:-4]+'.json'))
                        image=Image.open(io.BytesIO(raw));assert image.size==(annotation['imageWidth'],annotation['imageHeight'])
                        overlay=Image.new('RGB',image.size);draw=ImageDraw.Draw(overlay)
                        for shape in annotation['shapes']:
                            organ={'肝脏':5,'胆囊':8,'Live':5,'GB':8}.get(shape['label'])
                            if organ and len(shape['points'])>=3:
                                ids.append(organ);draw.polygon([tuple(p) for p in shape['points']],fill=(180,85,65) if organ==5 else (70,195,110))
                        assert ids,'No recognized organ annotation'
                        mask=stem+'-mask.png';overlay.save(OUT/mask)
                    citation='Kaur & Singh (2024), Kidney Ultrasound Images Stone and No Stone, doi:10.17632/h6jc4xm4py.1' if dataset=='h6jc4xm4py' else 'Chen & Zhou (2026), LUS-7Seg, doi:10.17632/cwc37g672d.1'
                    title=('신장 · '+('Normal 원분류' if group=='Normal' else 'Stone 원분류')) if dataset=='h6jc4xm4py' else '간·담낭 · '+group+' 표준면'
                    case={'id':stem,'modality':'ultrasound','organIds':sorted(set(ids)),'image':target,'title':title+' · '+str(index),'view':group+' / 실제 2D 촬영',
                          'note':'전신 팬텀과 다른 사람의 정지 영상입니다. 좌우·입사각·주파수 메타데이터로 정합되지 않았습니다. 원자료 분류이며 개별 임상 검수 전 표본입니다.',
                          'source':f'https://data.mendeley.com/datasets/{dataset}/1','citation':citation,'license':'CC BY 4.0 · https://creativecommons.org/licenses/by/4.0/',
                          'changes':'Original JPEG pixels unchanged; organ mask rasterized from source annotation polygons.' if mask else 'Original JPEG, no pixel modifications.'}
                    if mask:case['mask']=mask
                    catalog['cases'].append(case)
                    exports.append({'member':member,'file':target,'sha256':hashlib.sha256(raw).hexdigest(),'organIds':case['organIds']})
                    exported+=1
            manifest.append(record)
            summary.append({'id':dataset,'images':len(images)})
    catalog_path.write_text(json.dumps(catalog,ensure_ascii=False,indent=2))
    (OUT/'organ-sources.json').write_text(json.dumps(manifest,ensure_ascii=False,indent=2))
    (OUT/'ORGAN-ULTRASOUND-LICENSE.txt').write_text('\n\n'.join(citation for citation in [
        'Kaur & Singh (2024), doi:10.17632/h6jc4xm4py.1',
        'Chen & Zhou (2026), doi:10.17632/cwc37g672d.1',
        'CC BY 4.0: https://creativecommons.org/licenses/by/4.0/ . Original JPEGs unchanged. LUS masks derived from original organ polygons. No endorsement implied. These are separate patients, not registered to the body phantom.']))
    print(json.dumps({'exported':exported,'archives':summary}))


if __name__=='__main__':main()
