// 비식별화 성능 측정용 합성 의료문서 표본을 만든다.
//
//   npm install --no-save sharp
//   node scripts/build-doc-samples.mjs                 # 서식 3종 × 조건 8종 × 5건 = 120건
//   node scripts/build-doc-samples.mjs --per=2         # 조건별 2건
//   node scripts/build-doc-samples.mjs --forms=diagnosis,lab
//
// 인터넷은 필요 없다. 실제 의료기록을 쓰지 않으므로 개인정보도 다루지 않는다.

import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { buildDocumentSamples } from './lib/build-doc-samples.mjs';

const projectRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const args = new Map(process.argv.slice(2).map(part => {
  const [key, value] = part.replace(/^--/, '').split('=');
  return [key, value === undefined ? 'true' : value];
}));

async function main() {
  const perCondition = Number(args.get('per') || 5);
  const formIds = args.get('forms') ? String(args.get('forms')).split(',').map(item => item.trim()).filter(Boolean) : null;
  const result = await buildDocumentSamples({
    perCondition,
    formIds,
    outputDirectory: path.join(projectRoot, 'samples'),
    log: message => process.stdout.write(`${message}\n`),
  });
  process.stdout.write([
    '',
    `완료: ${path.relative(projectRoot, result.archivePath)}`,
    `문서 ${result.manifest.document_count}건 · 개인정보 항목 ${result.manifest.item_count}개 · ${result.bytes.toLocaleString()} bytes`,
    '정답지는 ZIP 안 answer_sheet.json 과 samples/KCSI_MED_synthetic_docs.manifest.json 에 있습니다.',
    '',
  ].join('\n'));
}

main().catch(error => {
  console.error(error.message || error);
  process.exitCode = 1;
});
