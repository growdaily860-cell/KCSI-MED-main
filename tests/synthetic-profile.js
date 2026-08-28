const fs = require('fs');
const assert = require('assert');
const profile = require('../deident/synthetic-profile.js');

// ── 1. 주민등록번호 안전성은 값으로 확인한다 ────────────────────────────────
// "합성값입니다"는 주장일 뿐이다. 월·일이 실재할 수 없는 조합인지 세어야 근거가 된다.
const safe = profile.checkRrnValues(['831337-2102947', '971335-4213813']);
assert.strictEqual(safe.checked, 2);
assert.strictEqual(safe.impossible, 2);
assert.strictEqual(safe.safe, true);

const risky = profile.checkRrnValues(['831337-2102947', '860813-1234567']);
assert.strictEqual(risky.safe, false, '실재할 수 있는 월·일 조합을 안전하다고 말하면 안 된다');
assert.strictEqual(risky.impossible, 1);
assert.deepStrictEqual(risky.possible, ['860813-1234567'], '문제가 되는 값을 짚어 주지 않는다');
assert.strictEqual(profile.checkRrnValues([]).safe, false, '표본이 없으면 안전하다고 말할 수 없다');
// 자릿수가 모자란 값은 검사하지 못한 것이므로 안전 쪽으로 세면 안 된다.
assert.strictEqual(profile.checkRrnValues(['12345']).safe, false);

// ── 2. 정답지에서 세트 구성을 뽑는다 ────────────────────────────────────────
const sheet = {
  per_condition: 1,
  conditions: [
    { id: 'original', label: '정상 스캔', kind: 'original' },
    { id: 'fold', label: '접힘', kind: 'shading' },
    { id: 'skew5', label: '기울어짐 5°', kind: 'geometry', angle: 5 },
  ],
  documents: [
    { doc_id: 'D1', form: 'diagnosis', form_label: '진단서', condition: 'original', condition_label: '정상 스캔', items: [
      { type: '성명', label: '환자 성명', value: '김하늘' },
      { type: '성명', label: '담당의사', value: '조은결' },
      { type: '주민등록번호', label: '주민등록번호', value: '831337-2102947' },
    ] },
    { doc_id: 'D2', form: 'diagnosis', form_label: '진단서', condition: 'fold', condition_label: '접힘', items: [
      { type: '성명', label: '환자 성명', value: '박서준' },
      { type: '성명', label: '담당의사', value: '조은결' },
      { type: '주민등록번호', label: '주민등록번호', value: '971335-4213813' },
    ] },
    { doc_id: 'D3', form: 'lab', form_label: '검사결과지', condition: 'skew5', condition_label: '기울어짐 5°', items: [
      { type: '개인식별번호', label: '검사번호', value: 'P-100001' },
    ] },
  ],
};
const described = profile.describeSyntheticSet(sheet);
assert.strictEqual(described.available, true);
assert.strictEqual(described.docs, 3);
assert.strictEqual(described.items, 7);

// 서식 안에서 같은 종류라도 칸이 다르면 따로 세야 한다. 환자 이름과 의사 이름을
// "성명 4개"로 합치면 무엇을 합성했는지가 사라진다.
const diagnosis = described.forms.find(form => form.id === 'diagnosis');
assert.strictEqual(diagnosis.docs, 2);
const patient = diagnosis.fields.find(field => field.label === '환자 성명');
const doctor = diagnosis.fields.find(field => field.label === '담당의사');
assert.ok(patient && doctor, '같은 종류의 서로 다른 칸을 하나로 합쳤다');
assert.strictEqual(patient.distinct, 2);
assert.strictEqual(doctor.distinct, 1, '의사 이름이 한 종류뿐인 사실이 드러나지 않는다');
assert.ok(patient.samples.includes('김하늘'), '합성값 예시를 보여주지 않는다');

// ── 3. 촬영 조건이 실제 왜곡인지 흉내인지 구분한다 ──────────────────────────
const fold = described.conditions.find(row => row.id === 'fold');
const skew = described.conditions.find(row => row.id === 'skew5');
assert.strictEqual(fold.kind, 'shading');
assert.strictEqual(fold.kindLabel, '음영 합성', '접힘을 실제 종이 왜곡처럼 보이게 하면 안 된다');
assert.strictEqual(skew.kind, 'geometry');
assert.ok(/회전 5°/.test(skew.detail), '팩이 적어 준 회전 각도를 쓰지 않는다');

// 팩이 분류를 적어 주지 않은 옛 정답지는 조건 id로 되짚는다.
// 되짚기 표 전체를 확인한다 — 한 줄만 검사하면 나머지가 틀려도 통과한다.
const FALLBACK_KINDS = {
  original: 'original',
  fold: 'shading',
  crumple: 'shading',
  lowlight: 'shading',
  noise: 'noise',
  lowres: 'resolution',
  skew5: 'geometry',
  skew15: 'geometry',
};
Object.entries(FALLBACK_KINDS).forEach(([id, kind]) => {
  const rows = profile.describeSyntheticSet({
    // conditions 블록을 통째로 빼서 팩이 아무것도 선언하지 않은 상태를 만든다.
    documents: [{ doc_id: `L-${id}`, form: 'x', condition: id, items: [] }],
  }).conditions;
  assert.strictEqual(rows[0].kind, kind, `옛 팩의 ${id} 조건을 ${kind}로 분류하지 못한다`);
});
// 음영으로 흉내 낸 조건을 실제 기하 왜곡으로 분류하면 발표에서 성능을 과장하게 된다.
assert.notStrictEqual(FALLBACK_KINDS.fold, 'geometry');

