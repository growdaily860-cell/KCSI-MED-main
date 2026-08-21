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
    rubricVersion: globalThis.KCSIArenaRubric && globalThis.KCSIArenaRubric.RUBRIC_VERSION,
  }));
  assert.equal(globals.rubric, true, '자동채점 모듈 전역이 없다');
  assert.equal(globals.core, true, 'Arena 코어 전역이 없다');
  assert.equal(globals.platform, true, '연구 플랫폼 번들 전역이 없다');
  assert.equal(globals.datasetTools, true, '정답지 도구 전역이 없다');
  assert.equal(globals.rubricVersion, 'kcsi-arena-rubric-v1');

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
    '#arenaDatasetSampleLoad', '#arenaDatasetSampleLoad120', '#arenaDatasetRandomBatch', '#arenaDatasetRandomNote']) {
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
