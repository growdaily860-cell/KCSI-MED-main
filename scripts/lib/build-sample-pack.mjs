// 고정 샘플 팩(ZIP + manifest) 생성 로직.
// CLI(scripts/build-mfds-sample-dataset.mjs)와 테스트가 함께 쓴다.
// 네트워크·이미지 도구를 주입할 수 있게 분리해 둔 이유는, 실제 식약처 서버 없이도
// 팩 구조·정답지·매니페스트를 자동 테스트로 검증하기 위해서다.

import { createHash } from 'node:crypto';
import { execFile } from 'node:child_process';
import { mkdir, mkdtemp, readFile, rm, stat, utimes, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { promisify } from 'node:util';

const execFileAsync = promisify(execFile);
const FIXED_TIMESTAMP = new Date('2026-08-01T00:00:00.000Z');
export const DATA_SOURCE_URL = 'https://www.data.go.kr/data/15057639/openapi.do';
export const IMAGE_URL_PATTERN = /^https:\/\/nedrug\.mfds\.go\.kr\/pbp\/cmn\/itemImageDownload\/[0-9A-Za-z_-]+$/;

export const sha256 = value => createHash('sha256').update(value).digest('hex');

const csvCell = value => {
  let text = String(value ?? '');
  if (/^[=+\-@]/.test(text)) text = `'${text}`;
  return `"${text.replace(/"/g, '""')}"`;
};
export const csv = rows => `﻿${rows.map(row => row.map(csvCell).join(',')).join('\r\n')}\r\n`;
const sleep = milliseconds => new Promise(resolve => setTimeout(resolve, milliseconds));

export async function downloadImage(url, targetPath) {
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

// 식약처 공식 등록사진은 좌측이 앞면, 우측이 뒷면인 한 장짜리 합성 이미지다.
// sharp가 있으면 sharp로 자른다 — 같은 입력에서 어느 기기든 같은 결과가 나온다.
// 없으면 기존처럼 ImageMagick을 쓴다(기존 20건 팩을 만든 방식).
async function loadSharp() {
  try {
    const module = await import('sharp');
    return module.default || module;
  } catch (_) {
    return null;
  }
}

export async function splitCompositeImage(sourcePath, frontPath, backPath) {
  const sharp = await loadSharp();
  if (sharp) {
    const image = sharp(sourcePath, { failOn: 'error' });
    const { width, height } = await image.metadata();
    assertGeometry(width, height);
    const leftWidth = Math.floor(width / 2);
    const rightWidth = width - leftWidth;
    await sharp(sourcePath).extract({ left: 0, top: 0, width: leftWidth, height })
      .jpeg({ quality: 92, mozjpeg: false }).toFile(frontPath);
    await sharp(sourcePath).extract({ left: leftWidth, top: 0, width: rightWidth, height })
      .jpeg({ quality: 92, mozjpeg: false }).toFile(backPath);
    return { width, height, leftWidth, rightWidth, splitter: 'sharp' };
  }
  const { stdout } = await execFileAsync('identify', ['-format', '%w %h', sourcePath]);
  const [width, height] = stdout.trim().split(/\s+/).map(Number);
  assertGeometry(width, height, stdout.trim());
  const leftWidth = Math.floor(width / 2);
  const rightWidth = width - leftWidth;
  await Promise.all([
    execFileAsync('convert', [sourcePath, '-crop', `${leftWidth}x${height}+0+0`, '+repage', '-strip', '-quality', '92', frontPath]),
    execFileAsync('convert', [sourcePath, '-crop', `${rightWidth}x${height}+${leftWidth}+0`, '+repage', '-strip', '-quality', '92', backPath]),
  ]);
  return { width, height, leftWidth, rightWidth, splitter: 'imagemagick' };
}

function assertGeometry(width, height, raw) {
  if (!Number.isInteger(width) || !Number.isInteger(height) || width < 400 || height < 200) {
    throw new Error(`지원하지 않는 이미지 크기: ${raw || `${width}x${height}`}`);
  }
}

export function selectItems(database, set) {
  const byId = new Map(database.items.map(item => [String(item.q), item]));
  return set.itemIds.map(itemId => {
    const item = byId.get(String(itemId));
    if (!item) throw new Error(`pill_db.json에서 품목 ${itemId}를 찾지 못했습니다`);
    if (!IMAGE_URL_PATTERN.test(item.img || '')) {
      throw new Error(`품목 ${itemId}의 이미지 URL이 허용 형식이 아닙니다`);
    }
    return item;
  });
}

export const ANSWER_HEADER = [
  'case_id', 'pill_id', 'front_image', 'back_image', 'mfds_item_id', 'drug_name',
  'front_imprint', 'back_imprint', 'shape', 'color', 'mark_id', 'imprint_type',
  'score_line', 'expected_readable', 'light', 'background', 'blur', 'angle', 'notes',
];

export async function buildSamplePack(options) {
  const {
    set,
    database,
    outputDirectory,
    download = downloadImage,
    split = splitCompositeImage,
    log = () => {},
    throttleMs = 150,
  } = options;

  const candidates = selectItems(database, set);
  const temporaryRoot = await mkdtemp(path.join(os.tmpdir(), 'kcsi-mfds-sample-'));
  const packRoot = path.join(temporaryRoot, set.archiveBase);
  const imagesDirectory = path.join(packRoot, 'images');
  await mkdir(imagesDirectory, { recursive: true });
  await mkdir(outputDirectory, { recursive: true });

  const answerRows = [ANSWER_HEADER];
  const manifestRows = [[
    'case_id', 'mfds_item_id', 'drug_name', 'original_image_url', 'original_sha256',
    'original_width', 'original_height', 'front_sha256', 'back_sha256', 'source_data_date',
  ]];
  const manifestItems = [];
  const skipped = [];
  let splitter = '';

  for (const item of candidates) {
    if (manifestItems.length >= set.targetCount) break;
    const caseId = `${set.caseIdPrefix}-${String(manifestItems.length + 1).padStart(3, '0')}`;
    const frontName = `${caseId}_front.jpg`;
    const backName = `${caseId}_back.jpg`;
    const originalPath = path.join(temporaryRoot, `${item.q}.jpg`);
    const frontPath = path.join(imagesDirectory, frontName);
    const backPath = path.join(imagesDirectory, backName);
    log(`[${manifestItems.length + 1}/${set.targetCount}] ${item.n}`);
    let originalBytes;
    let geometry;
    try {
      originalBytes = await download(item.img, originalPath);
      geometry = await split(originalPath, frontPath, backPath);
    } catch (error) {
      // 후보를 목표보다 넉넉히 준비해 둔 이유가 여기다. 사진 몇 건이 빠져도 팩은 완성되어야 한다.
      skipped.push({ mfds_item_id: String(item.q), drug_name: item.n, reason: error && error.message ? error.message : String(error) });
      log(`  건너뜀: ${item.n} — ${error && error.message}`);
      continue;
    }
    splitter = geometry.splitter || splitter;
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
      mfds_item_id: String(item.q),
      drug_name: item.n,
      original_image_url: item.img,
      original_sha256: sha256(originalBytes),
      original_size: { width: geometry.width, height: geometry.height },
      files: { front: frontName, back: backName },
      file_sha256: { front: sha256(frontBytes), back: sha256(backBytes) },
    });
    if (throttleMs) await sleep(throttleMs);
  }

  if (manifestItems.length < set.targetCount) {
    await rm(temporaryRoot, { recursive: true, force: true });
    throw new Error(`목표 ${set.targetCount}건 중 ${manifestItems.length}건만 만들었습니다. 건너뛴 품목: ${skipped.length}건`);
  }

  await writeFile(path.join(packRoot, 'answer_sheet.csv'), csv(answerRows));
  await writeFile(path.join(packRoot, 'source_manifest.csv'), csv(manifestRows));
  await writeFile(path.join(packRoot, 'README.txt'), [
    `KCSI MED · ${set.label}`,
    '',
    '- 용도: /research 데이터셋 업로드·검증 및 4개 AI 모델 기본 성능 비교',
    `- 구성: answer_sheet.csv, source_manifest.csv, images/ 앞·뒷면 ${manifestItems.length * 2}장`,
    '- 출처: 식품의약품안전처 의약품 낱알식별 정보 OpenAPI',
    `- 공공데이터 안내: ${DATA_SOURCE_URL}`,
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
  await Promise.all(generatedFiles.map(filePath => utimes(filePath, FIXED_TIMESTAMP, FIXED_TIMESTAMP)));

  const archivePath = path.join(outputDirectory, `${set.archiveBase}.zip`);
  const metadataPath = path.join(outputDirectory, `${set.archiveBase}.manifest.json`);
  const temporaryZip = path.join(temporaryRoot, `${set.archiveBase}.zip`);
  await execFileAsync('zip', ['-X', '-q', '-r', temporaryZip, '.'], { cwd: packRoot });
  const zipBytes = await readFile(temporaryZip);
  await writeFile(archivePath, zipBytes);
  await writeFile(metadataPath, `${JSON.stringify({
    version: 1,
    set: set.name,
    sample_count: manifestItems.length,
    image_count: manifestItems.length * 2,
    candidate_count: set.itemIds.length,
    skipped_items: skipped,
    image_splitter: splitter,
    source_data_date: database.generated || '',
    source_api: database.source || '',
    source_page: DATA_SOURCE_URL,
    archive: path.basename(archivePath),
    archive_bytes: (await stat(archivePath)).size,
    archive_sha256: sha256(zipBytes),
    items: manifestItems,
  }, null, 2)}\n`);
  await rm(temporaryRoot, { recursive: true, force: true });
  return { archivePath, metadataPath, bytes: zipBytes.length, sampleCount: manifestItems.length, skipped };
}
