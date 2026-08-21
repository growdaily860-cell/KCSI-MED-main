// 실제 Chromium에서 /research 화면을 띄워 자동채점 모듈 결합을 확인한다.
// Playwright가 없는 환경에서는 건너뛴다 — `npm test`(정적 검사)와 분리해 둔 이유다.
// 실행: node tests/browser-research.mjs
import { createRequire } from 'node:module';
import { spawn } from 'node:child_process';
import assert from 'node:assert';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const require = createRequire(import.meta.url);
const here = path.dirname(fileURLToPath(import.meta.url));
const root = path.resolve(here, '..');

let chromium;
try {
  ({ chromium } = require('playwright'));
} catch (_) {
  console.log('[browser-research] SKIP — playwright 미설치 (npm i -D playwright 후 재실행)');
  process.exit(0);
}

const PORT = Number(process.env.KCSI_TEST_PORT || 8791);
const BASE = `http://127.0.0.1:${PORT}`;

const server = spawn(process.execPath, [path.join(here, 'dev-server.js'), String(PORT)], { cwd: root, stdio: ['ignore', 'pipe', 'inherit'] });
const stop = () => { try { server.kill('SIGTERM'); } catch (_) {} };
process.on('exit', stop);

await new Promise((resolve, reject) => {
  const timer = setTimeout(() => reject(new Error('dev-server 기동 실패')), 10000);
  server.stdout.on('data', chunk => {
    if (String(chunk).includes('KCSI-MED local server')) { clearTimeout(timer); resolve(); }
  });
  server.on('error', reject);
});

