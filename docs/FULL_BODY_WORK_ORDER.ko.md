# 전신 해부·촬영 학습 확장 작업지시서

## 1. 제품 목적과 완료 정의
사용자가 전신에서 부위와 구조를 먼저 파악하고, CT의 절단 위치와 X-ray의 투영 방향을 연결해 이해하도록 한다. 영상 나열만으로 완료 처리하지 않는다. 전신 아틀라스와 실제 환자 CT는 서로 다른 데이터임을 화면에서 표시한다. 부위 밖 CT를 만들어 보여주거나, 아틀라스 메시를 HU 데이터인 것처럼 투영하지 않는다.

요청 범위: 전신 확대, 안정적인 마우스 회전·이동·확대, 개선된 X-ray, 장기·뼈·신경·혈관·근육의 단독/조합 표시, 상세 구현 및 검증 기록. 현재 앱은 Vite/React/TypeScript/vtk.js와 브라우저 DRR worker를 사용한다. 정적 GitHub Pages 배포를 유지한다.

## 2. 데이터 선정과 출처
| 목적 | 데이터 | 선정 이유 | 제한 |
|---|---|---|---|
| 전신 형태·5계통 | DBCLS BodyParts3D 4.0, IS-A OBJ 99% 감소판 | 해부 구조 ID·이름·공통 mm 좌표 제공, 원본 메시 사용 | 교육용 표준 아틀라스, 개인 CT와 동일 인체 아님, 미세구조 손실 |
| 구조 분류 | BodyParts3D IS-A 및 PART-OF 관계 테이블 | FMA 계층으로 분류 재현 가능 | 계층 밖 구조는 명시적 이름 규칙 사용, 검수 필요 |
| CT·분할 | TotalSegmentator 실제 CT 및 동일 격자 labelmap | 원본 HU와 장기 마스크로 정확한 단면 연동 | 현재 사례는 복부; 전신 CT로 오인 금지 |
| 고품질 DRR 기준 | DiffDRR | 검증 가능한 CT 광선적분, 기존 Python 환경 있음 | 신경·혈관을 일반 X-ray에서 직접 관찰할 수 있다는 설명 금지 |

공식 URL:
- https://dbarchive.biosciencedbc.jp/en/bodyparts3d/download.html
- https://dbarchive.biosciencedbc.jp/en/bodyparts3d/lic.html
- https://dbarchive.biosciencedbc.jp/data/bodyparts3d/LATEST/isa_BP3D_4.0_obj_99.zip
- https://dbarchive.biosciencedbc.jp/data/bodyparts3d/LATEST/isa_inclusion_relation_list.txt
- https://dbarchive.biosciencedbc.jp/data/bodyparts3d/LATEST/partof_inclusion_relation_list.txt
- https://github.com/wasserth/TotalSegmentator
- https://zenodo.org/records/6802614
- https://github.com/eigenvivek/DiffDRR

라이선스 주의: 현재 BodyParts3D 공식 안내는 CC BY 4.0, 다운로드한 OBJ 헤더에는 CC BY-SA 2.1 Japan이 있다. 원본 헤더 조건·저작자·수정 내역을 배포 ATTRIBUTION.txt에 보존하고 파생 메시를 해당 조건으로 제공한다. 전체 애플리케이션 코드의 라이선스와 데이터 라이선스를 구분한다. 다운로드 파일 버전·SHA-256과 원본 URL을 기록한다. TotalSegmentator 코드 라이선스를 데이터 이용 허가로 대신하지 않는다.

