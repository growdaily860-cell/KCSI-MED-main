'use strict';

// 합성 의료문서 표본 생성기.
// 정답지 좌표가 실제 글자와 어긋나면 그 표본으로 낸 모든 수치가 틀린다.
// 여기서는 좌표 계산(순수 함수)과, sharp가 있으면 실제 렌더까지 확인한다.

const assert = require('assert');
const fs = require('fs');
const os = require('os');
const path = require('path');

(async () => {
  const forms = await import('../scripts/lib/doc-forms.mjs');
  const builder = await import('../scripts/lib/build-doc-samples.mjs');

  // ── 1. 서식 정의 ──────────────────────────────────────────────────────────
  assert.ok(forms.FORMS.length >= 3, `서식이 ${forms.FORMS.length}종뿐이다`);
  assert.equal(new Set(forms.FORMS.map(form => form.id)).size, forms.FORMS.length);
  assert.throws(() => forms.findForm('없는서식'), /알 수 없는 서식/);

  forms.FORMS.forEach(form => {
    const content = form.build(7);
    const pii = content.rows.filter(row => row.pii);
    assert.ok(pii.length >= 4, `${form.id}: 가릴 항목이 ${pii.length}개뿐이다`);
    assert.ok(content.rows.some(row => !row.pii), `${form.id}: 가리지 않아도 되는 행이 없어 과잉 가림을 못 잰다`);
    assert.match(content.note, /합성 문서/, `${form.id}: 합성 문서 고지가 없다`);
    // 주민등록번호는 실제로 발급될 수 없는 조합이어야 한다. 13월·32일 이상.
    const rrn = pii.find(row => row.pii === '주민등록번호');
    if (rrn) {
      const [month, day] = [rrn.value.slice(2, 4), rrn.value.slice(4, 6)];
      assert.ok(Number(month) > 12 || Number(day) > 31, `${form.id}: 실제로 존재할 수 있는 주민등록번호를 만들었다 (${rrn.value})`);
    }
  });

  // ── 2. 좌표 계산 ──────────────────────────────────────────────────────────
  const laid = builder.layoutDocument(forms.FORMS[0], 3);
  assert.equal(laid.items.length, laid.content.rows.filter(row => row.pii).length);
  laid.items.forEach(item => {
    assert.ok(item.box.w > 0 && item.box.h > 0, `${item.type}: 빈 상자`);
    assert.ok(item.box.x >= 0 && item.box.y >= 0);
    assert.ok(item.box.x + item.box.w <= forms.PAGE.width, `${item.type}: 상자가 페이지를 벗어났다`);
    assert.ok(item.box.y + item.box.h <= forms.PAGE.height);
  });
  // 항목마다 y가 달라야 한다 — 한 줄에 겹쳐 그리면 채점이 무의미해진다.
  assert.equal(new Set(laid.items.map(item => item.box.y)).size, laid.items.length, '항목들이 같은 줄에 겹쳤다');

  // ── 3. 조건 정의 ──────────────────────────────────────────────────────────
  assert.ok(builder.CONDITIONS.length >= 6, '촬영 조건이 너무 적다');
  assert.ok(builder.CONDITIONS.some(item => item.id === 'original'), '기준이 되는 정상 조건이 없다');
  const logged = new Set(require('../deident/doc-log.js').CONDITIONS);
  builder.CONDITIONS.forEach(condition => {
    assert.ok(logged.has(condition.logged), `${condition.id}: 처리기록이 모르는 조건 이름(${condition.logged})`);
  });

  // ── 4. 실제 렌더 (sharp 설치 시에만) ──────────────────────────────────────
  let sharp = null;
  try { sharp = require('sharp'); } catch (_) { /* 선택 의존성 */ }
  if (!sharp) {
    console.log('[doc-samples] 렌더 검증 건너뜀 — sharp 미설치 (npm i --no-save sharp)');
    console.log('[doc-samples] PASS — 서식/좌표/조건 정의');
    return;
  }

  const workRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'kcsi-docs-'));
  const result = await builder.buildDocumentSamples({
    perCondition: 1, formIds: ['diagnosis'], outputDirectory: workRoot, generatedAt: '2026-08-22T00:00:00.000Z',
  });
  const manifest = result.manifest;
  assert.equal(manifest.document_count, builder.CONDITIONS.length);
  assert.ok(manifest.item_count >= manifest.document_count * 4);
  assert.match(manifest.notice, /합성 문서/);

  // 정답지에 적힌 크기가 실제 이미지와 같아야 한다. 어긋나면 좌표가 전부 밀린다.
  const entries = require('child_process').execFileSync('unzip', ['-Z1', result.archivePath], { encoding: 'utf8' }).trim().split(/\r?\n/);
  assert.ok(entries.includes('answer_sheet.json') && entries.includes('README.txt'));
  for (const doc of manifest.documents) {
    assert.ok(entries.includes(`images/${doc.image}`), `${doc.doc_id}: 이미지가 ZIP에 없다`);
    const bytes = require('child_process').execFileSync('unzip', ['-p', result.archivePath, `images/${doc.image}`], { encoding: 'buffer' });
    const meta = await sharp(bytes).metadata();
    assert.equal(meta.width, doc.width, `${doc.doc_id}(${doc.condition}): 정답지 너비가 실제와 다르다`);
    assert.equal(meta.height, doc.height, `${doc.doc_id}(${doc.condition}): 정답지 높이가 실제와 다르다`);
    doc.items.forEach(item => {
      assert.ok(item.box.x >= 0 && item.box.y >= 0 && item.box.x + item.box.w <= doc.width + 1 && item.box.y + item.box.h <= doc.height + 1,
        `${doc.doc_id}(${doc.condition}) ${item.type}: 상자가 이미지 밖으로 나갔다`);
    });
  }

  // 회전 조건은 캔버스가 커져야 하고, 저해상도는 작아져야 한다.
  const original = manifest.documents.find(doc => doc.condition === 'original');
  const skew = manifest.documents.find(doc => doc.condition === 'skew15');
  const lowres = manifest.documents.find(doc => doc.condition === 'lowres');
  assert.ok(skew.width > original.width && skew.height > original.height, '회전했는데 캔버스가 그대로다');
  assert.ok(lowres.width < original.width, '저해상도인데 크기가 그대로다');
  // 같은 서식이면 조건이 달라도 항목 수는 같아야 한다.
  assert.equal(new Set(manifest.documents.map(doc => doc.items.length)).size, 1, '조건에 따라 항목 수가 달라졌다');

  // 정답 상자 안이 실제로 글자(어두운 픽셀)인지 — 좌표가 밀렸으면 흰 종이만 잡힌다.
  const buffer = require('child_process').execFileSync('unzip', ['-p', result.archivePath, `images/${original.image}`], { encoding: 'buffer' });
  for (const item of original.items) {
    const patch = await sharp(buffer).extract({
      left: item.box.x, top: item.box.y,
      width: Math.min(item.box.w, original.width - item.box.x),
      height: Math.min(item.box.h, original.height - item.box.y),
    }).greyscale().raw().toBuffer();
    const dark = patch.filter(value => value < 128).length / patch.length;
    assert.ok(dark > 0.02, `${item.type}: 정답 상자 안에 글자가 없다(어두운 픽셀 ${(dark * 100).toFixed(1)}%) — 좌표가 어긋났다`);
  }

  fs.rmSync(workRoot, { recursive: true, force: true });

  // ── 5. 저장소에 커밋된 팩 ────────────────────────────────────────────────
  // 팩은 각자 PC에서 만들어 커밋한다. 여기서 걸러 두지 않으면 깨진 정답지가 배포까지 나가고,
  // 그 정답지로 낸 성능 수치는 전부 틀린다.
  const committedManifest = 'samples/KCSI_MED_synthetic_docs.manifest.json';
  const committedArchive = 'samples/KCSI_MED_synthetic_docs.zip';
  if (!fs.existsSync(committedManifest)) {
    console.log('[doc-samples] 커밋된 합성 문서 팩 없음 — npm run build:docs 로 만들어 커밋하면 검사한다');
  } else {
    assert.ok(fs.existsSync(committedArchive), '매니페스트만 있고 ZIP이 없다');
    const committed = JSON.parse(fs.readFileSync(committedManifest, 'utf8'));
    assert.equal(committed.set, 'synthetic-medical-docs');
    assert.ok(committed.document_count >= 8, `문서가 ${committed.document_count}건뿐이다`);
    assert.equal(committed.documents.length, committed.document_count);
    assert.equal(new Set(committed.documents.map(doc => doc.doc_id)).size, committed.document_count, 'doc_id가 중복됐다');
    assert.equal(committed.item_count, committed.documents.reduce((sum, doc) => sum + doc.items.length, 0));
    assert.match(committed.notice, /합성 문서/, '합성 문서 고지가 없다');

    const zipEntries = require('child_process').execFileSync('unzip', ['-Z1', committedArchive], { encoding: 'utf8' }).trim().split(/\r?\n/);
    assert.ok(zipEntries.includes('answer_sheet.json') && zipEntries.includes('README.txt'));
    assert.equal(zipEntries.filter(name => /^images\/.+\.jpg$/.test(name)).length, committed.document_count, 'ZIP 안 이미지 수가 다르다');

    // 조건이 고루 들어 있어야 조건별 비교가 성립한다.
    const perCondition = committed.documents.reduce((map, doc) => {
      map[doc.condition] = (map[doc.condition] || 0) + 1;
      return map;
    }, {});
    assert.ok(Object.keys(perCondition).length >= 6, `조건이 ${Object.keys(perCondition).length}종뿐이다`);
    assert.ok(perCondition.original > 0, '기준이 되는 정상 스캔이 없다');

    // 정답 좌표가 실제 이미지와 맞는지 — 조건마다 한 건씩 뜯어본다.
    const seen = new Set();
    for (const doc of committed.documents) {
      if (seen.has(doc.condition)) continue;
      seen.add(doc.condition);
      const bytes = require('child_process').execFileSync('unzip', ['-p', committedArchive, `images/${doc.image}`], { encoding: 'buffer', maxBuffer: 64 * 1024 * 1024 });
      const meta = await sharp(bytes).metadata();
      assert.equal(meta.width, doc.width, `${doc.doc_id}(${doc.condition}): 정답지 너비가 실제와 다르다`);
      assert.equal(meta.height, doc.height, `${doc.doc_id}(${doc.condition}): 정답지 높이가 실제와 다르다`);
      for (const item of doc.items) {
        assert.ok(item.box.x >= 0 && item.box.y >= 0 && item.box.x + item.box.w <= doc.width + 1 && item.box.y + item.box.h <= doc.height + 1,
          `${doc.doc_id}(${doc.condition}) ${item.type}: 상자가 이미지 밖이다`);
        const patch = await sharp(bytes).extract({
          left: item.box.x, top: item.box.y,
          width: Math.min(item.box.w, doc.width - item.box.x),
          height: Math.min(item.box.h, doc.height - item.box.y),
        }).greyscale().raw().toBuffer();
        // 저조도 조건은 전체가 어두우므로 절대 밝기가 아니라 주변 대비로 본다.
        const values = [...patch];
        const mean = values.reduce((sum, value) => sum + value, 0) / values.length;
        const ratio = values.filter(value => value < mean - 25).length / values.length;
        assert.ok(ratio > 0.01, `${doc.doc_id}(${doc.condition}) ${item.type}: 정답 상자 안에 글자가 없다(${(ratio * 100).toFixed(1)}%)`);
      }
    }
    console.log(`[doc-samples] 커밋된 팩 검사 — ${committed.document_count}건 · 항목 ${committed.item_count}개 · 조건 ${Object.keys(perCondition).length}종`);
  }

  console.log(`[doc-samples] PASS — 서식 ${forms.FORMS.length}종 · 조건 ${builder.CONDITIONS.length}종 · 정답 좌표가 실제 글자 위에 있음`);
})().catch(error => {
  console.error(error);
  process.exitCode = 1;
});
