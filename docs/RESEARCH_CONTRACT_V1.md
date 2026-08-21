# KCSI-MED Research Contract v1

## 목적

이 문서는 `/research`의 데이터셋, Provider Adapter, scoring, dashboard, CSV/Excel/PDF report 사이에서 공유하는 **안정적인 데이터 계약**을 정의한다. Provider별 원본 API 응답은 이 계약 밖으로 노출하지 않는다.

현재 버전은 `schema_version: "1.0"`이다. v1의 필드명은 병렬 작업 간 공용 API이므로 임의로 변경하지 않는다.

## 모듈 사용

```js
const {
  normalizeGroundTruth,
  createResearchInput,
  createResearchResult,
  normalizeResearchResult,
  validateResearchResult,
  normalizeArenaBatchResults,
  ModelProvider,
} = require('./research/contracts');
```

## GroundTruth

필수 top-level 필드: `schema_version`, `sample_id`, `pill_id`, `images`, `answer`, `condition`, `notes`.

- `sample_id`: 연구 샘플의 익명 식별자. 실명, 주민번호, 사건번호를 넣지 않는다.
- `pill_id`: 데이터셋 내부 알약 식별자. 없으면 빈 문자열.
- `images.front/back`: 이미지 참조 또는 현재 브라우저 메모리의 data URL. 원본 저장 위치를 의미하지 않는다.
- `answer.mfds_item_id`: 식약처 품목 식별자.
- `answer.drug_name`: 정답 의약품명.
- `answer.front_imprint/back_imprint`: 정답 각인.
- `answer.shape/color`: 정답 외형.
- `condition.expected_readable`: 사람이 판독 가능할 것으로 기대되는지 여부.
- `condition.light/background/blur/angle`: 촬영 조건.
- `condition.variant`: 기본 `original`. 변형본이면 변형 유형.
- `notes`: 비식별 연구 메모.

`normalizeGroundTruth()`는 현재 정답지의 `case_id`, `front_image`, `back_image`, `truthName`, `truthFront`, `truthBack` 등 레거시 alias를 수용한다.

## ResearchInput

필수 top-level 필드: `schema_version`, `run_id`, `sample_id`, `images`, `options`.

- `run_id`: 한 연구 실행의 식별자.
- `sample_id`: GroundTruth와 연결되는 익명 샘플 ID.
- `images.front/back`: Provider에 전달할 앞/뒤 이미지.
- `options.cost_mode`: `practice` 또는 `research`.
- `options.detail`: `low`, `high`, `auto`.

`createResearchInput()`은 누락된 옵션에 대해 `practice` + `low`를 기본값으로 채운다.

## ResearchResult

모든 Provider Adapter가 반환해야 하는 공통 구조:

```json
{
  "schema_version": "1.0",
  "run_id": "",
  "sample_id": "",
  "provider": "",
  "model": "",
  "prediction": {
    "drug_name": "",
    "drug_code": "",
    "front_imprint": "",
    "back_imprint": "",
    "shape": "",
    "color": "",
    "confidence": null,
    "evidence": "",
    "uncertainty": ""
  },
  "usage": {
    "input_tokens": null,
    "output_tokens": null,
    "cached_tokens": null,
    "cost_usd": null
  },
  "latency_ms": 0,
  "raw": null,
  "error": null,
  "meta": {}
}
```

### null 처리

- 모델이 텍스트 필드를 반환하지 않으면 빈 문자열 `""`.
- `confidence`, usage 숫자는 알 수 없으면 `null`.
- `latency_ms`는 알 수 없으면 `0`.
- `raw`는 보존할 필요가 없거나 없으면 `null`.
- `error`는 정상 응답이면 `null`; 오류가 있으면 문자열 또는 직렬화 가능한 객체.
- `meta`는 항상 객체.

### confidence

v1의 confidence 단위는 **0~100**이다. `0`과 `100`은 유효하다. 범위를 벗어난 값은 strict validation에서 오류이며 tolerant normalization에서는 `null`로 낮춘다.

### usage

`input_tokens`, `output_tokens`, `cached_tokens`, `cost_usd`는 0 이상의 숫자 또는 `null`이다. Provider가 usage를 제공하지 않아도 결과 자체는 유효하게 유지할 수 있다.

## Strict validation과 tolerant normalization

실제 실행 경로에서는 모델 응답 일부 누락 때문에 앱 전체가 중단되지 않도록 먼저 `normalizeResearchResult()`를 사용한다. 이후 저장/채점/보고서 경계에서 `validateResearchResult()`를 사용한다.

