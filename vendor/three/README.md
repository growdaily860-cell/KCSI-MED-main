# vendor/three (생성물)

`npm run vendor:three`가 `node_modules/three`(three@0.165.0)에서 복사한 파일이다. 직접 고치지 않는다.

threeui/sources의 배경 소스가 실제로 import하는 애드온만 담는다(현재 4개 진입점, 파일 12개).
새 배경 소스를 `threeui/sources/`에 추가했다면 `npm run vendor:three`를 다시 실행한다.

three.js는 MIT 라이선스이며 원문은 이 폴더의 `LICENSE`에 있다.
