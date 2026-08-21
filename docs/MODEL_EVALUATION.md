# 모델 비교 자동평가

`/research` 화면의 100점 평가표는 `scoring/arena-rubric.js`가 자동으로 매긴다.
산식과 안전장치는 [ARENA_AUTOMATIC_RUBRIC.md](ARENA_AUTOMATIC_RUBRIC.md)에 있고,
평가 버전 문자열은 `kcsi-arena-rubric-v1`이다.

정답지는 모델 API 요청에 넣지 않는다. 응답이 끝난 뒤 브라우저 메모리에서만 쓰며
원본 사진은 연구 이력과 CSV에 저장하지 않는다.

## 두 갈래 지표를 구분할 것

| 산식 | 파일 | 쓰는 곳 |
|---|---|---|
| 100점 평가표 (정확성 40 · 근거 25 · 환각 억제 20 · 명확성 15) | `scoring/arena-rubric.js` | 화면 점수표, 자동 추천, 기존 CSV |
| 연구 지표 (top-1, 각인 CER, Brier loss, 완성도, 비용, 강건성) | `scoring/scorer.js` | Contract v1 Result Dataset, Dashboard·CSV·XLSX·PDF 보고서 |

둘은 목적이 다르므로 총점을 서로 바꿔 쓰지 않는다. 같은 배치에서 정답·오답
판정은 일치해야 하며 `tests/arena-auto-scoring-integration.js`가 이를 확인한다.

## Promptfoo 연동

[Promptfoo](https://github.com/promptfoo/promptfoo)는 MIT 라이선스 오픈소스 평가
러너이며 외부 JavaScript assertion을 점수 함수로 쓸 수 있다.
[`evaluation/promptfoo-assertion.js`](../evaluation/promptfoo-assertion.js)는 화면과
**같은** `scoring/arena-rubric.js`를 호출해 Promptfoo `GradingResult`를 돌려준다.
별도 산식을 두지 않는 이유는 단순하다 — 화면 점수와 CI 점수가 갈리면 둘 다
신뢰할 수 없다.

테스트 케이스의 `vars`에 Contract v1 `answer`(권장) 또는 기존
`truthName`/`truthFront`/`truthBack`을 넣고 다음 assertion을 지정한다.

```yaml
assert:
  - type: javascript
    value: file://evaluation/promptfoo-assertion.js
    metric: kcsi-arena-rubric-v1
```

반환값은 다음과 같다.

- `score`: 100점 만점을 0–1로 환산한 값
- `pass`: 제품명 완전 일치이면서 앞·뒤 각인 일치도가 0.8 이상일 때만 통과
- `componentResults` / `namedScores`: 정확성·근거·환각 억제·명확성 항목별 점수
- 정답 제품명과 품목 ID가 모두 없으면 0점이 아니라 **채점 보류**로 남는다.
  정답지 결함을 모델의 0점으로 기록하지 않기 위한 조치다.

Promptfoo 자체는 배포 웹앱의 의존성으로 설치하지 않는다. 운영 평가는 브라우저에서
즉시 동작해야 하고, 대규모 회귀평가나 CI는 연구자가 별도 Node 환경에서 선택적으로
돌린다. 사용자 정의 assertion은 신뢰한 저장소 코드만 실행해야 한다.

## 해석상 주의

- 자동평가는 정답지 품질에 직접 의존한다. 식약처 등록 제품명과 실제 앞·뒤 각인을
  먼저 검증해야 한다.
- 부분 일치 기준은 오탈자를 정답과 분리하기 위한 연구용 규칙이며 의약품 동일성
  확정 기준이 아니다.
- 제품명 정확도와 각인 일치도가 낮은 결과는 총점이 높더라도 현장 판독이나 의료
  판단에 사용하지 않는다.
- 표본 수가 적은 배치는 모델 성능을 대표하지 않는다. 촬영 조건을 나눠 반복하고
  CSV 원자료와 함께 보고해야 한다.
- 지연시간은 네트워크와 실행 환경 영향을 받으므로 점수에 넣지 않고 CSV와 누적
  표에 따로 기록한다.
