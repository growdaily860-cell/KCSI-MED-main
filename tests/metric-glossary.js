'use strict';

// 누적 연구결과 화면의 지표 설명. 설명이 코드와 어긋나면 없느니만 못하므로,
// 화면에 실제로 나오는 지표를 빠짐없이 덮는지와 출처 파일이 실재하는지를 검사한다.

const assert = require('assert');
const fs = require('fs');
const glossary = require('../research/metric-glossary.js');

assert.ok(glossary.METRICS.length >= 12, `지표가 ${glossary.METRICS.length}개뿐이다`);
assert.equal(new Set(glossary.METRICS.map(item => item.id)).size, glossary.METRICS.length, 'id가 중복됐다');

// 네 항목이 모두 있어야 한다 — 산출 근거 없이 숫자만 있으면 연구에 못 쓴다.
glossary.METRICS.forEach(metric => {
  // label은 화면 표 머리글 그대로라 'N'처럼 한 글자일 수 있다.
  assert.ok(String(metric.label || '').trim().length >= 1, `${metric.id}: label이 비었다`);
  ['formula', 'meaning', 'caution', 'source'].forEach(field => {
    assert.ok(String(metric[field] || '').trim().length >= 2, `${metric.id}: ${field}가 비었다`);
  });
  assert.ok(glossary.GROUPS.some(group => group.id === metric.group), `${metric.id}: 알 수 없는 그룹 ${metric.group}`);
  assert.ok(metric.formula.length >= 12, `${metric.id}: 산출 근거가 너무 짧다`);
});

// 출처로 적어 둔 파일이 실재해야 한다. 지표 구현을 옮기면 여기서 걸린다.
glossary.METRICS.forEach(metric => {
  const file = metric.source.split('·')[0].trim();
  assert.ok(fs.existsSync(file), `${metric.id}: 출처 파일 ${file}이 없다`);
});

const grouped = glossary.byGroup();
assert.equal(grouped.length, glossary.GROUPS.length);
assert.equal(grouped.reduce((sum, group) => sum + group.metrics.length, 0), glossary.METRICS.length);
assert.ok(grouped.every(group => group.note && group.label));

// 화면에 나오는 지표를 빠짐없이 설명하는지 — 표 헤더/타일 라벨과 대조한다.
const source = fs.readFileSync('arena.js', 'utf8');
const mustExplain = [
  ['experiments', '총 배치'], ['cases', '시험 알약'], ['accuracy', '전체 가중 정확도'], ['last_run', '최근 실험일'],
  ['model_n', 'N'], ['model_accuracy', '정확도'], ['model_total', '평균 총점'], ['model_wins', '승리'],
  ['top1', 'Top-1'], ['dangerous', '위험 오식별'], ['cer', 'CER'], ['brier', 'Brier'], ['cost', '비용'], ['robustness', 'robustness'],
];
mustExplain.forEach(([id, screenText]) => {
  const metric = glossary.findMetric(id);
  assert.ok(metric, `${id} 설명이 없다`);
  assert.ok(source.includes(screenText), `화면에서 사라진 지표를 설명하고 있다: ${screenText}`);
});
assert.equal(glossary.findMetric('없는지표'), null);

// 해석을 뒤집어 읽지 않도록, 낮을수록 좋은 지표는 그 사실을 밝혀야 한다.
['cer', 'brier'].forEach(id => {
  assert.match(glossary.findMetric(id).caution, /낮을수록/, `${id}: 방향(낮을수록 좋음)을 밝히지 않았다`);
});
// 가중 정확도와 Top-1이 왜 다른지 서로를 가리켜야 한다.
assert.match(glossary.findMetric('accuracy').caution, /Top-1/);
assert.match(glossary.findMetric('top1').caution, /부분정답/);
// 비용은 추정치임을 반드시 밝힌다.
assert.match(glossary.findMetric('cost').caution, /청구|다를 수 있다/);

// 화면 결선
assert.ok(source.includes('id="arenaGlossary"') && source.includes('id="arenaGlossaryBody"'), '설명 패널이 화면에 없다');
assert.ok(source.includes('renderGlossary'), '설명 렌더러가 연결되지 않았다');
const html = fs.readFileSync('index.html', 'utf8');
assert.ok(html.includes('<script src="research/metric-glossary.js"></script>'));
assert.ok(html.indexOf('research/metric-glossary.js') < html.indexOf('<script src="arena.js"></script>'));

// 문서와 화면 설명이 어긋나지 않아야 한다 — 지표를 추가하고 문서를 잊으면 여기서 걸린다.
const doc = fs.readFileSync('docs/RESEARCH_DASHBOARD_METRICS.md', 'utf8');
glossary.METRICS.forEach(metric => {
  assert.ok(doc.includes(metric.label), `문서에 ${metric.label} 설명이 없다`);
  assert.ok(doc.includes(metric.formula), `문서의 ${metric.label} 산출 근거가 화면과 다르다`);
});
assert.ok(doc.includes('kcsi_arena_batch_runs_v2'), '문서에 저장 위치가 없다');
assert.ok(/백업/.test(doc), '문서에 백업 안내가 없다');

console.log(`[metric-glossary] PASS — ${glossary.METRICS.length}개 지표 · 산출 근거/의미/해석주의/출처 · 화면 대조`);
