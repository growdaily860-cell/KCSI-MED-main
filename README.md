# KCSI-MED

현장 의약품 사진과 처방전 정보를 바탕으로 식약처 낱알식별 데이터베이스 후보를 제시하고, 조사관의 실물 대조 및 법의학 검토를 보조하는 정적 웹 애플리케이션입니다.

현재 버전: **v12.3**

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
- 현장 판독과 분리된 `AI 모델 비교 연구` 모드
- 동일 이미지·동일 프롬프트 기반 무작위 A/B 블라인드 평가
- 기존 Worker와 호환되는 기본 `GPT-4o mini` 대 `GPT-4.1 mini` 저비용 OpenAI 모델 비교
- 인증·모델 권한·사용 한도별 즉시 호출 오류 진단과 재시도
- 6자리 PIN 로그인과 기기별 24시간 로그인 유지
- Cloudflare Worker의 서명 세션 검증 및 미로그인 API 호출 차단
- 한국시간 기준 일일 OpenAI 호출 한도(기본 40회)와 로그인 시도 제한
- 사진 선택·모바일 카메라 촬영 및 앞·뒷면 미리보기
- 연습용 `detail: low`와 정식 평가용 `detail: high` 비용 모드
- 식약처 내장 DB 교차 결과와 100점 평가표 제공
- 투표 후 모델 공개, 누적 통계 및 연구용 CSV 저장

## AI 모델 비교 연구

상단의 `🧪 모델 비교 연구` 탭에서 익명 시험번호, 사진 조건, 식약처로 확인한 정답지를 입력합니다. 후보 모델 두 개를 설정하면 실행 시 무작위로 모델 A/B에 배정되며, 투표 전에는 제공자와 모델 ID가 숨겨집니다.

처음 열면 `GPT-4o mini`와 `GPT-4.1 mini`가 선택됩니다. 두 모델 모두 이미지 입력과 Chat Completions 요청을 지원하므로 기존 KCSI Cloudflare Worker를 그대로 사용합니다. `저비용 연습`은 각 사진을 OpenAI의 `detail: low`로 전송하고 모델별 최대 출력을 1,200 토큰으로 제한합니다. 비교 1회마다 두 모델을 각각 호출하므로 API 요청은 2회 발생하며, 이미지 입력도 토큰으로 과금됩니다. 작은 각인의 정식 정확도 평가에는 비용이 더 드는 `정밀 비교`를 선택하세요.

OpenAI 후보는 로그인된 KCSI Cloudflare Worker만 사용합니다. OpenAI API 키와 세션 서명용 비밀값은 Worker Secret에만 보관되고, 브라우저에는 24시간 뒤 만료되는 서명 세션만 저장됩니다. 현재 연습판은 OpenAI 모델끼리 비교하도록 잠겨 있으며, Gemini·Qwen은 나중에 제공자 키를 Worker Secret으로 연결한 뒤 추가할 수 있습니다.

비교 결과는 이 브라우저의 `localStorage`에 최대 300회 보존합니다. 원본 이미지와 API 인증정보는 누적 연구기록에 포함하지 않습니다. 브라우저 데이터 삭제나 기기 변경 전에는 `연구데이터 CSV 저장`으로 내보내세요.

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

테스트 항목에는 초기화 순서, DOM 로드, 자동 DB 결과 안전 게이트, 수동 확인 상태, T/1 혼동 각인, 업로드 버튼 범위, 블라인드 무작위 배정, 평가 점수·통계·CSV 안전성, PIN·서명 세션·일일 한도·미로그인 차단 및 기존 각인·색상 회귀 사례가 포함됩니다.

## Vercel 배포

이 프로젝트는 빌드 단계가 필요 없는 정적 사이트입니다.

- Framework Preset: `Other`
- Root Directory: `.`
- Build Command: 비움
- Output Directory: `.`
- Production Branch: `main`

기존 `kcsi-med.vercel.app` 주소를 유지하려면 새 프로젝트를 만들지 말고 기존 Vercel 프로젝트의 `Settings → Git`에서 이 저장소를 연결하세요.

상세 절차와 배포 후 점검 항목은 [DEPLOYMENT.md](DEPLOYMENT.md)를 참고하세요.

## 로그인형 배포판

- 휴대폰과 태블릿에서 같은 주소에 접속하고 로그인 화면의 `이 기기에 앱 설치` 또는 브라우저의 `홈 화면에 추가`를 선택하면 세로·가로 화면에서 앱처럼 실행됩니다.
- 기기마다 최초 한 번 6자리 PIN을 입력하며, 로그인 상태는 해당 브라우저에서 24시간 유지됩니다.
- 미로그인 요청은 OpenAI 판독과 식약처 API 모두 Worker에서 거부합니다.
- 일일 OpenAI 호출 한도는 기본 40회입니다. 모델 비교 1회는 두 모델을 호출하므로 2회를 사용합니다.
- 일일 한도는 한국시간 자정에 새로 계산되며 `DAILY_OPENAI_LIMIT` Worker 변수로 변경할 수 있습니다.
- PIN을 연속으로 잘못 입력하면 10분 동안 추가 시도를 제한합니다.

Cloudflare 설정과 배포 순서는 [DEPLOYMENT.md](DEPLOYMENT.md)를 참고하세요.

## 외부 서비스와 보안

- OpenAI 및 공공데이터 인증키를 Git 저장소에 커밋하지 마세요.
- 프런트엔드에는 OpenAI 키와 장기 Worker 토큰 입력란 또는 직접 OpenAI 호출 경로가 없습니다.
- 클라이언트에서 보이는 Worker 주소 자체는 비밀이 아닙니다. Worker는 허용 Origin, 24시간 서명 세션, 일일 사용량 제한을 적용합니다.
- AI 분석을 실행하면 등록한 의약품 이미지가 설정된 외부 AI 프록시로 전송될 수 있습니다.
- 월간 DB 갱신에는 GitHub Actions 저장소 Secret `DATA_GO_KR_KEY`가 필요합니다.

## 데이터 파일

- `pill_db.json`: 낱알 각인·색상·모양 후보 검색용
- `easy_db.json`: 효능 및 주의사항 지연 로드용

두 파일은 공개 의약품 데이터로 생성된 대용량 산출물이므로 `.gitattributes`에서 GitHub diff와 언어 통계 대상에서 제외했습니다. Git LFS는 사용하지 않으며 Vercel 정적 배포에 파일 자체가 포함되어야 합니다.

## 저장소 구성

```text
index.html                  웹 애플리케이션
arena.js                   블라인드 모델 비교·채점·통계
arena.css                  연구 모드 전용 화면 스타일
worker/worker.js           PIN 로그인·API 프록시·일일 한도 Worker
wrangler.jsonc             Cloudflare Worker 및 Durable Object 배포 설정
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
