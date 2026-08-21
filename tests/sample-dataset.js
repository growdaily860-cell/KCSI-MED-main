'use strict';

// 저장소에 들어 있는 모든 식약처 고정 샘플 팩을 검사한다.
// 팩은 사람이 각자 PC에서 만들어 커밋하므로, 여기서 걸러 두지 않으면
// 깨진 팩이 배포까지 그대로 나간다.

const assert = require('assert');
const crypto = require('crypto');
const fs = require('fs');
const path = require('path');
const { execFileSync } = require('child_process');
const arena = require('../arena.js');

const manifestPaths = fs.readdirSync('samples')
  .filter(name => /^KCSI_MED_MFDS_sample_\d+\.manifest\.json$/.test(name))
  .sort()
  .map(name => path.join('samples', name));

assert.ok(manifestPaths.length >= 1, 'samples/에 고정 샘플 팩이 하나도 없다');
// 20건 기본 팩은 화면의 "샘플 20건 자동 불러오기"가 항상 쓰므로 반드시 있어야 한다.
assert.ok(fs.existsSync('samples/KCSI_MED_MFDS_sample_20.zip'), '기본 20건 팩이 없다');

const summaries = [];

for (const manifestPath of manifestPaths) {
  const manifest = JSON.parse(fs.readFileSync(manifestPath, 'utf8'));
  const archivePath = path.join('samples', manifest.archive);
  const where = path.basename(archivePath);
  assert.ok(fs.existsSync(archivePath), `${where}: 매니페스트가 가리키는 ZIP이 없다`);

  const archive = fs.readFileSync(archivePath);
  assert.equal(archive.length, manifest.archive_bytes, `${where}: 파일 크기가 매니페스트와 다르다`);
  assert.equal(crypto.createHash('sha256').update(archive).digest('hex'), manifest.archive_sha256,
    `${where}: SHA-256이 매니페스트와 다르다 — 내용이 바뀌었거나 전송 중 깨졌다`);

  const count = manifest.sample_count;
  assert.ok(count >= 5, `${where}: 배치 하나(5건)도 못 채운다`);
  assert.equal(manifest.image_count, count * 2, `${where}: 사진 수가 건수의 2배가 아니다`);
  assert.equal(manifest.items.length, count, `${where}: items 수가 sample_count와 다르다`);
  assert.equal(new Set(manifest.items.map(item => item.case_id)).size, count, `${where}: case_id가 중복됐다`);
  // 사진이 빠진 품목을 건너뛰어도 번호는 001부터 빈틈없이 이어져야 한다.
  assert.deepEqual(manifest.items.map(item => item.case_id),
    manifest.items.map((_, index) => `MFDS-${String(index + 1).padStart(3, '0')}`),
    `${where}: case_id 번호가 이어지지 않는다`);
  assert.ok(manifest.items.every(item => /^https:\/\/nedrug\.mfds\.go\.kr\/pbp\/cmn\/itemImageDownload\//.test(item.original_image_url)),
    `${where}: 식약처 공식 이미지가 아닌 출처가 섞였다`);
  assert.equal(new Set(manifest.items.map(item => item.mfds_item_id)).size, count, `${where}: 같은 품목이 두 번 들어갔다`);

  const entries = execFileSync('unzip', ['-Z1', archivePath], { encoding: 'utf8' }).trim().split(/\r?\n/);
  const imageEntries = entries.filter(name => /^images\/.+_(?:front|back)\.jpg$/.test(name));
  assert.equal(imageEntries.length, count * 2, `${where}: ZIP 안 사진 수가 다르다`);
  ['answer_sheet.csv', 'source_manifest.csv', 'README.txt'].forEach(name => {
    assert.ok(entries.includes(name), `${where}: ${name}이 없다`);
  });

  // 매니페스트에 적힌 사진 해시가 ZIP 안 실제 사진과 맞는지 (앞 3건만 표본 검사)
  manifest.items.slice(0, 3).forEach(item => {
    ['front', 'back'].forEach(side => {
      const bytes = execFileSync('unzip', ['-p', archivePath, `images/${item.files[side]}`], { encoding: 'buffer' });
      assert.equal(bytes[0], 0xff, `${where}: ${item.files[side]}이 JPEG가 아니다`);
      assert.equal(crypto.createHash('sha256').update(bytes).digest('hex'), item.file_sha256[side],
        `${where}: ${item.files[side]} 해시가 매니페스트와 다르다`);
    });
  });

  const answerCsv = execFileSync('unzip', ['-p', archivePath, 'answer_sheet.csv'], { encoding: 'utf8' });
  const parsed = arena.normalizeDatasetTable(arena.parseDelimitedRows(answerCsv));
  const validation = arena.validateDatasetRows(parsed.rows, imageEntries);
  assert.equal(parsed.rows.length, count, `${where}: 정답지 행 수가 다르다`);
  assert.equal(validation.summary.validRows, count, `${where}: 검증에 실패한 행이 있다`);
  assert.equal(validation.summary.invalidRows, 0, `${where}: 검증 실패 행 ${validation.summary.invalidRows}건`);
  assert.equal(validation.summary.matchedImages, count * 2, `${where}: 정답지와 사진이 짝을 못 이룬다`);

  // 무작위 출제가 성립하는지 — 한 바퀴에 몇 배치가 나오는지
  const queue = arena.createRandomBatchQueue(validation.validRows.length, 'PACKCHK');
  const draw = arena.drawRandomBatch(queue, arena.CASE_COUNT);
  assert.equal(draw.indices.length, arena.CASE_COUNT, `${where}: 무작위 5건을 뽑지 못한다`);
  assert.equal(draw.drawsPerRound, Math.floor(count / arena.CASE_COUNT));

  summaries.push(`${manifest.set || 'fixed20'} ${count}건/${count * 2}장 · ${draw.drawsPerRound}배치`);
}

console.log(`[sample-dataset] PASS — ${summaries.join(' · ')}`);
