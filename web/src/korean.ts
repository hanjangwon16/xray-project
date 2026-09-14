// BodyParts3D 영문 구조명 → 한글. 사전적 패턴 매칭.
const PATTERNS: [RegExp, string][] = [
  [/^right /i, '우측 '], [/^left /i, '좌측 '],
  [/^first /i, '제1 '], [/^second /i, '제2 '], [/^third /i, '제3 '], [/^fourth /i, '제4 '], [/^fifth /i, '제5 '],
  [/\bright\b/i, '우측'], [/\bleft\b/i, '좌측'],
  [/liver/i, '간'], [/spleen/i, '비장'], [/stomach/i, '위'],
  [/kidney/i, '신장'], [/pancreas/i, '췌장'], [/gallbladder/i, '담낭'],
  [/lung/i, '폐'], [/heart/i, '심장'], [/brain|cerebrum|cerebellum/i, '뇌'],
  [/esophagus/i, '식도'], [/trachea/i, '기관'], [/thyroid/i, '갑상선'],
  [/small bowel|small intestine/i, '소장'], [/colon|large intestine/i, '대장'],
  [/duodenum/i, '십이지장'], [/rectum/i, '직장'], [/bladder/i, '방광'],
  [/uterus/i, '자궁'], [/prostate/i, '전립선'], [/ovary|ovaries/i, '난소'],
  [/testis|testicle/i, '고환'], [/penis/i, '음경'], [/vagina/i, '질'],
  [/aorta/i, '대동맥'], [/vena cava/i, '대정맥'], [/artery/i, '동맥'], [/vein/i, '정맥'],
  [/femur/i, '대퇴골'], [/tibia/i, '경골'], [/fibula/i, '비골'],
  [/humerus/i, '상완골'], [/ulna/i, '척골'], [/radius/i, '요골'],
  [/rib/i, '늑골'], [/vertebra/i, '척추'], [/sternum/i, '흉골'],
  [/scapula/i, '견갑골'], [/clavic|clavicle/i, '쇄골'], [/patella/i, '슬개골'],
  [/skull|cranium/i, '두개골'], [/mandible/i, '하악골'], [/maxilla/i, '상악골'],
  [/sacrum/i, '천골'], [/coccyx/i, '미골'], [/hip|pelvis|ilium|ischium|pubis/i, '골반'],
  [/phalanx|phalanges/i, '지골'], [/carpal/i, '수근골'], [/tarsal/i, '족근골'],
  [/metacarpal/i, '중수골'], [/metatarsal/i, '중족골'],
  [/calcaneus/i, '종골'], [/talus/i, '거골'], [/vomer/i, '서골'],
  [/scaphoid/i, '주상골'], [/lunate/i, '월상골'], [/triquetral/i, '삼각골'],
  [/pisiform/i, '완두골'], [/trapezium/i, '대각골'], [/trapezoid/i, '소각골'],
  [/capitate/i, '두상골'], [/hamate/i, '구상골'],
  [/biceps/i, '이두근'], [/triceps/i, '삼두근'], [/deltoid/i, '삼각근'],
  [/psoas/i, '대요근'], [/rectus/i, '직근'], [/oblique/i, '사근'],
  [/gluteus/i, '둔근'], [/trapezius/i, '승모근'], [/latissimus/i, '광배근'],
  [/intercostal/i, '늑간근'], [/diaphragm/i, '횡격막'], [/tendon/i, '건'],
  [/muscle|m\./i, '근육'], [/sphincter/i, '괄약근'],
  [/nerve|n\./i, '신경'], [/plexus/i, '신경총'], [/ganglion/i, '신경절'],
  [/spinal cord/i, '척수'], [/optic/i, '시신경'],
  [/cartilage/i, '연골'], [/ligament/i, '인대'], [/bone/i, '뼈'],
  [/superior/i, '상'], [/inferior/i, '하'], [/anterior/i, '전'], [/posterior/i, '후'],
  [/medial/i, '내측'], [/lateral/i, '외측'], [/middle/i, '중간'],
  [/internal/i, '내'], [/external/i, '외'], [/common/i, '총'],
  [/deep/i, '심부'], [/superficial/i, '천부'], [/major/i, '대'], [/minor/i, '소'],
  [/longus|long /i, '장'], [/brevis|short /i, '단'], [/maximus/i, '대'], [/minimus/i, '소'], [/medius/i, '중'],
];
export function koreanName(en: string): string {
  let s = en;
  const hits: string[] = [];
  for (const [re, ko] of PATTERNS) if (re.test(s)) { hits.push(ko); s = s.replace(re, ' '); }
  return hits.length ? hits.join(' ') : en;
}