## 3. 데이터 파이프라인 작업
소유 파일: scripts/prepare_atlas.py, web/public/atlas/*
1. 원본 ZIP과 관계표를 data/bodyparts3d 아래 보존한다. 원본 ZIP은 웹에 올리지 않는다.
2. OBJ 헤더의 Concept ID/FMA와 English name을 추출한다. 정점 좌표 단위 mm를 유지한다.
3. IS-A bone organ FMA5018, muscle organ FMA5022 및 관련 계층과 PART-OF 신경/혈관/장기 계층을 사용한다.
4. 부족한 분류는 nerve/artery/vein 등의 명시 규칙을 사용한다. 미분류를 엉뚱한 장기로 강제 편입하지 않는다.
5. OBJ face를 삼각분할한다. 음수 인덱스·다각형·빈 메시·비정상 수치는 검증하고 실패 원인을 기록한다.
6. 계통별 Float32 xyz 삼각형 데이터를 LE로 저장한다. manifest에 정점 수, 구조 수, bounds, SHA256을 기록한다. catalog에 구조 ID·이름·계통·삼각형 수를 남긴다.
7. 계층 중복으로 같은 표면을 중복 합치지 않았는지 표본 검수한다. 상위 집합 메시와 구성 메시가 동시 존재하면 leaf 우선 규칙을 적용한다.
8. 변환 전후 bounds, 정점 수, 좌표 단위를 검사한다. 좌우 반전·전후 방향은 양쪽 신장/심장/간 등의 landmark로 검증한다.
9. 장기별 색상·선택 확장 시 단일 merged buffer에 구조별 triangle range를 추가해 picking 결과를 FMA에 연결한다.

## 4. 화면과 상태 설계
소유 파일: web/src/AtlasView.tsx, App.tsx, styles.css
- 최상위 작업 공간: 전신 계통 탐색 / 실제 CT·X-ray 사례. 같은 창에서 버튼 선택으로 전환한다.
- 전신 3D가 주 화면이다. 왼쪽 패널에 5계통 checkbox, 각 계통의 단독 버튼, 모두 보기/숨기기, 투명도, 로딩 상태를 둔다.
- checkbox는 독립 boolean 집합이다. 단독 버튼은 해당 한 계통만 선택한다. 모두 숨기기도 정상 상태로 허용한다.
- 계통별 표시 여부가 CT 감쇠 물질을 제거하지 않도록 한다. 표시 필터와 방사선 물리의 입력은 별개이다.
- 모드 전환 중 기존 CT 단면 인덱스와 촬영 각도를 보존한다.
- 100dvh 기준 전체 페이지 스크롤 없이 사용한다. 작은 화면의 도구 패널 내부 스크롤은 허용하되 3D와 선택 컨트롤이 숨지 않아야 한다.
- 일반 전신 모델로부터 특정 환자 CT가 생성된 것처럼 표시하지 않는다. 실제 촬영 연동은 정합된 사례로 진입할 때만 제공한다.
- CT 없는 부위: 촬영 데이터 미제공 상태와 지원 부위를 표시한다. 무관한 복부 CT를 팔다리 결과로 사용하지 않는다.

## 5. 마우스 조작 상세
- 왼쪽 드래그: 몸 중심 궤도 회전. 수직축은 머리–발 방향을 유지한다.
- 수직 회전은 ±약 72°로 제한하여 위아래 뒤집힘을 막는다. 수평은 360° 연속 회전한다.
- Shift+왼쪽 또는 오른쪽/중간 드래그: 화면 평행 이동. 카메라 각도와 확대 배율을 반영한 방향으로 계산한다.
- 휠: 지수식 확대, 이벤트 delta 한계 및 최소/최대 범위 적용. 페이지 스크롤과 충돌하지 않는다.
- pointer capture로 캔버스 밖에서 놓아도 드래그를 종료한다. pointercancel/lostpointercapture를 처리한다.
- 정면/후면/측면/전체 맞춤 버튼으로 복귀한다. reset은 회전·이동·확대를 함께 초기화한다.
- ResizeObserver가 실제 렌더 버퍼를 조정한다. CSS로만 canvas를 늘리지 않는다.
- camera 위치 갱신은 requestAnimationFrame당 1회로 합쳐 CPU 낭비를 줄인다. 입력 중 DRR을 재계산하지 않는다.
- 해부 모델 회전과 X-ray 소스 각도 변경을 별개 제어로 명확히 표시한다.

## 6. X-ray 개선 지시
소유 파일: drr.worker.ts, beam.ts, types.ts, App.tsx
A. 정확한 좌표: RAS 환자 좌표, source/center/detector와 투영 기저를 단일 함수로 공유한다. yaw=0 PA, AP=180과 좌측면/우측면 검출기 방향을 수치 검증한다.
B. 거리: SID는 임상적으로 source-to-image distance다. 기존 source-to-center 변수와 혼동하지 않는다. SOD, SDD, OID=SDD-SOD를 각각 정의한다.
C. 광선 범위: 각 ray와 볼륨 AABB 교차를 계산해 실제 볼륨 안만 적분한다. detector보다 뒤를 적분하지 않는다. source와 detector가 볼륨을 관통하는 잘못된 설정을 막는다.
D. 샘플링: voxel spacing을 반영한 삼선형 HU 보간, 기본 step 1.5–2.5mm; 확정 결과는 더 미세하게 렌더한다.
E. 해상도: 조작 중 128–160px, 정지 후 320px 이상. Web Worker에 volume을 한 번 초기화한 뒤 각도만 전달하는 구조로 확장한다.
F. 대비: 단순 프레임별 min/max 정규화로 각도별 밝기 비교를 왜곡하지 않는다. 고정된 log attenuation window/gamma와 사용자 조절을 제공한다. 공기는 검정, 뼈는 밝은 영상으로 출력한다.
G. stale 결과: requestId를 부여하여 과거 각도 결과가 최신 영상 위에 덮이지 못하게 한다. worker 큐는 최신 요청만 남기고 busy/error 상태 표시.
H. 구조색: 일반 영상은 회색조 기본. 학습 overlay는 가상 색임을 표시하고 한 픽셀에 여러 장기가 겹친다는 사실을 설명한다. dominant label을 유일 원인으로 설명하지 않는다.
I. 검증: 물 팬텀 경로 길이에 비례한 적분, 대칭 팬텀 AP/PA, 비대칭 marker 좌우, 경사/roll, SID 확대율 검증. DiffDRR 동일 geometry 출력과 비교한다.
J. 한계: 산란·스펙트럼·검출기 응답 미모델링 시 임상 동등 품질이라고 말하지 않는다. 단순 외형 개선과 물리 검증 상태를 별도 기록한다.

## 7. 성능·오류·배포
- 계통별 lazy loading, 로딩 진행과 오류 재시도 UI. 로드 중 checkbox 변경은 도착 시 현재 선택 상태를 적용한다.
- 모든 mesh는 몇 개의 계통 actor로 합쳐 draw call을 줄인다. 큰 묶음은 영역별 LOD/압축 indexed mesh로 후속 분할한다.
- 원본과 배포 모델의 바이트 수를 측정한다. 모바일 네트워크에 대용량 데이터가 무조건 선로드되지 않게 개선한다.
- cleanup: fetch abort, observer disconnect, DOM event 해제, render window·actors·mappers·polydata disposal.
- CI: TypeScript + Vite build. 기능 검증 완료 후 기존 Pages workflow로 배포한다. 아틀라스 파일은 같은 정적 base path로 제공한다.
- 공개 URL에서도 manifest 및 모든 선택 계통 로딩, worker 파일, 사례 binary가 200인지 확인한다.

## 8. 수용 테스트
1. 첫 화면에서 머리·몸통·팔·다리·발이 식별되는 전신 뼈대를 스크린샷으로 확인한다.
2. 뼈/장기/신경/혈관/근육 각각 단독 선택 시 다른 계통이 사라지고 선택 계통이 남는다.
3. 뼈+혈관, 근육+신경, 모든 계통 조합에서 선택 상태와 출력이 맞는다.
4. 드래그 전후 화면 변화, 원점 복귀, 휠 한계, shift pan을 실사용 viewport에서 검사한다.
5. 전체 페이지 overflow 없음, 창 크기 변경 후 3D 찌그러짐 없음.
6. 전신↔사례 반복 전환 후 pageerror 없음, 캔버스 중복 없음.
7. CT 원본과 변환 binary 모든 voxel equality 검사 유지.
8. 장기 선택 CT 연동과 X-ray 프리셋·각도 변화 회귀 검사.
9. 다운로드 실패/중단 시 빈 화면에 성공 문구를 내지 않는다.
10. 전신 CT·전신 말초 신경 등 제공되지 않은 범위를 완료로 보고하지 않는다.

## 9. 실행 순서와 다음 릴리스
현재 릴리스: BodyParts3D 변환→5계통 화면→안정 회전→실제 사례 유지→DRR 정지 해상도·응답 동기화→공개 배포 확인.
이번 확장: 구조별 클릭/검색·한글 용어 표시→계통별 개별 opacity→TotalSegmentator full task fast 3mm 세그멘테이션 연결→구조 찾기 퀴즈. 아틀라스와 실제 CT는 여전히 서로 다른 인체이므로 좌표 정합은 하지 않는다. 영역별 lazy LOD와 같은 사람의 전신 CT 정합은 데이터가 확보될 때 별도 릴리스로 진행한다.
신경·혈관은 일반 비조영 CT에서 모두 분할되지 않는다. 신경 세부 구조는 atlas로 학습하고 CT 연동은 검증된 구조만 허용한다. 전신 단일 환자 CT가 확보되지 않으면 부위별 사례로 명시하고 이어붙인 가짜 환자 데이터를 만들지 않는다.

## 10. 이번 구현 결과 및 잔여 범위
- 원본 IS-A 4.0 기반 5계통 mesh 생성, 뼈 276/근육 392/장기 291/혈관 833/신경 94 구조. 구조 수는 해부학적 고유 장기 수와 다르며 분할 부품 수이다.
- 신경 94개 bounds는 두부 범위다. 전신 말초신경 미포함을 UI에 명시했다.
- 정점 gzip 압축으로 전체 전송량 약 45MB. 파일 확장자는 .mesh: .gz에 대한 서버 자동 Content-Encoding과 중복 해제를 방지한다. 브라우저 DecompressionStream 사용.
- 단독/복수/전체 표시, 투명도, 정면/후면/측면/reset, 제한 회전/휠/shift pan 구현.
- DRR 320px, 1.5mm sampling, ray-AABB 교차 범위, requestId에 따른 stale 결과 무시 구현.
- `example_ct`에 TotalSegmentator full task fast 3mm 원본과 같은 격자의 실제 labelmap을 연결했다. 상복부 사례와 전신 사례 모두 장기·뼈 선택색을 표시할 수 있다.
- 구조 검색(영문/한글 패턴), 계통별 개별 opacity, 클릭 구조 하이라이트, 구조 찾기 퀴즈를 구현했다.
- 고정 감쇠 window, 팬텀/DiffDRR 동등 검증, 완전한 말초신경, 환자별 전신 CT 정합은 후속이다.
- Playwright 로컬: 5계통 단독/전체 선택, 드래그/휠/reset, 사례 전환, 사위 DRR 변경 통과. pageerror 0, document overflow 없음.

## 11. 전신 탐색에서 영상 비교 진입
전신 메시 클릭은 CellPicker로 실제 삼각형을 고르고 catalog의 계통별 누적 triangle 범위로 이름을 찾는다. 여러 actor를 고르면 가장 앞 actor를 다시 단독 pick하여 cellId가 같은 actor 소속임을 보장한다. 5px 이하 이동만 클릭, 회전 드래그는 선택하지 않는다.
간·양쪽 신장·비장·위 선택은 AnatomyPreview 옆 패널에서 동일 장기의 실제 복부 사례를 연다. CT 단면은 사례 labelmap 장기 중심으로 이동한다. X-ray는 사례 전체 복부 투영이며 선택 장기만의 결과가 아님을 표시한다. 아틀라스 표면 좌표를 다른 환자 CT voxel로 직접 변환하지 않는다. 미지원 구조는 데이터 없음. 전신 카메라는 패널 열고 닫아도 유지한다.
검증: quick organ 선택, 122px CT/320px DRR 출력 전환, 두부 실제 클릭 -> Frontal bone 식별, pageerror 0, page overflow 없음.
