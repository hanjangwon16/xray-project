# X-ray Anatomy Lab

CT 단면 + 3D 해부 구조 + 각도별 가상 X-ray(DRR)를 연동한 **교육용** 웹 앱.
방사선 촬영 각도 감각과 해부학 위치·형태를 함께 익히는 것이 목적입니다.

## 기능

- **3단면 CT 뷰어**: Axial / Coronal / Sagittal, 슬라이더로 단면 이동
- **3D 골격 표면**: Marching Cubes(HU>300) 위에 X-ray 빔 시각화
  - 노란 점 = X-ray 소스, 파란 와이어프레임 = 검출기, 주황 선 = 빔 경로
- **가상 X-ray (DRR)**: Beer–Lambert 광선 적분 + 삼선형 보간, Web Worker
  - 표준 촬영 프리셋: PA / AP / 좌·우측면 / LAO·RAO 45°
  - 환자 회전(yaw), C-arm 각도(pitch), 검출기 회전(roll), SID 조절

## 기술 스택

- Vite + React + TypeScript
- [@kitware/vtk.js](https://kitware.github.io/vtk-js/) — 단면 리슬라이스·3D 표면
- Web Worker — DRR 레이캐스팅
- 데이터: TotalSegmentator 예제 CT (CC BY 4.0), NIfTI → raw int16 전처리

## 실행

```bash
cd web
npm install
npm run dev        # 개발 서버
npm run build      # dist/ 에 정적 빌드
npm run preview    # 빌드 미리보기
```

## 새 케이스 추가

```bash
python scripts/prepare_case.py <input.nii.gz> web/public/cases/<case_id>
```

`App.tsx`의 `CASE_ID`를 바꾸거나 케이스 선택 UI를 추가하면 됩니다.

## 배포

`web/dist`는 순수 정적 파일입니다. 그대로 정적 호스팅에 올리면 됩니다.

- GitHub Pages: `npm run build` 후 `dist`를 `gh-pages` 브랜치에 push
- Netlify/Vercel: 빌드 명령 `cd web && npm run build`, 출력 `web/dist`

## 면책

본 도구는 교육용 시뮬레이션입니다. 실제 진단·치료·촬영 지침으로 사용할 수 없습니다.
