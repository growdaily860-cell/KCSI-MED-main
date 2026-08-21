'use strict';

// 100건 이상 데이터셋에서 무작위로 5건씩 출제하는 로직을 검사한다.
// 요구는 세 가지다 — 같은 바퀴에서 중복 없음, 전량 순회, seed로 재현 가능.

const assert = require('assert');
const fs = require('fs');
const arena = require('../arena.js');

const SIZE = arena.CASE_COUNT;
assert.equal(SIZE, 5);

// ── 1. 시드 난수 ────────────────────────────────────────────────────────────
const first = arena.seededRandom('KCSI-1');
const second = arena.seededRandom('KCSI-1');
const other = arena.seededRandom('KCSI-2');
const streamA = Array.from({ length: 8 }, () => first());
const streamB = Array.from({ length: 8 }, () => second());
assert.deepEqual(streamA, streamB, '같은 seed는 같은 수열을 내야 한다');
assert.notDeepEqual(streamA, Array.from({ length: 8 }, () => other()), '다른 seed가 같은 수열을 냈다');
assert.ok(streamA.every(value => value >= 0 && value < 1), '난수가 0~1 범위를 벗어났다');

// seed 문자열은 사람이 받아 적는 값이라 헷갈리는 글자를 쓰지 않는다.
const seed = arena.randomSeedText();
assert.match(seed, /^[A-HJ-NP-Z2-9]{6}$/, `seed 형식이 예상과 다르다: ${seed}`);
assert.equal(new Set(Array.from({ length: 40 }, () => arena.randomSeedText())).size > 30, true, 'seed가 충분히 흩어지지 않는다');

// ── 2. 섞기 ────────────────────────────────────────────────────────────────
const shuffled = arena.shuffledIndices(120, arena.seededRandom('SHUF'));
assert.equal(shuffled.length, 120);
assert.equal(new Set(shuffled).size, 120, '섞은 결과에 중복이 있다');
assert.deepEqual([...shuffled].sort((a, b) => a - b), Array.from({ length: 120 }, (_, index) => index));
assert.notDeepEqual(shuffled, Array.from({ length: 120 }, (_, index) => index), '전혀 섞이지 않았다');
assert.deepEqual(arena.shuffledIndices(120, arena.seededRandom('SHUF')), shuffled, '같은 seed인데 다르게 섞였다');
assert.deepEqual(arena.shuffledIndices(0), []);
assert.deepEqual(arena.shuffledIndices(-3), []);

// ── 3. 한 바퀴 안에서는 중복 없이 전량 순회 ────────────────────────────────
const total = 120;
const queue = arena.createRandomBatchQueue(total, 'ROUND1');
const seen = [];
const perRound = Math.floor(total / SIZE);
for (let index = 0; index < perRound; index += 1) {
  const draw = arena.drawRandomBatch(queue, SIZE);
  assert.equal(draw.indices.length, SIZE);
  assert.equal(draw.round, 1, '한 바퀴가 끝나기 전에 회차가 넘어갔다');
  assert.equal(draw.draw, index + 1);
  assert.equal(draw.drawsPerRound, perRound);
  assert.equal(draw.remaining, total - (index + 1) * SIZE);
  assert.ok(draw.indices.every(value => Number.isInteger(value) && value >= 0 && value < total));
  seen.push(...draw.indices);
}
assert.equal(seen.length, total);
assert.equal(new Set(seen).size, total, '한 바퀴 안에서 같은 알약이 두 번 나왔다');

// 바퀴를 다 돌면 새로 섞어 다음 바퀴를 시작한다.
const next = arena.drawRandomBatch(queue, SIZE);
assert.equal(next.round, 2);
assert.equal(next.draw, perRound + 1);
assert.equal(next.remaining, total - SIZE);

// ── 4. seed 재현 — 배치 ID에 남긴 seed로 같은 문제를 다시 뽑을 수 있어야 한다 ──
const replay = arena.createRandomBatchQueue(total, 'ROUND1');
const replayed = [];
for (let index = 0; index < perRound; index += 1) replayed.push(...arena.drawRandomBatch(replay, SIZE).indices);
assert.deepEqual(replayed, seen, 'seed가 같은데 다른 문제가 나왔다');

