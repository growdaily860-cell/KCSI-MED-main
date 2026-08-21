'use strict';

// 외부 러너(Promptfoo)용 assertion이 화면 자동채점과 같은 산식을 쓰는지 확인한다.
// Promptfoo 자체는 설치하지 않는다 — GradingResult 모양과 점수만 검사한다.

const assert = require('assert');
const fs = require('fs');
const assertion = require('../evaluation/promptfoo-assertion.js');
const rubric = require('../scoring/arena-rubric.js');

const vars = {
  sample_id: 'MED-00001',
  truthName: '자이로릭정(알로푸리놀)',
  truthFront: 'Z1',
  truthBack: '100',
  truthShape: '원형',
  truthColor: '흰색',
};
const goodOutput = JSON.stringify({
  drug_name: '자이로릭정', imprint_front: 'Z1', imprint_back: '100',
  shape: '원형', color: '흰색', confidence: 90,
  evidence: '앞면 각인 Z1과 모양·색상이 정답과 일치', uncertainty: '조명 반사로 뒷면이 일부 흐림',
});

const good = assertion(goodOutput, { vars });
assert.equal(good.pass, true);
assert.ok(good.score > 0.9 && good.score <= 1, `정답 응답 점수 ${good.score}`);
assert.ok(good.reason.includes(rubric.RUBRIC_VERSION), '어떤 산식으로 매겼는지 남지 않는다');
assert.equal(good.componentResults.length, 4);
assert.ok(good.componentResults.every(item => item.score >= 0 && item.score <= 1));
assert.equal(Object.keys(good.namedScores).length, 5);

// 코드블록으로 감싼 응답도 화면과 같은 파서를 타야 한다.
const fenced = assertion('```json\n' + goodOutput + '\n```', { vars });
assert.equal(fenced.score, good.score);

// 화면 자동채점과 총점이 정확히 같아야 한다 — 산식이 갈리면 CI 점수를 믿을 수 없다.
const direct = rubric.evaluateCase(assertion.groundTruthFromVars(vars), JSON.parse(goodOutput), {});
const directTotal = direct.accuracy_score + direct.component_scores.evidence
  + direct.component_scores.hallucination + direct.component_scores.clarity;
assert.equal(good.score * 100, directTotal);

// 고신뢰 오식별은 떨어져야 한다.
const wrong = assertion(JSON.stringify({
  drug_name: '전혀다른약', imprint_front: 'XX', imprint_back: '99',
  confidence: 97, evidence: '식약처 DB에서 확인함', uncertainty: '없음',
}), { vars, dbCheck: { matched: false } });
assert.equal(wrong.pass, false);
assert.ok(wrong.score < good.score);
assert.ok(wrong.componentResults[2].score < good.componentResults[2].score, '환각 억제 감점이 반영되지 않는다');

// 정답이 없으면 0점이 아니라 "채점 보류"로 남아야 한다.
const held = assertion(goodOutput, { vars: { sample_id: 'MED-00002' } });
assert.equal(held.pass, false);
assert.equal(held.score, 0);
assert.ok(held.reason.startsWith('자동채점 보류'), '정답 누락이 모델 0점으로 기록된다');

// 깨진 응답은 예외 대신 실패 결과로 돌려줘야 러너가 배치를 멈추지 않는다.
const broken = assertion('모델이 JSON을 주지 않았다', { vars });
assert.equal(broken.pass, false);
assert.equal(broken.score, 0);

// Contract v1 vars(answer/condition) 형태도 그대로 받는다.
const contractVars = {
  sample_id: 'MED-00001',
  answer: { mfds_item_id: 'MFDS-1', drug_name: '자이로릭정(알로푸리놀)', front_imprint: 'Z1', back_imprint: '100', shape: '원형', color: '흰색' },
  condition: { expected_readable: true },
};
assert.equal(assertion(goodOutput, { vars: contractVars }).score, good.score);

// 문서가 실제 파일 경로를 가리키는지
const doc = fs.readFileSync('docs/MODEL_EVALUATION.md', 'utf8');
assert.ok(doc.includes('evaluation/promptfoo-assertion.js'));
assert.ok(doc.includes(rubric.RUBRIC_VERSION));

console.log('[promptfoo-assertion] PASS — 외부 러너 assertion이 화면 자동채점과 같은 산식·같은 총점');
