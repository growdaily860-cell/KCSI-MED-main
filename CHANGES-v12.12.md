# KCSI-MED v12.12

## threeui 배경 이식 경로

- [threeui](https://github.com/MengTo/threeui)(MIT) 배경 소스를 React·번들러 없이 띄우는
  `threeui/threeui-background.js` 로더 추가 — 원본 HTML을 고치지 않고 `<iframe srcdoc>`으로 실행
- 원본 importmap의 jsDelivr CDN 주소를 저장소 안의 `vendor/three`로 바꿔 **네트워크 없이 동작**
  (기존의 "외부 CDN 사용 0건" 원칙 유지), 외부 폰트 `<link>`도 제거
- `npm run vendor:three` — 배경 소스가 실제로 import하는 three 파일만 의존 그래프를 따라 복사
  (`examples/jsm` 전체 15MB 대신 12개 파일 1.4MB)
- 화면 밖·백그라운드 탭에서 iframe을 떼어 GPU·배터리 절약, `prefers-reduced-motion` 존중,
  `dispose()`로 완전 정리
- 확인용 페이지 `threeui/demo.html` (`npm run serve` 후 `/threeui/demo.html`)
- 판독 화면(`index.html`)에는 기본 적용하지 않음 — 현장 판독과 무관한 GPU 부하를 기본값으로 얹지 않는다
- `sandbox="allow-scripts"` iframe은 고유 출처이므로 `vendor/three`에 CORS 허용 헤더 추가
  (`tests/dev-server.js`, `vercel.json`)
- `tests/threeui-background.js` — 남은 외부 주소, 빠진 vendor 파일, 헛도는 치환, 라이선스 원문 누락 검사

## 문서

- [`docs/THREEUI_INTEGRATION.md`](docs/THREEUI_INTEGRATION.md) 추가
  - threeui `npm run dev`의 `three/addons/postprocessing/OutputPass.js` 오류 원인과 해결
    (three@0.149에는 r152에서 추가된 `OutputPass`가 없고, 문제의 HTML은 iframe용 `?raw` 템플릿이라
    앱 번들과 무관 — Vite 의존성 스캔만 중단되고 개발 서버는 정상)
  - KCSI-MED에 흔히 안내되는 React `.tsx` 이식 방법이 맞지 않는 이유와 대체 절차
  - 다른 threeui 배경으로 교체하는 절차, 라이선스 표기
