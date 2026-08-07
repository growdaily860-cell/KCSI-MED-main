# KCSI-MED

현장 의약품 사진과 처방전 정보를 바탕으로 식약처 낱알식별 데이터베이스 후보를 제시하고, 조사관의 실물 대조 및 법의학 검토를 보조하는 정적 웹 애플리케이션입니다.

현재 버전: **v11.14**

> 이 도구의 결과는 의약품 신원을 자동 확정하거나 의료적 진단을 내리는 용도가 아닙니다. 모든 후보는 포장, 처방전, 식약처 등록정보 및 실물을 조사관이 직접 대조한 후 사용해야 합니다.

## 주요 기능

- 여러 알약이 포함된 사진 및 앞·뒷면 사진 등록
- 각인, 색상, 모양을 이용한 `pill_db.json` 후보 검색
- 판독 불가·무각인·반대면 미제공 상태 구분
- 이미지 품질과 형상 충돌을 반영한 신뢰도 하향 처리
- 조사관 수동 확인 전 DUR·마약류·기저질환·종합 소견 반영 차단
- 처방전 OCR 및 선택적 GPT Vision 연동
- 개인정보 이미지를 제외한 TXT 및 구조화 JSON 보고서 저장
- 식약처 낱알식별 DB 월간 갱신 GitHub Actions

## 로컬 실행

Node.js 20 이상을 권장합니다.

```powershell
npm install
npm test
npm run serve
```

브라우저에서 `http://127.0.0.1:8765`로 접속합니다.

`index.html`을 `file://` 방식으로 직접 열면 브라우저 보안 정책으로 JSON 데이터 로딩이 실패할 수 있으므로 로컬 HTTP 서버를 사용하세요.

## 테스트

```powershell
npm test
```

테스트 항목에는 초기화 순서, DOM 로드, 자동 DB 결과 안전 게이트, 수동 확인 상태, T/1 혼동 각인, 업로드 버튼 범위 및 기존 각인·색상 회귀 사례가 포함됩니다.

## Vercel 배포

이 프로젝트는 빌드 단계가 필요 없는 정적 사이트입니다.

- Framework Preset: `Other`
- Root Directory: `.`
- Build Command: 비움
- Output Directory: `.`
- Production Branch: `main`

기존 `kcsi-med.vercel.app` 주소를 유지하려면 새 프로젝트를 만들지 말고 기존 Vercel 프로젝트의 `Settings → Git`에서 이 저장소를 연결하세요.

상세 절차와 배포 후 점검 항목은 [DEPLOYMENT.md](DEPLOYMENT.md)를 참고하세요.

## 외부 서비스와 보안

- OpenAI 및 공공데이터 인증키를 Git 저장소에 커밋하지 마세요.
- 프런트엔드의 하드코딩 키 값은 비어 있으며, 선택적 AI 기능은 설정된 Cloudflare Worker를 통해 호출됩니다.
- 클라이언트에서 보이는 Worker 주소 자체는 비밀이 아닙니다. Worker에서 허용 Origin, 접근 토큰, 사용량 제한을 반드시 적용해야 합니다.
- AI 분석을 실행하면 등록한 의약품 이미지가 설정된 외부 AI 프록시로 전송될 수 있습니다.
- 월간 DB 갱신에는 GitHub Actions 저장소 Secret `DATA_GO_KR_KEY`가 필요합니다.

## 데이터 파일

- `pill_db.json`: 낱알 각인·색상·모양 후보 검색용
- `easy_db.json`: 효능 및 주의사항 지연 로드용

두 파일은 공개 의약품 데이터로 생성된 대용량 산출물이므로 `.gitattributes`에서 GitHub diff와 언어 통계 대상에서 제외했습니다. Git LFS는 사용하지 않으며 Vercel 정적 배포에 파일 자체가 포함되어야 합니다.

## 저장소 구성

```text
index.html                  웹 애플리케이션
pill_db.json               낱알식별 검색 데이터
easy_db.json               효능·주의사항 데이터
med-manifest.json          PWA manifest
vercel.json                Vercel 캐시 헤더 설정
scripts/update_pill_db.mjs DB 갱신 스크립트
tests/                     자동 테스트
.github/workflows/         월간 DB 갱신 작업
```

## 라이선스

현재 별도 오픈소스 라이선스는 지정하지 않았습니다. 제3자의 복제·수정·재배포를 허용하려면 저장소 공개 전에 적절한 `LICENSE` 파일을 추가하세요.
