# KCSI-MED

현장 의약품 사진과 처방전 정보를 바탕으로 식약처 낱알식별 데이터베이스 후보를 제시하고, 조사관의 실물 대조 및 법의학 검토를 보조하는 정적 웹 애플리케이션입니다.

현재 버전: **v12.11**

> 이 도구의 결과는 의약품 신원을 자동 확정하거나 의료적 진단을 내리는 용도가 아닙니다. 모든 후보는 포장, 처방전, 식약처 등록정보 및 실물을 조사관이 직접 대조한 후 사용해야 합니다.

## 주요 기능

- 여러 알약이 포함된 사진 및 앞·뒷면 사진 등록
- 각인, 색상, 모양을 이용한 `pill_db.json` 후보 검색
- 판독 불가·무각인·반대면 미제공 상태 구분
- 이미지 품질과 형상 충돌을 반영한 신뢰도 하향 처리
- 조사관 수동 확인 전 DUR·마약류·기저질환·종합 소견 반영 차단
- JPG·PNG·WEBP·HEIC·PDF 의료기록 입력과 브라우저 로컬 비식별화 검토
- 성명·주민번호·생년월일·주소·전화번호·환자번호 자동 마스킹 및 손가락 수동 보정
- 비식별화 확인 사본만 처방전 OCR 및 선택적 GPT Vision 연동
- 검토 완료 비식별화 사본을 기기에 별도 저장해 API 호출 없이 결과 확인 가능
- 의료기록 원본의 Worker·OpenAI·IndexedDB 전송/저장 차단
- 개인정보 이미지를 제외한 TXT 및 구조화 JSON 보고서 저장
- 식약처 낱알식별 DB 월간 갱신 GitHub Actions
- 현장 판독과 분리된 `AI 모델 비교 연구` 모드
- 알약 5개 앞·뒷면 사진 10장 일괄 등록 및 개별 촬영
- 동일 이미지·동일 프롬프트 기반 4개 모델 무작위 A–D 블라인드 평가
- 기본 `GPT-4o`, `GPT-4.1`, `GPT-5.6 Luna`, `GPT-5.6 Terra` OpenAI 모델 비교
- 인증·모델 권한·사용 한도별 즉시 호출 오류 진단과 재시도
- 6자리 PIN 로그인과 기기별 24시간 로그인 유지
- Cloudflare Worker의 서명 세션 검증 및 미로그인 API 호출 차단
- 한국시간 기준 일일 OpenAI 호출 한도(기본 40회)와 로그인 시도 제한
- 로그인 PIN과 분리된 충전 PIN으로 200회씩 하루 최대 2회 추가(최대 440회)
- 사진 10장 일괄 선택 또는 모바일 카메라 개별 촬영 및 앞·뒷면 미리보기
- CSV·TSV·XLSX·XLS·텍스트/스캔 PDF 정답지와 다중 알약 사진 데이터셋 업로드
- XLSX 정답지 템플릿과 PDF.js·Tesseract.js 브라우저 로컬 OCR 검토·수정
- 시험번호·필수 정답·이미지 파일명 중복/누락 자동 검증 및 행별 오류표
- 검증된 데이터셋 5건을 기존 블라인드 비교 배치에 자동 입력
- 식약처 공식 등록사진 고정 샘플 20건·앞뒷면 40장 자동 불러오기 및 ZIP 저장
- 연습용 `detail: low`와 정식 평가용 `detail: high` 비용 모드
- 식약처 내장 DB 교차 결과와 100점 평가표 제공
- 투표 후 모델 공개, 누적 통계 및 배치당 20행 연구용 CSV 저장
- Contract v1 Provider Registry(OpenAI·Anthropic·Gemini·Mock)와 공통 ResearchResult
- 제품명·앞/뒤 각인 CER·Brier loss·비용·강건성 자동채점 Dashboard
- 표준 CSV·6시트 XLSX·인쇄용 PDF 연구 보고서

## AI 모델 비교 연구

`/research`의 `데이터셋 검증` 화면에서는 CSV·TSV·Excel(XLSX/XLS)·PDF 정답지와 알약 앞·뒷면 사진을 여러 장 선택할 수 있습니다. 정답지는 브라우저 안에서만 파싱하며 `case_id`, 정답, 앞·뒷면 파일명, 중복 및 누락을 자동 검증합니다. PDF 텍스트 표가 없으면 PDF.js와 Tesseract.js 로컬 OCR로 자동 전환하며, 페이지 원문과 변환 표를 직접 수정·확인하기 전에는 비교 배치로 불러올 수 없습니다. 검증을 통과한 행은 5건씩 기존 4모델 블라인드 비교 화면에 자동 입력할 수 있습니다. CSV와 2시트 XLSX 템플릿은 화면에서 바로 내려받을 수 있습니다.