```js
const result = normalizeResearchResult(providerResponse, {
  run_id: runId,
  sample_id: sampleId,
  provider: 'openai',
  model: 'gpt-4o',
});

const check = validateResearchResult(result);
if (!check.valid) {
  // scoring/report 저장 경로로 보내지 말고 오류 상태로 처리
}
```

기본 등록 Provider는 `openai`, `anthropic`, `gemini`다. 알 수 없는 Provider는 기본 strict validation에서 거부한다. 사내/실험 Provider를 추가할 때는 중앙 registry를 갱신하거나 `validateResearchResult(result, { allowUnknownProvider: true })`를 명시한다.

## ModelProvider 계약

JavaScript에서는 interface 대신 런타임 검증 가능한 class/duck typing을 제공한다.

```js
class OpenAIProvider extends ModelProvider {
  constructor() {
    super('openai');
  }

  async run(input, config = {}) {
    // Provider-specific request/response는 여기에서만 처리
    // 마지막 반환값은 반드시 ResearchResult
  }
}
```

최소 계약은 다음과 같다.

```ts
interface ModelProvider {
  id: string;
  run(input: ResearchInput, config?: object): Promise<ResearchResult>;
}
```

Scoring, Dashboard, Report는 OpenAI/Anthropic/Gemini의 원본 응답 구조를 참조하면 안 된다.

## 기존 arena.js 호환

현재 `arena.js`의 `callCandidate()`는 다음 레거시 구조를 반환한다.

```js
{ raw, cases, latencyMs }
```

`normalizeResearchResult()`는 이 구조를 직접 받을 수 있다. 여러 `cases`가 있는 현재 5알약 배치 결과는 `normalizeArenaBatchResults()`를 사용하면 sample별 ResearchResult 배열로 변환된다.

```js
const results = normalizeArenaBatchResults(arenaCallResult, {
  run_id: batchId,
  provider: 'openai',
  model: config.model,
});
```

레거시 배치에서 단일 `normalizeResearchResult()`만 호출하면 첫 번째 case를 선택하고 `meta.compat_source`, `meta.legacy_batch_size`, `meta.legacy_case_index`를 기록한다. 따라서 새 코드에서는 배치 전체 변환 시 `normalizeArenaBatchResults()`를 권장한다.

## Scoring Engine이 의존 가능한 필드

Scoring은 다음 Contract v1 필드만 직접 참조할 수 있다.

- `sample_id`
- `provider`
- `model`
- `prediction.drug_name`
- `prediction.drug_code`
- `prediction.front_imprint`
- `prediction.back_imprint`
- `prediction.shape`
- `prediction.color`
- `prediction.confidence`
- `prediction.evidence`
- `prediction.uncertainty`
- `usage.*`
- `latency_ms`
- `error`
- `meta`

Provider별 `choices`, `content`, `usage_metadata`, `candidates` 같은 원본 필드는 scoring/report에서 참조하지 않는다.

## schema_version 정책

- v1.x의 wire contract 값은 현재 `"1.0"`으로 고정한다.
- 필드명 삭제, 타입 변경, 의미 변경은 v1 안에서 금지한다.
- 새 선택 필드가 필요하면 우선 `meta`를 사용하거나 차기 schema에서 추가한다.
- 차기 major schema 도입 시 기존 v1 normalizer/adapter를 유지하고 migration note를 남긴다.

## 개인정보 및 원본 이미지 정책

이 Contract에 성명, 주민등록번호, 주소, 전화번호, 사건번호, 의료기록 원문 등 개인 식별정보를 넣지 않는다. `sample_id`, `run_id`, `pill_id`는 연구용 익명 ID만 사용한다.

원본 사진/의료기록은 가능한 한 브라우저 메모리에서 처리한다. `raw`에는 Provider 응답만 보관하고, 사용자 원본 이미지나 의료기록 전문을 복제해서 넣지 않는다. Report/CSV에도 원본 base64 또는 인증정보를 넣지 않는다.

## Migration note

Contract v1은 기존 `arena.js`의 `imprint_front/imprint_back`, `latencyMs`, `{raw, cases}`를 제거하지 않는다. 대신 adapter에서 새 필드 `front_imprint/back_imprint`, `latency_ms`, `prediction`으로 변환한다. 기존 UI를 대규모 수정할 필요 없이 Task C/D가 새 Contract를 먼저 채택할 수 있다.
