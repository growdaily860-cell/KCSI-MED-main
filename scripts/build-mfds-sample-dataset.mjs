// 식약처 공식 등록사진으로 고정 샘플 팩(ZIP + manifest)을 만든다.
//
//   node scripts/build-mfds-sample-dataset.mjs                 # 기존 20건 세트 (기본값)
//   node scripts/build-mfds-sample-dataset.mjs --set=extended120  # 확장 120건 세트
//   node scripts/build-mfds-sample-dataset.mjs --set=all
//
// 인터넷에서 nedrug.mfds.go.kr에 접속할 수 있는 환경에서 실행해야 한다.
// 사진 분할은 sharp가 설치돼 있으면 sharp를, 없으면 ImageMagick(identify/convert)을 쓴다.
// 품목 목록과 선정 기준은 scripts/mfds-sample-sets.mjs와
// scripts/select-mfds-sample-items.mjs에 있다.

import { readFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { buildSamplePack } from './lib/build-sample-pack.mjs';
import { SAMPLE_SETS, findSampleSet } from './mfds-sample-sets.mjs';

const projectRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const databasePath = path.join(projectRoot, 'pill_db.json');
const outputDirectory = path.join(projectRoot, 'samples');

async function main() {
  const argument = process.argv.slice(2).find(part => part.startsWith('--set='));
  const requested = argument ? argument.slice('--set='.length) : 'fixed20';
  const sets = requested === 'all' ? SAMPLE_SETS : [findSampleSet(requested)];
  const database = JSON.parse(await readFile(databasePath, 'utf8'));

  for (const set of sets) {
    process.stdout.write(`\n${set.label} (${set.name}) · 목표 ${set.targetCount}건 · 후보 ${set.itemIds.length}건\n`);
    const result = await buildSamplePack({
      set,
      database,
      outputDirectory,
      log: message => process.stdout.write(`${message}\n`),
    });
    if (result.skipped.length) {
      process.stdout.write(`건너뛴 품목 ${result.skipped.length}건 (매니페스트의 skipped_items 참고)\n`);
    }
    process.stdout.write(`완료: ${path.relative(projectRoot, result.archivePath)} · ${result.sampleCount}건 · ${result.bytes.toLocaleString()} bytes\n`);
  }
}

main().catch(error => {
  console.error(error);
  process.exitCode = 1;
});
