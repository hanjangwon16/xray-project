# 실측 인체 초음파로 전환

2026-10-15. 기본 초음파는 SegThy 001_P1_1_left의 실제 B-mode 볼륨이다. 기존 전신/CT 음향 모델은 별도 실험용 선택지로 남긴다. 단순 감쇠·산란 모델이 장기의 실제 내부 질감과 경계를 충분히 재현하지 못했기 때문이다.

## 데이터와 변환

- 원 배포처: https://www.cs.cit.tum.de/en/camp/publications/segthy-dataset/
- Krönke et al., *Tracked 3D ultrasound and deep neural network-based thyroid segmentation reduce interobserver variability in thyroid volumetry*, PLOS ONE (2022), https://doi.org/10.1371/journal.pone.0268550
- 원 배포 ZIP의 ground_truth_data에서 영상·분할 한 쌍과 Readme만 HTTP Range로 추출했다. 학습 모델 예측인 network_results는 사용하지 않았다.
- 원본 486×453×370, uint8, 약 0.12mm. 웹은 각 축의 매 두 번째 원본 voxel을 유지한 243×227×185, 약 0.24mm이다. 인공 산란·감쇠를 덧붙이지 않는다.
- 영상과 분할의 dimensions, spacing, 방향 헤더가 일치하는지 검사한다. 원본과 파생물 SHA-256, 원본 sform, qform code 및 변환은 public/ultrasound/segthy/case.json에 기록한다.
- 로컬 좌표는 원본 voxel 축에 mm spacing을 적용한 좌표다. 환자 RAS나 BodyParts3D와 정합된 좌표가 아니다. 분할 1은 갑상선이며, 2·3은 혈관 구조로 원본 ID를 유지한다. 혈관 개별 이름은 추가 확인 전 표시하지 않는다.
- CC BY: 원 배포처는 버전을 명시하지 않고 저작자 인용을 조건으로 상업 이용을 허용한다. 원 Readme의 문구를 LICENSE.txt로 배포하며 줄바꿈·줄끝 공백만 정리한다.

## 동작과 한계

실측 픽셀을 삼선형 보간하며 분할은 최근접 샘플링한다. 영상과 3D 분할은 같은 스캔면 geometry를 사용한다. 기본면은 갑상선 중심을 지나며, 위치·회전·기울임·깊이와 표시 Gain을 바꿀 수 있다. 실측 모드에서 주파수·TGC 합성은 제공하지 않는다.

반투명 외형은 촬영 데이터가 있는 영역이며 인체 피부가 아니다. 이 모드는 기록된 3D 초음파의 재단면 탐색이다. 임의 입사각에서 새로 측정되는 반사나 압박 변형·혈류를 재현하지 않는다. 확보 범위는 왼쪽 목 한 사례이며 간·신장·전신 실측 초음파로 일반화할 수 없다. 기존 아틀라스 장기/CT 위치 연결은 해당 합성 실험 모드로 유지하고 별도 실측 사례로 바꿔 표시하지 않는다.

재생성: `.venv/bin/python scripts/prepare_segthy.py` (NumPy 필요). 검사: `cd web && node check-imaging-physics.mjs`, 실행 중인 앱에 `TEST_URL=... node check-acquired-ultrasound.mjs`.

## 표면·성능 개선

브라우저에서 원본 고밀도 마스크마다 표면을 생성하지 않고 표시용 메시를 사전 계산한다. 0.72mm 격자에 Gaussian sigma 0.504mm와 부피를 유지하는 Laplacian 평활 4회를 적용하고 부드러운 vertex normal로 음영을 표시한다. 실측 B-mode와 원본 분할 voxel은 변경하지 않는다. 표시용 표면은 원본 경계와 약간 다르므로 정확한 분할 위치는 영상의 해설색을 기준으로 본다.

각 장기의 부피 차이 5% 미만, bounding box 변화 1mm 미만을 생성 단계와 검사에서 강제한다. 현재 갑상선·혈관의 부피 차이는 약 1.7~2.7%, 외곽 좌표 변화의 최댓값은 약 0.71mm다. 자세한 값·해시·포인트/삼각형 수는 case.json에 기록한다. 피부로 표시하지 않는 촬영 영역은 조작용 convex hull로 단순화한다. 재생성에는 기존 환경의 NumPy·SciPy·scikit-image·trimesh가 필요하다.

실측 단면 보간은 픽셀마다 임시 좌표 배열을 만들지 않고, Gain과 좌표 변환을 재사용한다. 8개 이웃 voxel의 보간값을 직접 계산하며 신호 값은 원본 보간 검사로 확인한다. `TEST_URL=... node bench-ultrasound.mjs`는 초기 표시, 연속 회전 프레임, 동일한 20회 마우스 이동 시간을 측정한다. 장치·브라우저·네트워크에 따라 절대 시간은 달라진다.

2026-10-15 로컬 Chrome 1440×960의 같은 측정 스크립트에서 초기 표시 10,839→998ms, 마우스 이동 20회 35,548→347ms, 마지막 단면 계산 20→5ms였다. 연속 회전에서 입력 60회에 표시 프레임 60회, rAF 간격 p95 약 16.7ms를 관찰했다. 실제 저사양 모바일 기기 성능은 별도 검증하지 않았다.
