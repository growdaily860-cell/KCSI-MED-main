'use strict';

// 고정 샘플 팩 생성기를 식약처 서버 없이 검증한다.
// 내려받기·이미지 분할을 주입해 팩 구조, 사진 누락 대응, 정답지·매니페스트를
// 앱이 실제로 쓰는 검증기(validateDatasetRows)로 확인한다.
// 실제 다운로드는 인터넷이 되는 환경에서 scripts/build-mfds-sample-dataset.mjs가 한다.

const assert = require('assert');
const crypto = require('crypto');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { execFileSync } = require('child_process');
const arena = require('../arena.js');

(async () => {
  const builder = await import('../scripts/lib/build-sample-pack.mjs');
  const sets = await import('../scripts/mfds-sample-sets.mjs');

  // ── 1. 세트 정의 자체를 먼저 믿을 수 있어야 한다 ────────────────────────
  assert.equal(sets.FIXED_20.itemIds.length, 20);
  assert.equal(sets.FIXED_20.targetCount, 20);
  assert.ok(sets.EXTENDED_120.targetCount >= 100, '확장 세트 목표는 100건 이상이어야 한다');
  assert.ok(sets.EXTENDED_240.targetCount >= 200, '큰 확장 세트 목표는 200건 이상이어야 한다');
  assert.ok(sets.EXTENDED_240.itemIds.length > sets.EXTENDED_240.targetCount);
  assert.equal(new Set(sets.EXTENDED_240.itemIds).size, sets.EXTENDED_240.itemIds.length, '후보 품목이 중복됐다');
  // 20 ⊂ 120 ⊂ 240 — 작은 세트로 낸 결과를 큰 세트에서 그대로 이어 보려면 앞부분이 같아야 한다.
  assert.deepEqual(sets.EXTENDED_240.itemIds.slice(0, sets.EXTENDED_120.itemIds.length), sets.EXTENDED_120.itemIds,
    '240건 세트가 120건 세트를 같은 순서로 포함하지 않는다');
  assert.equal(new Set(sets.SAMPLE_SETS.map(item => item.archiveBase)).size, sets.SAMPLE_SETS.length,
    '세트끼리 같은 파일 이름을 쓴다');
  assert.ok(sets.EXTENDED_120.itemIds.length > sets.EXTENDED_120.targetCount,
    '사진이 빠진 품목을 대비해 후보를 목표보다 넉넉히 둬야 한다');
  assert.equal(new Set(sets.EXTENDED_120.itemIds).size, sets.EXTENDED_120.itemIds.length, '후보 품목이 중복됐다');
  assert.deepEqual(sets.EXTENDED_120.itemIds.slice(0, 20), sets.FIXED_20.itemIds,
    '확장 세트는 기존 20건을 같은 순서로 포함해야 비교가 이어진다');
  assert.notEqual(sets.EXTENDED_120.archiveBase, sets.FIXED_20.archiveBase, '두 세트가 같은 파일을 덮어쓴다');
  assert.throws(() => sets.findSampleSet('없는세트'), /알 수 없는 샘플 세트/);

  // 후보 품목이 실제 pill_db.json에 있고 이미지 URL 형식이 맞는지 —
  // 여기서 걸러 두지 않으면 사용자가 팩을 만들다 중간에 실패한다.
  const database = JSON.parse(fs.readFileSync('pill_db.json', 'utf8'));
  const selected = builder.selectItems(database, sets.EXTENDED_240);
  assert.equal(selected.length, sets.EXTENDED_240.itemIds.length);
  assert.ok(selected.every(item => builder.IMAGE_URL_PATTERN.test(item.img)));
  assert.ok(selected.every(item => String(item.n || '').trim()), '제품명이 빈 품목은 정답지로 쓸 수 없다');
  assert.ok(selected.filter(item => String(item.pb || '').trim()).length >= sets.EXTENDED_240.targetCount * 0.7,
    '양면 각인 품목이 70% 이상이어야 앞·뒤 판독 비교가 의미 있다');
  const shapes = new Set(selected.map(item => String(item.sh || '').trim()));
  const colors = new Set(selected.map(item => String(item.k1 || '').trim()));
  assert.ok(shapes.size >= 5, `모양이 ${shapes.size}종뿐이다`);
  assert.ok(colors.size >= 6, `색상이 ${colors.size}종뿐이다`);

  // ── 2. 팩 생성 — 사진 3건이 없는 상황을 섞는다 ──────────────────────────
  const workRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'kcsi-pack-test-'));
  const broken = new Set(['T-003', 'T-005', 'T-009']);
  const fakeDatabase = {
    generated: '2026-08-01',
    source: 'test-source',
    items: Array.from({ length: 12 }, (_, index) => {
      const id = `T-${String(index + 1).padStart(3, '0')}`;
      return {
        q: id, n: `테스트정${index + 1}`, pf: `F${index + 1}`, pb: index % 4 === 0 ? '' : `B${index + 1}`,
        sh: ['원형', '타원형', '장방형', '삼각형'][index % 4], k1: ['하양', '분홍', '노랑'][index % 3],
        cl: '해열.진통.소염제', fm: '필름코팅정',
        img: `https://nedrug.mfds.go.kr/pbp/cmn/itemImageDownload/TEST${index + 1}`,
      };
    }),
  };
  const testSet = {
    name: 'test6', label: '테스트 샘플 6건', targetCount: 6,
    archiveBase: 'KCSI_TEST_PACK', caseIdPrefix: 'TEST',
    itemIds: fakeDatabase.items.map(item => item.q),
  };
  const downloaded = [];
  const result = await builder.buildSamplePack({
    set: testSet,
    database: fakeDatabase,
    outputDirectory: workRoot,
    throttleMs: 0,
    download: async (url, targetPath) => {
      const id = url.split('/').pop().replace('TEST', '');
      const caseId = `T-${String(Number(id)).padStart(3, '0')}`;
      if (broken.has(caseId)) throw new Error('HTTP 404');
      downloaded.push(caseId);
      const bytes = Buffer.concat([Buffer.from([0xff, 0xd8]), Buffer.alloc(20_000, Number(id) % 251)]);
      fs.writeFileSync(targetPath, bytes);
      return bytes;
    },
    split: async (sourcePath, frontPath, backPath) => {
      const source = fs.readFileSync(sourcePath);
      fs.writeFileSync(frontPath, Buffer.concat([Buffer.from('FRONT'), source]));
      fs.writeFileSync(backPath, Buffer.concat([Buffer.from('BACK'), source]));
      return { width: 800, height: 400, leftWidth: 400, rightWidth: 400, splitter: 'test' };
    },
  });

  assert.equal(result.sampleCount, 6, '목표 건수를 채우지 못했다');
  // T-003·T-005가 빠지고 T-008까지 가서 6건을 채운다.
  assert.deepEqual(result.skipped.map(item => item.mfds_item_id), ['T-003', 'T-005'], '사진이 없는 품목이 기록되지 않았다');
  assert.ok(result.skipped.every(item => /HTTP 404/.test(item.reason)));
  assert.ok(!downloaded.includes('T-003'), '실패한 품목이 팩에 들어갔다');
  // 목표를 채우면 남은 후보는 내려받지 않는다 — 식약처 서버에 불필요한 요청을 보내지 않기 위해.
  assert.deepEqual(downloaded, ['T-001', 'T-002', 'T-004', 'T-006', 'T-007', 'T-008']);

  // ── 3. 만들어진 ZIP이 앱 검증기를 그대로 통과하는지 ────────────────────
  const archivePath = result.archivePath;
  const manifest = JSON.parse(fs.readFileSync(result.metadataPath, 'utf8'));
  assert.equal(manifest.set, 'test6');
  assert.equal(manifest.sample_count, 6);
  assert.equal(manifest.image_count, 12);
  assert.equal(manifest.candidate_count, 12);
  assert.equal(manifest.skipped_items.length, 2);
  assert.equal(manifest.items.length, 6);
  assert.equal(crypto.createHash('sha256').update(fs.readFileSync(archivePath)).digest('hex'), manifest.archive_sha256);
  // 건너뛴 품목이 있어도 case_id는 001부터 빈틈없이 이어져야 한다.
  assert.deepEqual(manifest.items.map(item => item.case_id),
    ['TEST-001', 'TEST-002', 'TEST-003', 'TEST-004', 'TEST-005', 'TEST-006']);

  const entries = execFileSync('unzip', ['-Z1', archivePath], { encoding: 'utf8' }).trim().split(/\r?\n/);
  assert.ok(entries.includes('answer_sheet.csv') && entries.includes('source_manifest.csv') && entries.includes('README.txt'));
  const imageEntries = entries.filter(name => /^images\/.+_(?:front|back)\.jpg$/.test(name));
  assert.equal(imageEntries.length, 12);

  const answerCsv = execFileSync('unzip', ['-p', archivePath, 'answer_sheet.csv'], { encoding: 'utf8' });
  const parsed = arena.normalizeDatasetTable(arena.parseDelimitedRows(answerCsv));
  const validation = arena.validateDatasetRows(parsed.rows, imageEntries);
  assert.equal(parsed.rows.length, 6);
  assert.equal(validation.summary.validRows, 6);
  assert.equal(validation.summary.invalidRows, 0);
  assert.equal(validation.summary.matchedImages, 12);

  const readme = execFileSync('unzip', ['-p', archivePath, 'README.txt'], { encoding: 'utf8' });
  assert.ok(readme.includes('테스트 샘플 6건') && readme.includes('앞·뒷면 12장'));
  assert.ok(readme.includes('사람이 최종 확인'), '해석 주의 문구가 빠졌다');

  // ── 3b. ZIP은 외부 zip 명령 없이 만들고, 같은 입력이면 같은 바이트가 나와야 한다 ──
  const rebuiltRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'kcsi-pack-test2-'));
  const rebuilt = await builder.buildSamplePack({
    set: testSet, database: fakeDatabase, outputDirectory: rebuiltRoot, throttleMs: 0,
    download: async (url, targetPath) => {
      const id = url.split('/').pop().replace('TEST', '');
      const caseId = `T-${String(Number(id)).padStart(3, '0')}`;
      if (broken.has(caseId)) throw new Error('HTTP 404');
      const bytes = Buffer.concat([Buffer.from([0xff, 0xd8]), Buffer.alloc(20_000, Number(id) % 251)]);
      fs.writeFileSync(targetPath, bytes);
      return bytes;
    },
    split: async (sourcePath, frontPath, backPath) => {
      const source = fs.readFileSync(sourcePath);
      fs.writeFileSync(frontPath, Buffer.concat([Buffer.from('FRONT'), source]));
      fs.writeFileSync(backPath, Buffer.concat([Buffer.from('BACK'), source]));
      return { width: 800, height: 400, leftWidth: 400, rightWidth: 400, splitter: 'test' };
    },
  });
  assert.ok(fs.readFileSync(archivePath).equals(fs.readFileSync(rebuilt.archivePath)),
    '같은 입력인데 ZIP 바이트가 달라졌다 — 무결성 해시를 비교할 수 없다');
  fs.rmSync(rebuiltRoot, { recursive: true, force: true });

  // 화면은 JSZip으로 이 ZIP을 푼다. 설치돼 있으면 실제 소비자로 한 번 더 확인한다.
  let JSZip = null;
  try { JSZip = require('jszip'); } catch (_) { /* 선택 의존성 */ }
  if (JSZip) {
    const archive = await JSZip.loadAsync(fs.readFileSync(archivePath));
    const names = Object.values(archive.files).filter(entry => !entry.dir).map(entry => entry.name);
    assert.equal(names.filter(name => /^images\/.+\.jpg$/.test(name)).length, 12);
    const jszipAnswer = await archive.file('answer_sheet.csv').async('string');
    assert.equal(jszipAnswer, answerCsv, 'JSZip이 읽은 정답지가 unzip 결과와 다르다');
    const jszipReadme = await archive.file('README.txt').async('string');
    assert.ok(jszipReadme.includes('테스트 샘플 6건'), 'JSZip이 한글 README를 깨뜨렸다');
    const jpeg = await archive.file(`images/${manifest.items[0].files.front}`).async('nodebuffer');
    assert.equal(crypto.createHash('sha256').update(jpeg).digest('hex'), manifest.items[0].file_sha256.front,
      'JSZip으로 푼 사진이 매니페스트 해시와 다르다');
    console.log('[sample-dataset-builder] JSZip 해석 검증 완료');
  } else {
    console.log('[sample-dataset-builder] JSZip 검증 건너뜀 — jszip 미설치');
  }

  // ── 4. 실제 이미지 분할(설치돼 있을 때만) ───────────────────────────────
  let sharp = null;
  try { sharp = require('sharp'); } catch (_) { /* 선택 의존성 */ }
  if (sharp) {
    const compositePath = path.join(workRoot, 'composite.jpg');
    const frontPath = path.join(workRoot, 'split_front.jpg');
    const backPath = path.join(workRoot, 'split_back.jpg');
    // 좌: 검정, 우: 흰색 — 좌우가 뒤바뀌면 바로 드러난다.
    await sharp({ create: { width: 800, height: 400, channels: 3, background: '#ffffff' } })
      .composite([{ input: { create: { width: 400, height: 400, channels: 3, background: '#000000' } }, left: 0, top: 0 }])
      .jpeg().toFile(compositePath);
    const geometry = await builder.splitCompositeImage(compositePath, frontPath, backPath);
    assert.equal(geometry.width, 800);
    assert.equal(geometry.leftWidth, 400);
    assert.equal(geometry.rightWidth, 400);
    const frontStats = await sharp(frontPath).stats();
    const backStats = await sharp(backPath).stats();
    assert.ok(frontStats.channels[0].mean < 40, `앞면(좌측)이 검정이어야 하는데 평균 ${frontStats.channels[0].mean}`);
    assert.ok(backStats.channels[0].mean > 215, `뒷면(우측)이 흰색이어야 하는데 평균 ${backStats.channels[0].mean}`);
    const metadata = await sharp(frontPath).metadata();
    assert.equal(metadata.width, 400);
    assert.equal(metadata.height, 400);
    console.log(`[sample-dataset-builder] 실제 분할 검증 완료 (${geometry.splitter})`);
  } else {
    console.log('[sample-dataset-builder] 분할 검증 건너뜀 — sharp 미설치 (npm i -D sharp)');
  }

  fs.rmSync(workRoot, { recursive: true, force: true });
  console.log(`[sample-dataset-builder] PASS — 세트 ${sets.SAMPLE_SETS.length}종 · 후보 ${sets.EXTENDED_240.itemIds.length}건 검증 · 사진 누락 대응 · 팩 구조/정답지`);
})().catch(error => {
  console.error(error);
  process.exitCode = 1;
});
