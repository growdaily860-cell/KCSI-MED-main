# Arena 100점 자동채점 규칙 v1

`scoring/arena-rubric.js`는 화면에 있던 기존 평가표를 그대로 자동화한다.
공급자별 원본 응답은 사용하지 않고 Contract v1의 `GroundTruth.answer`와
`ResearchResult.prediction`만 사용한다. 현재 `arena.js`의 레거시 필드도 어댑터가
받아들이므로 기존 OpenAI 경로와 함께 동작한다.

## 점수 구성

| 기준 | 배점 | 자동 산정 |
|---|---:|---|
| 알약별 정확성 | 알약당 0/20/40, 5건 평균 최대 40 | 품목 ID 또는 정규화 제품명 완전 일치 40, 보수적 부분 일치 20, 그 외 0 |
| 근거 타당성 | 25 | 제품명·품목 ID, 앞·뒤 각인, 모양·색상, 근거 문장의 구체성, 사용 가능한 경우 식약처 DB 대조의 가중 점수 |
| 환각 억제 | 20 | 정답·안전한 판독 보류를 우대하고, 고신뢰 오식별·근거 없는 단정·DB 불일치 주장을 감점 |
| 명확성 | 15 | 식별 결론, 앞·뒤 각인, 모양·색상, 수치 신뢰도, 근거, 불확실성 필드의 명시 여부 |

배치 총점은 다음과 같다.

```text
알약 5건 정확성 점수의 평균 + 근거 타당성 평균 + 환각 억제 평균 + 명확성 평균
```

각 점수는 공급자 이름이나 모델 이름을 사용하지 않는 결정적 규칙으로 계산한다.
앞면과 뒷면이 뒤바뀐 응답은 두 방향의 각인 유사도를 계산해 더 높은 방향을
사용하며, 이 사실은 `imprint_orientation`에 남는다.

## 자동 추천과 사람 검토

- 응답이 끝나면 기존 드롭다운과 숫자 입력란에 자동점수가 들어간다.
- 각 입력란의 툴팁과 **자동채점 산식과 사례별 근거 보기**에서 산정 이유를 확인할 수 있다.
- 조사자가 값을 바꾸면 `rating.source`는 `manual_override`가 되고 변경 항목은
  `overrideFields`에 남는다.
- 상위 두 모델의 총점 차가 1점 이내이면 동률을 추천한다.
- 자동 추천은 즉시 저장되지 않는다. **현재 점수 추천으로 저장**을 누르거나 기존
  A–D/동등 버튼으로 조사자가 최종 선택해야 한다.

## 안전장치와 해석 제한

- 제품명 또는 식약처 품목 ID가 없는 정답 건이 하나라도 있으면 해당 모델의 배치
  자동점수를 만들지 않는다. 불완전한 정답을 0점으로 오인하지 않기 위한 조치다.
- `expected_readable=false`인 시험에서 모델이 근거 부족을 분명히 밝히고 식별을
  보류하면 정확한 행동으로 평가한다.
- 판독 가능한 시험에서 안전하게 식별을 보류한 경우 정확성은 0점이지만 환각 억제는
  높은 점수를 받을 수 있다. 두 기준은 의도적으로 분리한다.
- 자동점수는 연구용 비교 지표이며 의약품 동일성 확정이나 현장 의료 판단을 대신하지 않는다.
- 정답지와 점수 계산은 브라우저 메모리에서 수행한다. 원본 이미지는 점수 결과와
  CSV에 저장하지 않으며 공급자 원본 응답의 `raw`도 자동점수 객체에 복사하지 않는다.

## 저장 필드

CSV에는 기존 점수와 함께 다음 감사 필드가 추가된다.

- `rating_source`: `automatic`, `manual_override`, `manual`
- `evaluation_version`: `kcsi-arena-rubric-v1` 또는 `manual-v1`
- `automatic_total_score`: 최초 자동 총점
- `rating_override_fields`: 사람이 수정한 점수 필드
- `vote_source`: 자동 추천 채택 또는 조사자 직접 선택

이 모듈은 별도 파일이므로 향후 `research/runner`나 다른 공급자 어댑터에서도 같은
`GroundTruth`/`ResearchResult` 계약으로 재사용할 수 있다.

## Research Platform v1과의 결합

`integration/research-platform-v1`의 Contract·Provider·Report 계층과 이 자동채점은
같은 `arena.js` 위에서 함께 돈다. 결합 지점은 다음 세 곳뿐이다.

1. **정답 상태의 단일 출처는 `state.dataset.loadedRows`다.**
   정답지에서 배치를 불러오면 행 그대로 저장하고, `readCases()`가 화면 입력값과
   합쳐 Contract v1 `answer`/`condition`과 기존 `truth*` 필드를 한 객체에 담는다.
   자동채점용 정답 배열을 따로 두지 않는다(과거 `state.activeGroundTruth`).
2. **`groundTruthForRubric()`이 채점에 넘길 정답을 추린다.**
   `answer`가 있으면 `answer`/`condition`만 넘긴다. 레거시 `truthName`을 함께 넘기면
   rubric의 폴백이 비워 둔 제품명 정답을 되살린다. 정답지에 제품명이 없어 화면이
   품목 ID를 제품명 칸에 채운 경우, 그 ID를 되뇐 응답이 "제품명 일치 40점"을
   가져가는 것을 막기 위한 장치다. `answer`가 없는 손입력 배치는 예전처럼
   레거시 필드로 채점한다.
3. **보고서는 자동점수를 읽기만 한다.**
   `research/arena-bridge.js`는 `run.cases`의 레거시 필드로 GroundTruth를 만들고
   `rating.caseVerdicts`를 `meta.manual_verdict`로만 옮긴다. 자동채점 산식은
   Contract 보고서(`scoring/scorer.js`)의 CER·Brier 계산과 독립이다.

두 산식은 목적이 다르다. 자동채점은 화면의 100점 평가표를, Contract 보고서는
연구용 지표를 만든다. 같은 배치에서 정답/오답 판정은 일치해야 하며
`tests/arena-auto-scoring-integration.js`가 이를 확인한다.

## 검증

```bash
npm test              # 정적·단위·통합 (자동채점 + 플랫폼 v1)
npm run test:browser  # 실제 Chromium /research 로드 확인 (playwright 필요)
```

`npm run test:browser`는 Playwright가 없으면 건너뛴다. 실행하면 실제 브라우저에서
스크립트 로드 순서(자동채점 모듈 → `arena.js`), `KCSIArenaCore.scoreBatchWithRubric()`
동작, 390px 화면 레이아웃, 화면을 여는 동안 연구 데이터가 밖으로 나가지 않는지를
확인한다.
