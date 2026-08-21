# Research Provider Adapters v1

`providers/`는 OpenAI, Anthropic, Gemini의 서로 다른 요청·응답을 Task B의
`research/contracts` Contract v1
`ResearchResult`로 정규화한다. scoring, dashboard, report 코드는 공급자 원본 응답을
읽지 않고 아래 인터페이스만 사용한다.

Task B strict validator의 기본 provider 목록에는 비용 없는 전체 파이프라인 검증을
위해 `mock`도 등록한다.

```js
const { getProvider } = require('../providers');
const provider = getProvider('anthropic');
const result = await provider.run(input, {
  model: 'claude-sonnet-4-5',
  transport: fakeOrServerTransport,
});
```

## 브라우저 보안 경계

브라우저에는 OpenAI, Anthropic, Gemini API 키를 넣지 않는다. 어댑터의
`transport`는 테스트용으로 주입하거나, 로그인 세션을 검증하는 서버/Cloudflare
Worker 프록시를 사용해야 한다. 공통 프록시 계약은 다음과 같다.

```http
POST /api/research/provider
Authorization: Bearer <24시간 KCSI 세션>
Content-Type: application/json

{
  "provider": "anthropic",
  "model": "claude-sonnet-4-5",
  "request": { "...": "provider-specific request created by the adapter" }
}
```

서버는 공급자 allowlist, 모델 allowlist, 요청 크기, token 상한, PIN 세션, 일일
quota를 검증한 뒤 서버 Secret의 키로 upstream을 호출해야 한다. 브라우저 응답에는
키나 upstream Authorization 헤더를 포함하지 않는다.

현재 OpenAI 어댑터는 기존 전역 `gptFetch`를 런타임에 찾아
`/openai` Worker 경로를 그대로 사용한다. 따라서 기존 PIN 로그인, 24시간 세션,
quota 및 200회×2회 충전 로직은 바뀌지 않는다. Anthropic/Gemini의 실제 호출은
공통 프록시가 배포되기 전까지 mock 또는 주입 transport로만 실행한다.

정적 PWA에서는 `arena.js`의 작은 loader가 provider 모듈을 순서대로 불러오고,
`providers/contract.js`가 Task B Contract v1의 브라우저 facade를 노출한다.
Node/테스트/Runner에서는 같은 파일이 `research/contracts`를 직접 불러와 canonical
normalizer와 validator를 사용한다. 구조화된 provider 오류 객체만 Task D가 보존하며,
그 외 필드 정규화 규칙은 Task B 구현을 따른다. 모듈 로딩이 실패하면 기존 OpenAI
`gptFetch` 호환 경로로 UI를 계속 설치한다.

## 서버 환경 변수

- `OPENAI_API_KEY` — 기존 Worker OpenAI 연결
- `ANTHROPIC_API_KEY` — Anthropic 서버 프록시 연결 시 추가
- `GEMINI_API_KEY` — Gemini 서버 프록시 연결 시 추가
- `ACCESS_TOKEN`, `LOGIN_PIN`, `REFILL_PIN` — 기존 KCSI 인증·quota 구조 유지

## Batch compatibility

Contract v1의 `run()`은 한 `ResearchInput`에서 한 `ResearchResult`를 반환한다.
기존 Arena의 5개 알약/10장 단일 호출을 유지하기 위해 OpenAI 어댑터만
`runBatch(inputs, config)` 호환 메서드를 추가 제공한다. batch 전체 usage는 wrapper의
`usage`에 한 번만 기록하고 각 sample result에는 반복 복제하지 않아 비용 합산의
중복을 피한다. Task B/C 통합 시 새 runner는 가능한 한 표준 `run()`을 사용한다.