// 모르는 조건을 아는 척하면 안 된다.
const unknown = profile.describeSyntheticSet({
  conditions: [{ id: 'coffee-stain', label: '커피 얼룩' }],
  documents: [{ doc_id: 'U1', form: 'x', condition: 'coffee-stain', items: [] }],
}).conditions;
assert.strictEqual(unknown[0].kind, 'unknown');
assert.strictEqual(unknown[0].kindLabel, '분류되지 않음');

// ── 4. 이 세트로 말할 수 없는 것 ────────────────────────────────────────────
const caveats = described.caveats.join(' ');
assert.ok(/음영/.test(caveats), '음영으로 흉내 낸 조건임을 밝히지 않는다');
assert.ok(/기하 왜곡/.test(caveats), '기하 왜곡이 어느 조건에만 있는지 밝히지 않는다');
assert.ok(/개인정보 항목만/.test(caveats), '정답지가 개인정보 항목만 담는다는 사실을 밝히지 않는다');

// 라벨·값이 없는 옛 정답지는 무엇을 합성했는지 설명할 수 없다고 알려야 한다.
const legacy = profile.describeSyntheticSet({
  documents: [{ doc_id: 'L1', form: 'x', condition: 'original', items: [{ type: '성명', box: { x: 0, y: 0, w: 1, h: 1 } }] }],
});
assert.strictEqual(legacy.hasValues, false);
assert.ok(legacy.caveats.some(line => /라벨·값이 없어/.test(line)), '설명할 수 없다는 사실을 알리지 않는다');

// 값 가짓수가 적은 칸은 짚어 줘야 한다 — 같은 이름이 반복되면 수치는 그 이름에 대한 것이다.
const thinSheet = {
  documents: Array.from({ length: 24 }, (_, index) => ({
    doc_id: `T${index}`, form: 'f', form_label: '서식', condition: 'original',
    items: [
      { type: '성명', label: '담당의사', value: index % 2 ? '조은결' : '남기훈' },
      { type: '전화번호', label: '연락처', value: `010-0000-${String(1000 + index)}` },
    ],
  })),
};
const thin = profile.describeSyntheticSet(thinSheet);
const thinCaveat = thin.caveats.find(line => /가짓수가 적은 칸/.test(line));
assert.ok(thinCaveat, '값이 두 종류뿐인 칸을 짚어 주지 않는다');
assert.ok(/담당의사 2종/.test(thinCaveat));
assert.ok(!/연락처/.test(thinCaveat), '값이 매번 다른 칸까지 적다고 말하면 경고가 무뎌진다');

// ── 5. 문장 ────────────────────────────────────────────────────────────────
const sentences = profile.profileSentences(described).join(' ');
assert.ok(/서식 2종/.test(sentences), '서식 수가 문장에 없다');
assert.ok(/3건/.test(sentences), '표본 수가 문장에 없다');
assert.ok(/발급될 수 없는 번호/.test(sentences), '주민등록번호 안전성을 밝히지 않는다');
assert.ok(/기하 왜곡이 있는 것은 기울어짐 5°뿐/.test(sentences), '실제 왜곡 조건을 짚지 않는다');
assert.deepStrictEqual(profile.profileSentences(null), ['불러온 합성 문서 세트가 없습니다.']);
assert.strictEqual(profile.describeSyntheticSet({ documents: [] }).available, false);

// ── 6. 커밋된 팩 ───────────────────────────────────────────────────────────
const manifest = JSON.parse(fs.readFileSync('samples/KCSI_MED_synthetic_docs.manifest.json', 'utf8'));
const real = profile.describeSyntheticSet(manifest);
assert.strictEqual(real.docs, manifest.document_count);
assert.strictEqual(real.items, manifest.item_count);
assert.strictEqual(real.hasValues, true, '커밋된 정답지에 라벨·값이 없다');
assert.strictEqual(
  real.rrn.safe,
  true,
  `커밋된 팩에 실제로 발급될 수 있는 주민등록번호가 있다: ${real.rrn.possible.join(', ')}`
);
assert.ok(real.conditions.every(row => row.kind !== 'unknown'), '분류되지 않은 촬영 조건이 있다');
assert.ok(
  real.conditions.filter(row => row.kind === 'geometry').length === 2,
  '기하 왜곡 조건이 기울어짐 2종이 아니다'
);

console.log('[synthetic-profile] PASS — 합성값 검증 · 칸 단위 구성 · 조건 분류 · 표본 한계 · 커밋된 팩');
