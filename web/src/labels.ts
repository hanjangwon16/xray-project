// TotalSegmentator "total" task label ids -> name + display color.
export interface LabelInfo { name: string; color: [number, number, number]; group: string }

export const LABELS: Record<number, LabelInfo> = {
  1: { name: '비장', color: [220, 80, 80], group: '장기' },
  2: { name: '우신장', color: [200, 60, 120], group: '장기' },
  3: { name: '좌신장', color: [200, 60, 160], group: '장기' },
  4: { name: '담낭', color: [120, 200, 80], group: '장기' },
  5: { name: '간', color: [200, 120, 60], group: '장기' },
  6: { name: '위', color: [230, 170, 60], group: '장기' },
  7: { name: '대동맥', color: [235, 60, 60], group: '혈관' },
  8: { name: '하대정맥', color: [80, 120, 220], group: '혈관' },
  9: { name: '문맥·비장정맥', color: [90, 160, 220], group: '혈관' },
  10: { name: '췌장', color: [240, 200, 90], group: '장기' },
  11: { name: '우부신', color: [180, 100, 200], group: '장기' },
  13: { name: '식도', color: [200, 160, 120], group: '장기' },
  14: { name: '십이지장', color: [220, 140, 90], group: '장기' },
  18: { name: '소장', color: [230, 190, 130], group: '장기' },
  19: { name: '대장', color: [200, 150, 100], group: '장기' },
  20: { name: '방광', color: [120, 180, 230], group: '장기' },
  30: { name: '우상엽', color: [240, 130, 130], group: '폐' },
  31: { name: '우중엽', color: [240, 160, 110], group: '폐' },
  32: { name: '우하엽', color: [230, 110, 110], group: '폐' },
  33: { name: '좌상엽', color: [130, 170, 240], group: '폐' },
  52: { name: '심장', color: [230, 70, 90], group: '장기' },
  63: { name: '흉추', color: [235, 220, 190], group: '뼈' },
  64: { name: '요추', color: [225, 210, 175], group: '뼈' },
  79: { name: '늑골', color: [230, 215, 185], group: '뼈' },
  86: { name: '우엉덩뼈', color: [210, 200, 170], group: '뼈' },
  87: { name: '좌엉덩뼈', color: [205, 195, 165], group: '뼈' },
  88: { name: '천골', color: [220, 205, 175], group: '뼈' },
  89: { name: '흉골', color: [235, 220, 190], group: '뼈' },
  98: { name: '우쇄골', color: [225, 210, 180], group: '뼈' },
  99: { name: '좌쇄골', color: [220, 205, 175], group: '뼈' },
  100: { name: '우견갑골', color: [215, 200, 170], group: '뼈' },
  101: { name: '좌견갑골', color: [210, 195, 165], group: '뼈' },
  102: { name: '우상완골', color: [205, 190, 160], group: '뼈' },
  103: { name: '좌상완골', color: [200, 185, 155], group: '뼈' },
  110: { name: '기관', color: [150, 200, 220], group: '기도' },
  111: { name: '우주기관지', color: [140, 190, 210], group: '기도' },
  112: { name: '좌주기관지', color: [130, 180, 200], group: '기도' },
  113: { name: '갑상선', color: [200, 120, 180], group: '장기' },
  114: { name: '쓸개관', color: [130, 190, 110], group: '장기' },
  115: { name: '부신(우)', color: [190, 110, 200], group: '장기' },
  117: { name: '폐(전체)', color: [170, 200, 235], group: '폐' },
};

export function labelName(id: number): string {
  return LABELS[id]?.name ?? `구조 ${id}`;
}
export function labelColor(id: number): [number, number, number] {
  return LABELS[id]?.color ?? [150, 150, 150];
}
