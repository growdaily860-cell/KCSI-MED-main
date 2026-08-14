# 모델 비교 자동평가

KCSI Arena 자동평가 버전은 `kcsi-arena-auto-v1`입니다. 정답지는 모델 API 요청에 넣지 않고 응답이 끝난 뒤 브라우저 안에서만 사용합니다. 원본 사진은 연구 이력과 CSV에 저장하지 않습니다.

## 100점 산식

| 지표 | 배점 | 계산 |
|---|---:|---|
| 제품명 판정 | 40 | 용량·괄호·공백·구두점을 정규화한 완전 일치 40점, 편집 유사도 0.72 이상 또는 포함 관계 20점, 그 외 0점 |
| 각인 문자 일치 | 25 | 정규화된 Levenshtein 문자 유사도의 앞·뒤 평균. 앞뒤가 뒤바뀐 결과도 비교하여 높은 방향을 사용 |
| 신뢰도 보정 | 15 | `Brier loss = (confidence - outcome)^2`, 점수는 `(1 - 평균 loss) × 15`. 완전 정답만 outcome 1이며 신뢰도 누락은 loss 1 |
| 응답 완성도 | 20 | 제품명, 앞 각인, 뒤 각인, 0–100 신뢰도, 근거 또는 불확실성의 다섯 항목 충족률 |

총점이 가장 높은 모델을 자동 우승으로 저장합니다. 1점 이내 차이는 동률입니다. 지연시간은 네트워크와 실행 환경 영향을 받으므로 점수에는 넣지 않고 CSV와 누적 표에 별도로 기록합니다.

분류 정확도는 정답 레이블과 예측 레이블의 일치 비율이라는 표준 정의를 따르며, Brier loss는 예측 확률과 실제 결과의 평균 제곱 차이입니다. 구현 참고 문서는 [scikit-learn accuracy_score](https://scikit-learn.org/stable/modules/generated/sklearn.metrics.accuracy_score.html)와 [scikit-learn brier_score_loss](https://scikit-learn.org/stable/modules/generated/sklearn.metrics.brier_score_loss.html)입니다.

## Promptfoo 연동

[Promptfoo](https://github.com/promptfoo/promptfoo)는 MIT 라이선스 오픈소스 평가 러너이며 외부 JavaScript assertion을 점수 함수로 사용할 수 있습니다. 이 저장소의 [`evaluation/promptfoo-assertion.js`](../evaluation/promptfoo-assertion.js)는 웹 화면과 같은 단일 알약 평가식을 Promptfoo `GradingResult`로 반환합니다.

Promptfoo 테스트 케이스의 `vars`에 `truthName`, `truthFront`, `truthBack`을 넣고 다음 assertion을 지정합니다.

```yaml
assert:
  - type: javascript
    value: file://evaluation/promptfoo-assertion.js
    metric: kcsi-pill-auto-score
```

Promptfoo 자체는 배포 웹앱의 필수 의존성으로 설치하지 않습니다. 운영 평가가 브라우저에서 즉시 동작하도록 하고, 연구자가 별도 Node 환경에서 대규모 회귀평가나 CI를 실행할 때 선택적으로 사용합니다. 사용자 정의 assertion은 신뢰한 저장소 코드만 실행해야 합니다.

## 해석상 주의

- 자동평가는 정답지 품질에 직접 의존합니다. 식약처 등록 제품명과 실제 앞·뒤 각인을 먼저 검증해야 합니다.
- 0.72 유사도 기준은 오탈자를 부분정답으로 분리하기 위한 연구용 규칙이며 의약품 동일성 확정 기준이 아닙니다.
- 제품명 정확도와 각인 일치도가 낮은 결과는 총점이 높더라도 현장 판독이나 의료 판단에 사용하지 않습니다.
- 표본 수가 적은 배치는 모델 성능을 대표하지 않습니다. 촬영 조건을 나눠 반복하고 CSV 원자료와 함께 보고해야 합니다.