`식약처 공식사진 고정 샘플`의 `샘플 20건 자동 불러오기`를 누르면 정답지와 앞·뒷면 사진 40장을 같은 브라우저 메모리에서 풀어 자동 검증합니다. 고정 샘플은 5건씩 네 배치로 반복 실행할 수 있고 ZIP으로도 내려받을 수 있습니다. 원본 URL과 변환 파일 해시는 샘플의 `source_manifest.csv`에 기록됩니다. 공식 등록사진은 선명하고 표준화되어 있으므로 이 결과는 기능 및 기본 성능 확인용이며 실제 현장사진 정확도와 별도로 보고해야 합니다.

상단의 `🧪 모델 비교 연구` 탭에서 익명 배치번호와 알약 5개의 정답지를 입력합니다. 사진 10장은 `1번 앞면, 1번 뒷면, 2번 앞면, 2번 뒷면 … 5번 앞면, 5번 뒷면` 순서로 한꺼번에 선택하거나 각 칸에서 따로 촬영할 수 있습니다. 후보 모델 4개는 실행 시 무작위로 모델 A–D에 배정되며, 투표 전에는 모델 ID가 숨겨집니다.

기본 모델은 `GPT-4o`, `GPT-4.1`, `GPT-5.6 Luna`, `GPT-5.6 Terra`입니다. 각 모델에 사진 10장을 한 요청으로 보내므로 배치 한 번에 API 요청은 총 4회입니다. 현재 일일 기본 한도 40회라면 최대 10배치를 실행할 수 있습니다. 별도 충전 PIN을 입력하면 기존 사용량을 유지한 채 한도가 200회 늘어나며, 한국시간 기준 하루 최대 2회 충전해 총 440회까지 사용할 수 있습니다. `저비용 연습`은 이미지를 `detail: low`로 전송하고 모델별 최대 출력을 3,000 토큰으로 제한합니다. 작은 각인의 정식 정확도 평가에는 `detail: high`와 최대 출력 5,000 토큰을 사용하는 `정밀 비교`를 선택하세요. 이미지 입력도 토큰으로 과금되며 모델 사용 가능 여부는 OpenAI 계정 등급에 따라 다를 수 있습니다.

OpenAI 후보는 로그인된 KCSI Cloudflare Worker만 사용합니다. OpenAI API 키와 세션 서명용 비밀값은 Worker Secret에만 보관되고, 브라우저에는 24시간 뒤 만료되는 서명 세션만 저장됩니다. 현재 10장 배치 화면은 기존 비용·quota를 보존하기 위해 OpenAI 모델끼리 비교하도록 유지합니다. 공통 Provider Registry에는 Anthropic·Gemini·Mock Adapter도 포함되며, Mock은 API 비용 없는 전체 파이프라인 검증에 사용합니다. Anthropic·Gemini 실호출은 동일 PIN·quota를 적용한 Worker 공통 프록시를 추가한 뒤 활성화해야 합니다.

비교 결과는 이 브라우저의 `localStorage`에 최대 100배치 보존합니다. 원본 이미지와 API 인증정보는 누적 연구기록에 포함하지 않습니다. 기존 원본 배치 CSV는 배치마다 `5개 알약 × 4개 모델 = 20행`을 생성합니다. Contract v1 자동채점 화면에서는 표준 CSV, Summary·Model Comparison·Per Sample·Errors·Robustness·Cost 6시트 XLSX, PDF 인쇄용 보고서를 추가로 저장할 수 있습니다.

## 로컬 실행

Node.js 20 이상을 권장합니다.

```powershell
npm install
npm run build:research
npm test
npm run serve
```

브라우저에서 `http://127.0.0.1:8765`로 접속합니다.

`index.html`을 `file://` 방식으로 직접 열면 브라우저 보안 정책으로 JSON 데이터 로딩이 실패할 수 있으므로 로컬 HTTP 서버를 사용하세요.

첨부 자료의 Python 방식으로 PNG를 독립 실행하거나, 비식별화 코드·초안을 복구하는 방법은 [`docs/DEIDENTIFICATION_RECOVERY.md`](docs/DEIDENTIFICATION_RECOVERY.md)를 참고하세요. 실제 개인정보 문서와 출력 사본은 Git 저장소에 커밋하지 마세요.

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
- 일일 OpenAI 호출 한도는 기본 40회입니다. 배치 비교 1회는 네 모델을 호출하므로 4회를 사용합니다.
- OpenAI API 패널에서 로그인 PIN과 다른 6자리 충전 PIN을 입력하면 한 번에 200회, 하루 최대 2회 한도를 추가할 수 있습니다.
- 충전은 사용 횟수를 초기화하지 않고 당일 총한도를 `40 → 240 → 440`으로 늘립니다.
- 일일 한도는 한국시간 자정에 새로 계산되며 `DAILY_OPENAI_LIMIT` Worker 변수로 변경할 수 있습니다.
- PIN을 연속으로 잘못 입력하면 10분 동안 추가 시도를 제한합니다.