const browser = await chromium.launch();
const failures = [];
try {
  const context = await browser.newContext({ viewport: { width: 390, height: 844 } });
  const page = await context.newPage();
  page.on('console', message => {
    if (message.type() !== 'error') return;
    // 외부 폰트·CDN은 오프라인 검증 환경에서 막히는 게 정상이므로 페이지 결함으로 세지 않는다.
    const source = (message.location() && message.location().url) || '';
    if (/Failed to load resource/.test(message.text()) && source && !source.startsWith(BASE)) return;
    failures.push(`console: ${message.text()} (${source})`);
  });
  page.on('pageerror', error => failures.push(`pageerror: ${error.message}`));

  const response = await page.goto(`${BASE}/research`, { waitUntil: 'load' });
  assert.equal(response.status(), 200);
  await page.waitForSelector('#arenaRoot');

  // 1) 스크립트 결합 — 자동채점 모듈이 arena.js보다 먼저 실행되어 전역에 잡혀야 한다.
  const globals = await page.evaluate(() => ({
    rubric: typeof globalThis.KCSIArenaRubric === 'object' && !!globalThis.KCSIArenaRubric,
    core: !!globalThis.KCSIArenaCore,
    platform: !!globalThis.KCSIResearchPlatform,
    datasetTools: !!globalThis.KCSIResearchDatasetTools,
    runStore: !!globalThis.KCSIRunStore,
    glossary: !!globalThis.KCSIMetricGlossary,
    rubricVersion: globalThis.KCSIArenaRubric && globalThis.KCSIArenaRubric.RUBRIC_VERSION,
  }));
  assert.equal(globals.rubric, true, '자동채점 모듈 전역이 없다');
  assert.equal(globals.core, true, 'Arena 코어 전역이 없다');
  assert.equal(globals.platform, true, '연구 플랫폼 번들 전역이 없다');
  assert.equal(globals.datasetTools, true, '정답지 도구 전역이 없다');
  assert.equal(globals.rubricVersion, 'kcsi-arena-rubric-v1');
  assert.equal(globals.runStore, true, '누적 기록 저장소 전역이 없다');
  assert.equal(globals.glossary, true, '지표 설명 전역이 없다');

  // 2) 실제 페이지에서 자동채점이 동작하는지 — 로드 순서가 어긋나면 ready:false로 떨어진다.
  const scored = await page.evaluate(() => {
    const cases = Array.from({ length: 5 }, (_, index) => ({
      schema_version: '1.0',
      sample_id: `MED-${index + 1}`,
      id: `MED-${index + 1}`,
      truthName: `자이로릭정${index + 1}`,
      truthFront: `Z${index + 1}`,
      truthBack: `${100 + index}`,
      answer: {
        mfds_item_id: `MFDS-${index + 1}`,
        drug_name: `자이로릭정${index + 1}`,
        front_imprint: `Z${index + 1}`,
        back_imprint: `${100 + index}`,
        shape: '원형',
        color: '흰색',
      },
      condition: { expected_readable: true, variant: 'original' },
    }));
    const predictions = cases.map((item, index) => ({
      case_id: item.sample_id,
      drug_name: item.answer.drug_name,
      drug_code: item.answer.mfds_item_id,
      imprint_front: item.answer.front_imprint,
      imprint_back: item.answer.back_imprint,
      shape: '원형',
      color: '흰색',
      confidence: 90,
      evidence: '앞면 각인과 모양·색상이 정답과 일치',
      uncertainty: '조명 반사로 일부 각인이 흐림',
    }));
    const rating = globalThis.KCSIArenaCore.scoreBatchWithRubric(cases, predictions, []);
    const winner = globalThis.KCSIArenaCore.determineAutomaticWinner({
      A: { rating }, B: { rating: { ...rating, total: rating.total - 12 } },
    }, 1);
    return { ready: rating.ready, total: rating.total, accuracy: rating.accuracy, verdicts: rating.caseVerdicts, vote: winner.vote };
  });
  assert.equal(scored.ready, true, '실제 브라우저에서 자동채점이 보류됐다');
  assert.equal(scored.accuracy, 40);
  assert.equal(scored.total, 100);
  assert.deepEqual(scored.verdicts, ['correct', 'correct', 'correct', 'correct', 'correct']);
  assert.equal(scored.vote, 'A');

  // 3) 자동채점 UI와 플랫폼 보고서 UI가 한 화면에 함께 설치되는지
  for (const selector of ['#arenaAutoStatus', '#arenaAutoReasons', '#arenaAcceptAuto', '#arenaContractCsv', '#arenaXlsx', '#arenaPdf',
    '#arenaDatasetSampleLoad', '#arenaDatasetSampleSet', '#arenaDatasetSampleLoadExtended', '#arenaDatasetRandomBatch', '#arenaDatasetRandomNote',
    '#arenaStoreStatus', '#arenaGlossary', '#arenaGlossaryBody', '#arenaBackupSave', '#arenaBackupLoad']) {
    assert.equal(await page.locator(selector).count(), 1, `${selector} 가 없다`);
  }

  // 3b) 무작위 출제가 실제 페이지에서 도는지 — 120건에서 한 바퀴 중복 없이 24배치가 나와야 한다.
  const randomDraw = await page.evaluate(() => {
    const core = globalThis.KCSIArenaCore;
    const queue = core.createRandomBatchQueue(120, 'BROWSE');
    const seen = [];
    let last = null;
    for (let index = 0; index < 24; index += 1) {
      last = core.drawRandomBatch(queue, core.CASE_COUNT);
      seen.push(...last.indices);
    }
    return { unique: new Set(seen).size, count: seen.length, round: last.round, seed: last.seed, drawsPerRound: last.drawsPerRound };
  });
  assert.equal(randomDraw.count, 120);
  assert.equal(randomDraw.unique, 120, '실제 브라우저에서 같은 알약이 중복 출제됐다');
  assert.equal(randomDraw.round, 1);
  assert.equal(randomDraw.drawsPerRound, 24);
  assert.equal(randomDraw.seed, 'BROWSE');

  // 3c) 확장 세트 선택이 내려받기 링크와 실제로 연동되는지
  const setPicker = await page.evaluate(() => {
    const select = document.getElementById('arenaDatasetSampleSet');
    const link = document.getElementById('arenaDatasetSampleDownload120');
    const options = Array.from(select.options).map(option => option.value);
    const before = link.getAttribute('href');
    select.value = 'extended240';
    select.dispatchEvent(new Event('change'));
    return { options, before, after: link.getAttribute('href'), download: link.getAttribute('download') };
  });
  assert.deepEqual(setPicker.options, ['extended120', 'extended240'], '확장 세트 선택지가 다르다');
  assert.ok(setPicker.before.includes('sample_120.zip'), '기본 선택이 120건이 아니다');
  assert.ok(setPicker.after.includes('sample_240.zip'), '세트를 바꿔도 내려받기 링크가 그대로다');
  assert.equal(setPicker.download, 'KCSI_MED_MFDS_sample_240.zip');

  // 3c) 누적 결과 저장이 실제 페이지에서 도는지 — 백업을 만들고 되읽어 같은 배치 수가 나와야 한다.
  const storeCheck = await page.evaluate(() => {
    const store = globalThis.KCSIRunStore;
    const runs = Array.from({ length: 3 }, (_, index) => ({
      id: `B-${index}`, createdAt: new Date(Date.UTC(2026, 7, 21, 0, index)).toISOString(),
      cases: [], results: { A: { raw: 'secret raw', rating: { caseVerdicts: ['correct'] } } }, vote: 'A',
    }));
    let saved = '';
    const result = store.saveRuns(runs, { setItem: value => { saved = value; }, maxRuns: 100 });
    const parsed = store.parseBackup(JSON.stringify(store.buildBackup(runs)));
    return {
      ok: result.ok,
      reloaded: store.loadRuns(saved).length,
      restored: parsed.ok ? parsed.runs.length : 0,
      merged: store.mergeRuns(runs, parsed.runs).length,
      leaksRaw: saved.includes('secret raw'),
      glossary: globalThis.KCSIMetricGlossary.METRICS.length,
    };
  });
  assert.equal(storeCheck.ok, true, '실제 브라우저에서 누적 기록 저장이 실패했다');
  assert.equal(storeCheck.reloaded, 3);
  assert.equal(storeCheck.restored, 3);
  assert.equal(storeCheck.merged, 3, '같은 백업을 복원했는데 배치가 늘었다');
  assert.equal(storeCheck.leaksRaw, false, '저장본에 공급자 원본이 남았다');
  assert.ok(storeCheck.glossary >= 12);

  // 3d) 대시보드에 저장 상태와 지표 설명이 실제로 그려지는지
  await page.evaluate(() => document.querySelector('[data-arena-view="dashboard"]').click());
  const dashboard = await page.evaluate(() => ({
    store: (document.getElementById('arenaStoreStatus').textContent || '').trim().length,
    glossaryItems: document.querySelectorAll('#arenaGlossaryBody .arena-glossary-item').length,
    hasFormula: (document.getElementById('arenaGlossaryBody').textContent || '').includes('산출'),
  }));
  assert.ok(dashboard.store > 10, '저장 상태 줄이 비어 있다');
  assert.ok(dashboard.glossaryItems >= 12, `지표 설명이 ${dashboard.glossaryItems}개만 그려졌다`);
  assert.equal(dashboard.hasFormula, true, '산출 근거가 표시되지 않는다');

  // 3e) 알약별 점수칸 결선 — 판정을 고르면 배점이 채워지고, 점수를 고쳐도 판정은 남아야 한다.
  //     (총점 산식 자체는 배치 실행 상태가 필요하므로 tests/case-points.js가 단위로 검증한다.)
  const casePoints = await page.evaluate(() => {
    document.getElementById('arenaResults').classList.add('show');
    const pick = (label, index, field) => document.querySelector(`[data-score-label="${label}"][data-case-index="${index}"][data-score-field="${field}"]`);
    const verdicts = ['correct', 'partial', 'wrong', 'correct', 'partial'];
    verdicts.forEach((verdict, index) => {
      const select = pick('A', index, 'verdict');
      select.value = verdict;
      select.dispatchEvent(new Event('input', { bubbles: true }));
    });
    const filled = verdicts.map((_, index) => pick('A', index, 'points').value);
    const points = pick('A', 0, 'points');
    points.value = '31.5';
    points.dispatchEvent(new Event('input', { bubbles: true }));
    return {
      filled,
      edited: points.value,
      verdictKept: pick('A', 0, 'verdict').value,
      editedFlag: points.dataset.scoreEdited === 'true',
      min: points.min, max: points.max,
      countPerCase: document.querySelectorAll('[data-score-label="A"][data-case-index="0"]').length,
    };
  });
  assert.deepEqual(casePoints.filled, ['40', '20', '0', '40', '20'], '판정을 골라도 점수칸이 채워지지 않는다');
  assert.equal(casePoints.edited, '31.5', '알약별 점수를 직접 적을 수 없다');
  assert.equal(casePoints.verdictKept, 'correct', '점수를 고쳤다고 판정까지 바뀌면 근거를 잃는다');
  assert.equal(casePoints.editedFlag, true, '사람이 고친 점수가 표시되지 않는다');
  assert.equal(casePoints.min, '0');
  assert.equal(casePoints.max, '40');
  assert.equal(casePoints.countPerCase, 2, '알약 한 칸에 판정과 점수 두 입력이 있어야 한다');

  // 4) 모바일 폭에서 가로 스크롤이 생기지 않는지 — 자동채점 카드가 390px에서 넘치면 현장에서 못 쓴다.
  // PIN 게이트가 화면을 덮고 있으므로 실제 클릭 대신 핸들러만 호출한다(인증은 그대로 둔다).
  await page.evaluate(() => document.querySelector('[data-arena-view="experiment"]').click());
  const overflow = await page.evaluate(() => {
    const auto = document.querySelector('.arena-auto-accept');
    return {
      documentOverflow: document.documentElement.scrollWidth - document.documentElement.clientWidth,
      autoColumns: auto ? getComputedStyle(auto).gridTemplateColumns.split(' ').length : 0,
    };
  });
  assert.ok(overflow.documentOverflow <= 1, `모바일 가로 넘침 ${overflow.documentOverflow}px`);
  assert.equal(overflow.autoColumns, 1, '390px에서 자동 추천 영역이 1열로 접히지 않는다');

  // 5) 정답지·이미지가 서버로 새 나가지 않는지 — 화면을 여는 것만으로 나가는 요청은
  //    정적 폰트·CDN 뿐이어야 하고, 본문을 실어 보내는 요청은 하나도 없어야 한다.
  const STATIC_HOSTS = new Set(['fonts.googleapis.com', 'fonts.gstatic.com', 'cdn.jsdelivr.net']);
  const leaked = [];
  page.on('request', request => {
    const url = new URL(request.url());
    if (request.url().startsWith(BASE)) return;
    if (!STATIC_HOSTS.has(url.hostname) || request.method() !== 'GET' || request.postData()) leaked.push(`${request.method()} ${request.url()}`);
  });
  await page.reload({ waitUntil: 'load' });
  await page.waitForSelector('#arenaRoot');
  assert.deepEqual(leaked, [], `연구 데이터가 외부로 나갔다: ${leaked.join(', ')}`);

  assert.deepEqual(failures, [], `브라우저 오류: ${failures.join(' | ')}`);
  console.log(`[browser-research] PASS — Chromium /research · 자동채점 ${scored.total}점 · 모바일 390px · 외부요청 0`);
} finally {
  await browser.close();
  stop();
}
