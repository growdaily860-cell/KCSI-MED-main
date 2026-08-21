(function initMetricGlossary(root, factory) {
  'use strict';

  const api = factory();
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
  if (root) root.KCSIMetricGlossary = api;
})(typeof globalThis !== 'undefined' ? globalThis : this, function createMetricGlossary() {
  'use strict';

  // 누적 연구결과 화면에 나오는 숫자마다 "무엇으로 계산했고, 무엇을 뜻하고,
  // 무엇을 뜻하지 않는지"를 한곳에 적어 둔다. 근거 없는 숫자는 연구에 쓸 수 없다.
  //
  // formula는 실제 구현과 일치해야 한다. 출처 파일을 source에 적어 두고
  // tests/metric-glossary.js가 그 파일이 존재하는지 확인한다.

  const GROUPS = [
    { id: 'summary', label: '누적 요약', note: '저장된 모든 배치를 합산한 값입니다.' },
    { id: 'model', label: '모델별 누적 성과', note: '기존 블라인드 100점 평가표를 모델별로 합산합니다.' },
    { id: 'condition', label: '촬영 조건별', note: '같은 모델이라도 사진 조건에 따라 결과가 달라지는지 봅니다.' },
    { id: 'contract', label: 'Contract v1 연구지표', note: '정답지와 응답을 공통 계약으로 변환해 계산한 학술용 지표입니다.' },
  ];

  const METRICS = [
    {
      id: 'experiments', group: 'summary', label: '총 배치',
      formula: '저장된 배치 수. 배치 1건 = 알약 5개 × 모델 4개 = 응답 20건.',
      meaning: '표본의 크기. 배치가 적으면 아래 모든 비율이 우연히 흔들린다.',
      caution: '배치 수가 5건(알약 25개) 미만이면 모델 간 순위를 말하지 않는 편이 낫다.',
      source: 'arena.js · summarizeRuns',
    },
    {
      id: 'cases', group: 'summary', label: '시험 알약',
      formula: '총 배치 × 5. 배치 하나는 언제나 알약 5개로 고정한다.',
      meaning: '몇 개의 알약 문제를 냈는지.',
      caution: '같은 알약을 여러 배치에서 반복 출제했다면 서로 독립인 표본이 아니다.',
      source: 'arena.js · summarizeRuns',
    },
    {
      id: 'accuracy', group: 'summary', label: '전체 가중 정확도',
      formula: '알약별 정확성 점수 ÷ 40 을 더해 채점된 알약 수로 나눈 뒤 100을 곱한다. 판정의 기본 배점은 정답 40 · 부분정답 20 · 오답 0이고, 조사자가 알약별 점수칸에 직접 적은 값이 있으면 그 값을 쓴다.',
      meaning: '모든 모델·모든 알약을 합친 평균 식별 성적.',
      caution: '부분정답을 0.5로 세기 때문에 "정확히 맞힌 비율"보다 높게 나온다. 정확히 맞힌 비율은 Contract v1의 Top-1 Accuracy를 봐야 한다.',
      source: 'arena.js · accuracyFromVerdict',
    },
    {
      id: 'last_run', group: 'summary', label: '최근 실험일',
      formula: '가장 마지막에 저장된 배치의 실행 시각.',
      meaning: '이 누적치가 언제까지의 기록인지.',
      caution: '모델은 예고 없이 갱신된다. 오래된 기록과 최근 기록을 한 표에 합치면 같은 모델이라도 다른 대상일 수 있다.',
      source: 'arena.js · renderDashboard',
    },

    {
      id: 'model_n', group: 'model', label: 'N',
      formula: '그 모델에 대해 정확성 판정이 매겨진 알약 응답 수.',
      meaning: '그 모델의 표본 크기.',
      caution: '모델마다 N이 다르면 정확도를 나란히 비교하기 어렵다. 호출 실패한 배치는 채점되지 않아 N이 줄어든다.',
      source: 'arena.js · summarizeRuns',
    },
    {
      id: 'model_accuracy', group: 'model', label: '정확도',
      formula: '전체 가중 정확도와 같은 방식을 그 모델의 응답에만 적용. 알약별로 직접 적은 점수가 있으면 그 값이 판정 배점보다 우선한다.',
      meaning: '그 모델이 얼마나 자주 맞혔는지.',
      caution: '정답지 품질에 직접 의존한다. 식약처 등록 제품명·각인이 틀리면 이 값도 틀린다.',
      source: 'arena.js · summarizeRuns',
    },
    {
      id: 'model_total', group: 'model', label: '평균 총점',
      formula: '배치 100점 총점의 평균. 총점 = 알약 5개 정확성 평균(0~40) + 근거 타당성(0~25) + 환각 억제(0~20) + 명확성(0~15). 알약별 점수는 판정 배점(40/20/0)이 기본이고 조사자가 0~40 사이로 고칠 수 있다.',
      meaning: '맞혔는지뿐 아니라 근거를 댔는지, 모르면 모른다고 했는지, 형식을 갖췄는지까지 합친 종합 점수.',
      caution: '정확도가 낮아도 총점이 높을 수 있다. 판독을 보류하면 정확성은 0점이지만 환각 억제는 높게 받는다 — 두 기준은 의도적으로 분리했다.',
      source: 'scoring/arena-rubric.js',
    },
    {
      id: 'model_wins', group: 'model', label: '승리 / 동률',
      formula: '조사자가 그 모델을 최종 선택한 배치 수 / 동등으로 저장한 배치 수.',
      meaning: '사람이 내린 최종 판단의 누적.',
      caution: '자동 추천을 그대로 채택했다면 사람의 독립적 판단이 아니다. CSV의 vote_source로 구분할 수 있다.',
      source: 'arena.js · finalizeVote',
    },

    {
      id: 'condition_clarity', group: 'condition', label: '각인 선명도별 정확도',
      formula: '알약별 정확성 점수를 선명도(각인 명확/불명확 등) 버킷으로 나눠 평균.',
      meaning: '사진이 나쁠 때 성능이 얼마나 떨어지는지.',
      caution: '식약처 공식 등록사진은 조명·배경이 고르다. 현장 사진의 난이도를 대표하지 않는다.',
      source: 'arena.js · summarizeRuns',
    },

    {
      id: 'top1', group: 'contract', label: 'Top-1 Accuracy',
      formula: '정규화한 제품명이 정확히 일치한 응답 수 ÷ 전체 응답 수. 부분정답은 세지 않는다.',
      meaning: '엄격한 의미의 식별 성공률.',
      caution: '위쪽 "전체 가중 정확도"보다 낮게 나오는 것이 정상이다. 부분정답을 빼기 때문이다.',
      source: 'scoring/summary.js · top1_accuracy',
    },
    {
      id: 'dangerous', group: 'contract', label: '위험 오식별',
      formula: '오답이면서 제품명을 구체적으로 제시했고 신뢰도가 0.8 이상인 응답의 수.',
      meaning: '틀렸는데 확신에 차서 약 이름을 댄 횟수. 현장에서 가장 위험한 실패 유형이다.',
      caution: '0이라고 안전한 모델이라는 뜻은 아니다. 표본이 작으면 그냥 안 나타난 것일 수 있다.',
      source: 'scoring/confidence.js · isHighConfidenceMisidentification',
    },
    {
      id: 'cer', group: 'contract', label: '앞면 / 뒷면 imprint CER',
      formula: '정답 각인과 응답 각인의 편집거리(Levenshtein) ÷ 정답 각인 글자 수. 앞뒤가 바뀐 응답은 두 방향을 계산해 더 나은 쪽을 쓴다.',
      meaning: '각인 글자를 얼마나 틀렸는지. 0이면 완전 일치, 1이면 정답 길이만큼 틀렸다.',
      caution: '낮을수록 좋다 — 정확도와 방향이 반대다. 정답 각인이 비어 있는 민면은 응답이 비어야 0이 된다.',
      source: 'scoring/imprint.js · cer',
    },
    {
      id: 'brier', group: 'contract', label: 'Brier loss',
      formula: '(모델이 말한 신뢰도 − 실제 정답 여부)². 정답이면 실제값 1, 아니면 0. 응답별로 구해 평균.',
      meaning: '모델의 자신감이 실제 실력과 맞는지. 낮을수록 잘 보정된 것이다.',
      caution: '낮을수록 좋다. 신뢰도를 아예 말하지 않은 응답은 계산에서 빠지므로, 신뢰도를 잘 안 내놓는 모델은 값이 유리하게 보일 수 있다.',
      source: 'scoring/confidence.js · brierLoss',
    },
    {
      id: 'cost', group: 'contract', label: '총 비용',
      formula: '응답의 입력·출력·캐시 토큰 수에 모델별 단가표를 곱해 합산. 공급자가 비용을 직접 준 경우 그 값을 쓴다.',
      meaning: '이 누적 실험에 든 API 비용의 추정치.',
      caution: '단가표(pricing/model-pricing.js)는 사람이 적어 둔 값이라 실제 청구액과 다를 수 있다. 이미지 토큰 산정 방식도 공급자마다 다르다. 발표용이라면 청구서로 검증할 것.',
      source: 'scoring/cost.js · pricing/model-pricing.js',
    },
    {
      id: 'robustness', group: 'contract', label: 'robustness score',
      formula: '같은 알약의 원본 사진과 변형 사진(흐림·각도 등)을 비교해 0.7 × 변형 정확도 + 0.3 × 원본과 같은 답을 낸 비율.',
      meaning: '사진 조건이 나빠져도 답이 흔들리지 않는 정도.',
      caution: '정답지에 variant(변형본) 행이 있어야 계산된다. 고정 샘플은 모두 original이라 값이 비어 있는 것이 정상이다.',
      source: 'scoring/robustness.js · calculateRobustness',
    },
  ];

  function byGroup() {
    return GROUPS.map(group => ({ ...group, metrics: METRICS.filter(metric => metric.group === group.id) }));
  }

  function findMetric(id) {
    return METRICS.find(metric => metric.id === id) || null;
  }

  return { GROUPS, METRICS, byGroup, findMetric };
});