Cloudflare 설정과 배포 순서는 [DEPLOYMENT.md](DEPLOYMENT.md)를 참고하세요.

## 외부 서비스와 보안

- OpenAI 및 공공데이터 인증키를 Git 저장소에 커밋하지 마세요.
- 프런트엔드에는 OpenAI 키와 장기 Worker 토큰 입력란 또는 직접 OpenAI 호출 경로가 없습니다.
- 클라이언트에서 보이는 Worker 주소 자체는 비밀이 아닙니다. Worker는 허용 Origin, 24시간 서명 세션, 일일 사용량 제한을 적용합니다.
- 의료기록 원본은 브라우저 메모리에서만 열리며 로컬 OCR·사용자 검토 후 폐기됩니다. 비식별화 확인 사본만 Worker/OpenAI로 전송되고, 30분 초안에도 확인 사본만 저장됩니다.
- 비식별화는 Tesseract.js 7.0.0, PDF.js 6.2.108, heic2any 0.0.4를 필요할 때 CDN에서 받아 브라우저 안에서 실행합니다. 문서 파일 자체는 해당 CDN으로 전송되지 않습니다.
- 자동 개인정보 탐지는 누락될 수 있으므로 검토 화면에서 사용자가 직접 확인해야 `비식별화 사본 사용` 버튼이 활성화됩니다.
- AI 분석을 실행하면 등록한 의약품 이미지와 비식별화 확인된 의료기록 사본이 설정된 외부 AI 프록시로 전송될 수 있습니다.
- 월간 DB 갱신에는 GitHub Actions 저장소 Secret `DATA_GO_KR_KEY`가 필요합니다.

## 데이터 파일

- `pill_db.json`: 낱알 각인·색상·모양 후보 검색용
- `easy_db.json`: 효능 및 주의사항 지연 로드용
- `samples/KCSI_MED_MFDS_sample_20.zip`: 식약처 공식사진 기반 고정 연구 샘플 20건
- `samples/KCSI_MED_MFDS_sample_20.manifest.json`: 원본 URL·파일 해시·품목 추적 정보

두 파일은 공개 의약품 데이터로 생성된 대용량 산출물이므로 `.gitattributes`에서 GitHub diff와 언어 통계 대상에서 제외했습니다. Git LFS는 사용하지 않으며 Vercel 정적 배포에 파일 자체가 포함되어야 합니다.

## 저장소 구성

```text
index.html                  웹 애플리케이션
deidentify.js              브라우저 로컬 OCR·PDF 변환·자동/수동 개인정보 마스킹
deidentify.css             비식별화 검토 화면 스타일
tools/pii-redactor/        첨부 자료 기반 오프라인 PNG 비식별화 실행 도구
docs/                      비식별화 실행·복구·보안 운영 문서
arena.js                   블라인드 모델 비교 UI·레거시 호환 연결
arena.css                  연구 모드 전용 화면 스타일
research/contracts/        Contract v1 데이터 계약
research/runner.js         공통 Research Runner
research/arena-bridge.js   기존 Arena → Contract v1 변환
research/platform-browser.js  연구 플랫폼 브라우저 번들
providers/                 OpenAI·Anthropic·Gemini·Mock Adapter와 Registry
scoring/                   자동채점·비용·강건성 엔진
scoring/arena-rubric.js    기존 40+25+20+15 평가표 자동채점·감사 근거
reports/                   Dashboard·CSV·XLSX·PDF 보고서
samples/                   식약처 고정 샘플 ZIP과 무결성 매니페스트
scripts/build-mfds-sample-dataset.mjs  고정 샘플 재생성 스크립트
worker/worker.js           PIN 로그인·API 프록시·일일 한도 Worker
wrangler.jsonc             Cloudflare Worker 및 Durable Object 배포 설정
pill_db.json               낱알식별 검색 데이터
easy_db.json               효능·주의사항 데이터
med-manifest.json          PWA manifest
vercel.json                Vercel 캐시 헤더 설정
scripts/update_pill_db.mjs DB 갱신 스크립트
tests/                     자동 테스트 (`npm test` · 브라우저 확인은 `npm run test:browser`)
.github/workflows/         월간 DB 갱신 작업
```

## 라이선스

현재 별도 오픈소스 라이선스는 지정하지 않았습니다. 제3자의 복제·수정·재배포를 허용하려면 저장소 공개 전에 적절한 `LICENSE` 파일을 추가하세요.
