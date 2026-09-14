"""Build deterministic, grouped BodyParts3D triangle meshes in original mm coordinates."""
from pathlib import Path
from zipfile import ZipFile
import re,json,csv,hashlib,gzip
import numpy as np
source=Path('data/bodyparts3d'); out=Path('web/public/atlas');out.mkdir(parents=True,exist_ok=True)
children={}
for r in csv.DictReader((source/'relations.txt').open(),delimiter='\t'):children.setdefault(r['parent id'],set()).add(r['child id'])
def descendants(root):
 seen=set(); pending=[root]
 while pending:
  x=pending.pop()
  if x not in seen:seen.add(x);pending.extend(children.get(x,[]))
 return seen
sets={'bones':descendants('FMA23881'),'nerves':descendants('FMA7157'),'vessels':descendants('FMA7161'),'organs':set().union(*(descendants(x) for x in ['FMA7152','FMA7158','FMA7159','FMA7160','FMA9668']))}
for r in csv.DictReader((source/'isa_relations.txt').open(),delimiter='	'):children.setdefault(r['parent id'],set()).add(r['child id'])
sets['bones'] |= descendants('FMA5018')
sets['muscles'] = descendants('FMA5022') | descendants('FMA10474')
groups={x:[] for x in ['bones','muscles','organs','vessels','nerves']}; catalog=[]
z=ZipFile(source/'isa.zip')
for f in sorted(z.namelist()):
 if not f.endswith('.obj'):continue
 s=z.read(f).decode();cid=re.search(r'# Concept ID : (.*)',s)[1].strip();name=re.search(r'# English name : (.*)',s)[1].strip()
 group=next((g for g in ['nerves','vessels','bones','muscles','organs'] if cid in sets[g]),None)
 if not group and re.search(r'muscle| biceps| triceps| deltoid| psoas| rectus| oblique| gluteus| trapezius| latissimus| intercostal| diaphragm| tendon',name,re.I):group='muscles'
 if not group and re.search(r'nerve|plexus|ganglion|spinal cord',name,re.I):group='nerves'
 if not group and re.search(r'bone|femur|tibia|fibula|humerus|ulna|radius|rib|vertebra|phalanx|sacrum|sternum|scapula|clavicle|patella|talus|calcaneus|capitate|hamate|lunate|pisiform|scaphoid|trapezium|trapezoid|triquetral|vomer|maxilla|mandible',name,re.I):group='bones'
 if not group and re.search(r'artery|vein|aorta|vena cava',name,re.I):group='vessels'
 if not group:continue
 verts=[];tri=[]
 for line in s.splitlines():
  if line.startswith('v '):verts.append([float(v) for v in line.split()[1:4]])
  elif line.startswith('f '):
   ids=[int(v.split('/')[0])-1 for v in line.split()[1:]]
   for j in range(1,len(ids)-1):tri.extend([verts[ids[0]],verts[ids[j]],verts[ids[j+1]]])
 if not tri:continue
 a=np.asarray(tri,dtype='<f4');groups[group].append(a);catalog.append({'id':cid,'name':name,'group':group,'triangles':len(a)//3})
manifest={'source':'BodyParts3D / DBCLS','version':'4.0 OBJ 99','units':'mm','sourceUrl':'https://dbarchive.biosciencedbc.jp/en/bodyparts3d/download.html','groups':[]}
for group,arr in groups.items():
 a=np.concatenate(arr);(out/(group+'.mesh')).write_bytes(gzip.compress(a.tobytes(),compresslevel=9,mtime=0));manifest['groups'].append({'id':group,'file':group+'.mesh','vertices':len(a),'structures':sum(c['group']==group for c in catalog),'bounds':[a.min(axis=0).tolist(),a.max(axis=0).tolist()],'sha256':hashlib.sha256(a.tobytes()).hexdigest()})
(out/'manifest.json').write_text(json.dumps(manifest,indent=2));(out/'catalog.json').write_text(json.dumps(catalog,ensure_ascii=False));print(json.dumps(manifest,indent=2))
(out/'ATTRIBUTION.txt').write_text('BodyParts3D, (c) The Database Center for Life Science. Original OBJ 4.0 headers specify CC Attribution-Share Alike 2.1 Japan. These grouped, triangulated derived meshes retain that attribution and license: https://creativecommons.org/licenses/by-sa/2.1/jp/ . The current archive website lists CC BY 4.0 (2025-02-27); original header terms retained conservatively for this release. Coordinates unchanged; triangulated and grouped for educational display. https://dbarchive.biosciencedbc.jp/en/bodyparts3d/lic.html')