const different = arena.createRandomBatchQueue(total, 'OTHER1');
assert.notDeepEqual(arena.drawRandomBatch(different, SIZE).indices, seen.slice(0, SIZE));

// seed를 주지 않으면 매번 새로 만든다.
const auto1 = arena.createRandomBatchQueue(total);
const auto2 = arena.createRandomBatchQueue(total);
assert.match(auto1.seed, /^[A-HJ-NP-Z2-9]{6}$/);
assert.notEqual(auto1.seed, auto2.seed, '자동 seed가 매번 같다');
assert.equal(arena.createRandomBatchQueue(total, ' abc123 ').seed, 'ABC123', 'seed는 대문자로 정규화해야 한다');

// ── 5. 데이터가 모자라면 뽑지 않는다 ───────────────────────────────────────
assert.equal(arena.drawRandomBatch(arena.createRandomBatchQueue(4, 'SMALL'), SIZE), null);
assert.equal(arena.drawRandomBatch(null, SIZE), null);
const exact = arena.createRandomBatchQueue(5, 'EXACT');
assert.equal(arena.drawRandomBatch(exact, SIZE).indices.length, 5);
assert.equal(arena.drawRandomBatch(exact, SIZE).round, 2, '5건짜리는 매번 새 바퀴여야 한다');

// 20건짜리 기존 고정 샘플도 그대로 돌아가야 한다(하위호환).
const legacy = arena.createRandomBatchQueue(20, 'LEGACY');
const legacySeen = [];
for (let index = 0; index < 4; index += 1) legacySeen.push(...arena.drawRandomBatch(legacy, SIZE).indices);
assert.equal(new Set(legacySeen).size, 20);

// ── 6. 쏠림 확인 — 특정 알약만 계속 나오면 무작위 출제가 아니다 ────────────
const spread = arena.createRandomBatchQueue(total, 'SPREAD');
const counts = new Array(total).fill(0);
for (let index = 0; index < perRound * 10; index += 1) {
  arena.drawRandomBatch(spread, SIZE).indices.forEach(value => { counts[value] += 1; });
}
assert.ok(counts.every(count => count === 10), '바퀴마다 전량 순회하므로 출제 횟수가 모두 같아야 한다');

// ── 7. 화면 결선 ───────────────────────────────────────────────────────────
const source = fs.readFileSync('arena.js', 'utf8');
assert.ok(source.includes('id="arenaDatasetRandomBatch"'), '랜덤 뽑기 버튼이 없다');
assert.ok(source.includes('id="arenaDatasetRandomNote"'), '무작위 출제 안내 자리가 없다');
assert.ok(source.includes('loadRandomDatasetBatch'), '랜덤 뽑기 진입점이 없다');
assert.ok(source.includes('id="arenaDatasetSampleLoadExtended"'), '확장 샘플 불러오기 버튼이 없다');
assert.ok(source.includes('id="arenaDatasetSampleSet"'), '확장 세트 선택이 없다');
assert.ok(source.includes('KCSI_MED_MFDS_sample_120.zip'), '120건 ZIP 경로가 없다');
assert.ok(source.includes('KCSI_MED_MFDS_sample_240.zip'), '240건 ZIP 경로가 없다');
assert.ok(source.includes('KCSI_MED_MFDS_sample_20.zip'), '기존 고정 샘플 경로가 사라졌다');
assert.ok(/RND\$\{draw\.seed\}/.test(source) || source.includes('RND${draw.seed}'), '배치 ID에 seed를 남기지 않는다');
const css = fs.readFileSync('arena.css', 'utf8');
assert.ok(css.includes('.arena-sample-extended'), '확장 세트 카드 스타일이 없다');
assert.ok(css.includes('.arena-dataset-random'), '무작위 출제 안내 스타일이 없다');

console.log(`[random-batch] PASS — seed 재현 · 한 바퀴 ${perRound}배치 중복 없음 · ${total}건 전량 순회 · 화면 결선`);
