import { createHash } from 'node:crypto';
import { execFile } from 'node:child_process';
import { mkdir, mkdtemp, readFile, rm, stat, utimes, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { promisify } from 'node:util';

const execFileAsync = promisify(execFile);
const projectRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const databasePath = path.join(projectRoot, 'pill_db.json');
const outputDirectory = path.join(projectRoot, 'samples');
const outputPath = path.join(outputDirectory, 'KCSI_MED_MFDS_sample_20.zip');
const metadataPath = path.join(outputDirectory, 'KCSI_MED_MFDS_sample_20.manifest.json');
const fixedTimestamp = new Date('2026-08-01T00:00:00.000Z');
const dataSourceUrl = 'https://www.data.go.kr/data/15057639/openapi.do';

// 발표와 반복 실험에서 같은 문제를 사용하도록 품목을 고정한다.
// 형태·색상·치료군이 한쪽으로 치우치지 않도록 대표적인 20개 품목을 선정했다.
const fixedItemIds = [
  '196000011', // 페니라민정
  '196400037', // 라식스정
  '197000037', // 아로나민골드정
  '197000040', // 대웅우루사연질캡슐
  '197000050', // 자이로릭정
  '197400040', // 인데놀정10mg
  '197900277', // 게보린정
  '198700430', // 알마겔정
  '199801026', // 훼스탈플러스정
  '200000796', // 아리셉트정5mg
  '200100565', // 가스모틴정5mg
  '200108429', // 아스피린프로텍트정100mg
  '200308358', // 센트룸정
  '200401015', // 글루코파지정500mg
  '200410082', // 비아그라정50mg
  '200410090', // 리피토정10mg
  '200610660', // 노바스크정5mg
  '201103159', // 모티리톤정
  '201106367', // 트라젠타정
  '202106092', // 타이레놀정500mg
];

const sha256 = value => createHash('sha256').update(value).digest('hex');
const csvCell = value => {
  let text = String(value ?? '');
  if (/^[=+\-@]/.test(text)) text = `'${text}`;
  return `"${text.replace(/"/g, '""')}"`;
};
const csv = rows => `\uFEFF${rows.map(row => row.map(csvCell).join(',')).join('\r\n')}\r\n`;
const sleep = milliseconds => new Promise(resolve => setTimeout(resolve, milliseconds));

async function downloadImage(url, targetPath) {
  let lastError;
  for (let attempt = 1; attempt <= 3; attempt += 1) {
    try {
      const response = await fetch(url, { headers: { 'User-Agent': 'KCSI-MED research sample builder/1.0' } });
      if (!response.ok) throw new Error(`HTTP ${response.status}`);
      const contentType = response.headers.get('content-type') || '';
      if (!contentType.includes('image/jpeg') && !contentType.includes('application/octet-stream')) {
        throw new Error(`예상하지 못한 Content-Type: ${contentType || '없음'}`);
      }
      const bytes = Buffer.from(await response.arrayBuffer());
      if (bytes.length < 10_000 || bytes[0] !== 0xff || bytes[1] !== 0xd8) throw new Error('유효한 JPEG가 아닙니다');
      await writeFile(targetPath, bytes);
      return bytes;
    } catch (error) {
      lastError = error;
      if (attempt < 3) await sleep(500 * attempt);
    }
  }
  throw new Error(`${url} 다운로드 실패: ${lastError && lastError.message}`);
}

async function splitCompositeImage(sourcePath, frontPath, backPath) {
  const { stdout } = await execFileAsync('identify', ['-format', '%w %h', sourcePath]);
  const [width, height] = stdout.trim().split(/\s+/).map(Number);
  if (!Number.isInteger(width) || !Number.isInteger(height) || width < 400 || height < 200) {
    throw new Error(`지원하지 않는 이미지 크기: ${stdout.trim()}`);
  }
  const leftWidth = Math.floor(width / 2);
  const rightWidth = width - leftWidth;
  await Promise.all([
    execFileAsync('convert', [sourcePath, '-crop', `${leftWidth}x${height}+0+0`, '+repage', '-strip', '-quality', '92', frontPath]),
    execFileAsync('convert', [sourcePath, '-crop', `${rightWidth}x${height}+${leftWidth}+0`, '+repage', '-strip', '-quality', '92', backPath]),
  ]);
  return { width, height, leftWidth, rightWidth };
}

async function main() {
  const database = JSON.parse(await readFile(databasePath, 'utf8'));
  const byId = new Map(database.items.map(item => [String(item.q), item]));
  const selected = fixedItemIds.map(itemId => {
    const item = byId.get(itemId);
    if (!item) throw new Error(`pill_db.json에서 품목 ${itemId}를 찾지 못했습니다`);
    if (!/^https:\/\/nedrug\.mfds\.go\.kr\/pbp\/cmn\/itemImageDownload\/[0-9A-Za-z_-]+$/.test(item.img || '')) {
      throw new Error(`품목 ${itemId}의 이미지 URL이 허용 형식이 아닙니다`);
    }
    return item;
  });

  const temporaryRoot = await mkdtemp(path.join(os.tmpdir(), 'kcsi-mfds-sample-'));
  const packRoot = path.join(temporaryRoot, 'KCSI_MED_MFDS_sample_20');
  const imagesDirectory = path.join(packRoot, 'images');
  await mkdir(imagesDirectory, { recursive: true });
  await mkdir(outputDirectory, { recursive: true });

  const answerHeader = [
    'case_id', 'pill_id', 'front_image', 'back_image', 'mfds_item_id', 'drug_name',
    'front_imprint', 'back_imprint', 'shape', 'color', 'mark_id', 'imprint_type',
    'score_line', 'expected_readable', 'light', 'background', 'blur', 'angle', 'notes',
  ];
  const answerRows = [answerHeader];
  const manifestRows = [[
    'case_id', 'mfds_item_id', 'drug_name', 'original_image_url', 'original_sha256',
    'original_width', 'original_height', 'front_sha256', 'back_sha256', 'source_data_date',
  ]];
  const manifestItems = [];

  for (let index = 0; index < selected.length; index += 1) {
    const item = selected[index];
    const caseId = `MFDS-${String(index + 1).padStart(3, '0')}`;
    const frontName = `${caseId}_front.jpg`;
    const backName = `${caseId}_back.jpg`;
    const originalPath = path.join(temporaryRoot, `${item.q}.jpg`);
    const frontPath = path.join(imagesDirectory, frontName);
    const backPath = path.join(imagesDirectory, backName);
    process.stdout.write(`[${index + 1}/${selected.length}] ${item.n}\n`);
    const originalBytes = await downloadImage(item.img, originalPath);
    const geometry = await splitCompositeImage(originalPath, frontPath, backPath);
    const [frontBytes, backBytes] = await Promise.all([readFile(frontPath), readFile(backPath)]);
    const hasScoreLine = /분할선/.test(`${item.pf || ''} ${item.pb || ''}`) ? '있음' : '없음';
    answerRows.push([
      caseId, item.q, frontName, backName, item.q, item.n, item.pf || '', item.pb || '',
      item.sh || '', item.k1 || '', '', '', hasScoreLine, 'TRUE', '식약처 공식 등록사진',
      '식약처 표준 배경', '선명', '정면', '공식 등록사진 좌우 분리본 · 기능검증용 고정 샘플',
    ]);
    manifestRows.push([
      caseId, item.q, item.n, item.img, sha256(originalBytes), geometry.width, geometry.height,
      sha256(frontBytes), sha256(backBytes), database.generated || '',
    ]);
    manifestItems.push({
      case_id: caseId,
      mfds_item_id: item.q,
      drug_name: item.n,
      original_image_url: item.img,
      original_sha256: sha256(originalBytes),
      original_size: { width: geometry.width, height: geometry.height },
      files: { front: frontName, back: backName },
      file_sha256: { front: sha256(frontBytes), back: sha256(backBytes) },
    });
    await sleep(150);
  }

  await writeFile(path.join(packRoot, 'answer_sheet.csv'), csv(answerRows));
  await writeFile(path.join(packRoot, 'source_manifest.csv'), csv(manifestRows));
  await writeFile(path.join(packRoot, 'README.txt'), [
    'KCSI MED · 식약처 낱알식별 고정 샘플 20건',
    '',
    '- 용도: /research 데이터셋 업로드·검증 및 4개 AI 모델 기본 성능 비교',
    '- 구성: answer_sheet.csv, source_manifest.csv, images/ 앞·뒷면 40장',
    '- 출처: 식품의약품안전처 의약품 낱알식별 정보 OpenAPI',
    `- 공공데이터 안내: ${dataSourceUrl}`,
    `- 원본 데이터 기준일: ${database.generated || '미상'}`,
    '- 변환: 식약처 공식 등록사진의 좌측을 앞면, 우측을 뒷면으로 분리',
    '- 주의: 공식 등록사진 기반 결과는 기능·기초 성능 확인용이며 실제 현장사진 정확도를 뜻하지 않습니다.',
    '- 주의: 의약품 식별 결과는 실물·포장·처방전 및 식약처 등록정보로 사람이 최종 확인해야 합니다.',
    '',
  ].join('\n'));

  const generatedFiles = [
    path.join(packRoot, 'answer_sheet.csv'),
    path.join(packRoot, 'source_manifest.csv'),
    path.join(packRoot, 'README.txt'),
    ...manifestItems.flatMap(item => [
      path.join(imagesDirectory, item.files.front),
      path.join(imagesDirectory, item.files.back),
    ]),
  ];
  await Promise.all(generatedFiles.map(filePath => utimes(filePath, fixedTimestamp, fixedTimestamp)));

  const temporaryZip = path.join(temporaryRoot, 'KCSI_MED_MFDS_sample_20.zip');
  await execFileAsync('zip', ['-X', '-q', '-r', temporaryZip, '.'], { cwd: packRoot });
  const zipBytes = await readFile(temporaryZip);
  await writeFile(outputPath, zipBytes);
  await writeFile(metadataPath, `${JSON.stringify({
    version: 1,
    sample_count: manifestItems.length,
    image_count: manifestItems.length * 2,
    source_data_date: database.generated || '',
    source_api: database.source || '',
    source_page: dataSourceUrl,
    archive: path.basename(outputPath),
    archive_bytes: (await stat(outputPath)).size,
    archive_sha256: sha256(zipBytes),
    items: manifestItems,
  }, null, 2)}\n`);
  await rm(temporaryRoot, { recursive: true, force: true });
  process.stdout.write(`완료: ${path.relative(projectRoot, outputPath)} (${zipBytes.length.toLocaleString()} bytes)\n`);
}

main().catch(error => {
  console.error(error);
  process.exitCode = 1;
});
