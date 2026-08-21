# KCSI-MED Research Platform v1

## 통합 구조

```text
Dataset rows / MFDS sample
  -> research/contracts GroundTruth
  -> research/runner ResearchInput
  -> providers Registry (OpenAI / Anthropic / Gemini / Mock)
  -> ResearchResult Contract v1
  -> scoring
  -> reports Result Dataset
  -> Dashboard / CSV / XLSX / PDF
```

기존 `/research`의 5알약·사진 10장·OpenAI 4모델 배치 호출은 그대로 유지한다.
`research/arena-bridge.js`가 저장된 레거시 Arena 결과와 새 Adapter 결과를 같은
Contract v1로 변환하므로 기존 기록도 자동채점·보고서에 사용할 수 있다.

## 모듈 경계

| 경로 | 책임 |
| --- | --- |
| `research/contracts/` | GroundTruth, ResearchInput, ResearchResult, ModelProvider 계약 |
| `research/runner.js` | Dataset/Contract 입력을 Registry 실행과 채점·보고서로 연결 |
| `providers/` | 공급자별 요청·응답 변환과 오류 정규화 |
| `scoring/` | 제품명, 각인 Levenshtein/CER, Brier, 완성도, 비용, 강건성 |
| `reports/` | Result Dataset, Dashboard view model, CSV, XLSX, PDF 인쇄용 HTML |
| `research/arena-bridge.js` | 기존 Arena 저장 구조를 Contract v1로 변환 |
| `research/platform-browser.js` | 위 공통 소스에서 생성한 정적 브라우저 번들 |

`arena.js`는 화면·기존 배치 실행·Adapter 호출 연결만 담당한다. Scoring과 Report는
Provider의 `choices`, `content`, `candidates`, `usageMetadata`를 직접 읽지 않는다.

## 브라우저 빌드

```bash
npm run build:research
```

빌드는 `research/browser-entry.js`에서 `research/platform-browser.js`를 만든다.
운영 배포 전에 번들을 다시 생성하고 `npm test`로 소스와 번들의 Registry·Runner를
함께 검사한다.

## `/research` 결과 화면

- 기존 블라인드 수동평가와 원본 배치 CSV를 삭제하지 않는다.
- Contract v1 자동채점 표에 Top-1, 부분정답, 앞/뒤 CER, Brier loss, 지연시간,
  비용, 강건성을 표시한다.
- 표준 CSV는 샘플별 Contract 채점 행을 내보낸다.
- XLSX는 Summary, Model Comparison, Per Sample, Errors, Robustness, Cost 시트를 만든다.
- PDF는 새 창의 인쇄 화면에서 기기의 "PDF로 저장"을 사용한다.
- Result Dataset에는 원본 사진, base64 이미지, provider raw 응답을 넣지 않는다.

## 인증·개인정보 호환성

- OpenAI Adapter는 기존 `gptFetch`와 `/openai` Worker 경로를 사용하므로 PIN,
  24시간 세션, 일일 quota, 200회×2회 충전 흐름을 유지한다.
- 데이터셋·OCR·정답지는 브라우저 메모리에서 처리한다.
- Arena 기록에는 원본 이미지가 아니라 익명 sample ID, 정답, 예측, 측정값만 남긴다.
- MockProvider는 테스트 전용이며 API 키나 네트워크를 사용하지 않는다.

## 배포 설정

현재 Cloudflare Worker 필수 Secret/Binding:

- `OPENAI_API_KEY`
- `ACCESS_TOKEN` (24자 이상 세션 서명 Secret)
- `LOGIN_PIN` (숫자 6자리)
- `REFILL_PIN` (로그인 PIN과 다른 숫자 6자리)
- `AUTH_QUOTA` Durable Object binding

선택 변수/Secret:

- `ALLOWED_ORIGINS` (운영 Vercel 주소 포함)
- `DAILY_OPENAI_LIMIT` (기본 40)
- `DATA_GO_KR_KEY` (공공데이터 API 프록시 사용 시)

Anthropic/Gemini Adapter의 실호출은 아직 운영 Worker upstream에 연결하지 않았다.
향후 `/api/research/provider`에 기존 세션·quota와 provider/model allowlist를 적용한 뒤
`ANTHROPIC_API_KEY`, `GEMINI_API_KEY`를 Worker Secret으로 추가한다. 브라우저나 Vercel
환경변수에는 공급자 API 키를 넣지 않는다.
