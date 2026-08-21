// 확장 고정 샘플의 품목을 pill_db.json에서 결정적으로 선정한다.
// 출력을 scripts/mfds-sample-sets.mjs에 붙여 넣어 "고정 목록"으로 박아 둔다.
// 매번 무작위로 뽑지 않는 이유: 발표·재실험에서 같은 문제를 써야 비교가 성립한다.
//
//   node scripts/select-mfds-sample-items.mjs [--target=120] [--spare=30] [--base=<세트이름>]
//
// --base를 주면 그 세트의 후보 목록을 앞에 그대로 두고 뒤에만 덧붙인다.
// 세트끼리 앞부분이 같아야 작은 세트로 낸 결과를 큰 세트에서 그대로 이어 볼 수 있다.
//
// 선정 기준
//   - 식약처 공식 등록사진 URL이 허용 형식일 것
//   - 앞면 각인·모양·색상·제품명이 모두 있을 것 (정답지로 쓸 수 있어야 한다)
//   - 앞·뒷면 각인이 모두 있는 품목을 우선 (양면 판독이 연구 관심사)
//   - 모양·색상·약효분류가 한쪽으로 쏠리지 않도록 상한을 둔다
//   - 기존 20건은 순서 그대로 앞에 두어 확장 세트가 기존 세트를 포함하게 한다

import { createHash } from 'node:crypto';
import { readFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const projectRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const args = new Map(process.argv.slice(2).map(part => {
  const [key, value] = part.replace(/^--/, '').split('=');
  return [key, value === undefined ? 'true' : value];
}));
const target = Number(args.get('target') || 120);
const spare = Number(args.get('spare') || 30);
const baseSetName = args.get('base') || '';

const FIXED_20_IDS = [
  '196000011', '196400037', '197000037', '197000040', '197000050',
  '197400040', '197900277', '198700430', '199801026', '200000796',
  '200100565', '200108429', '200308358', '200401015', '200410082',
  '200410090', '200610660', '201103159', '201106367', '202106092',
];

// 확장 세트를 더 키울 때는 기존 세트의 후보 목록 전체를 앞에 그대로 둔다.
const BASE_ITEM_IDS = baseSetName
  ? (await import('./mfds-sample-sets.mjs')).findSampleSet(baseSetName).itemIds
  : FIXED_20_IDS;

const IMAGE_URL = /^https:\/\/nedrug\.mfds\.go\.kr\/pbp\/cmn\/itemImageDownload\/[0-9A-Za-z_-]+$/;
const text = value => String(value == null ? '' : value).trim();
// 품목 ID 해시로 정렬한다 — 등록 순서(=연도)나 이름 가나다순으로 뽑으면 표본이 한쪽으로 쏠린다.
const orderKey = id => createHash('sha256').update(`kcsi-mfds-sample:${id}`).digest('hex');

// 모양별 목표 비중. 실제 분포(원형 39% · 타원형 29% · 장방형 27%)를 따르되
// 희귀 모양을 일부러 남겨 둔다. 판독 난이도가 모양에 크게 걸리기 때문이다.
const SHAPE_QUOTA = [
  { match: shape => shape === '원형', share: 0.30 },
  { match: shape => shape === '타원형', share: 0.24 },
  { match: shape => shape === '장방형', share: 0.24 },
  { match: shape => !['원형', '타원형', '장방형'].includes(shape), share: 0.22 },
];
const COLOR_SHARE_CAP = 0.30;   // 한 색상이 세트의 30%를 넘지 않게
const CLASS_CAP = 4;            // 같은 약효분류 최대 4건

const database = JSON.parse(await readFile(path.join(projectRoot, 'pill_db.json'), 'utf8'));
const byId = new Map(database.items.map(item => [String(item.q), item]));

const usable = item => IMAGE_URL.test(text(item.img)) && text(item.pf) && text(item.sh) && text(item.k1) && text(item.n);

const base = BASE_ITEM_IDS.map(id => {
  const item = byId.get(id);
  if (!item) throw new Error(`pill_db.json에 품목 ${id}가 없습니다`);
  if (!usable(item)) throw new Error(`기존 고정 품목 ${id}가 선정 기준을 만족하지 않습니다`);
  return item;
});

const chosen = [...base];
const taken = new Set(chosen.map(item => text(item.q)));
const shapeCount = new Map();
const colorCount = new Map();
const classCount = new Map();
const shapeBucket = shape => SHAPE_QUOTA.findIndex(quota => quota.match(shape));
const bump = (map, key) => map.set(key, (map.get(key) || 0) + 1);
chosen.forEach(item => {
  bump(shapeCount, shapeBucket(text(item.sh)));
  bump(colorCount, text(item.k1));
  bump(classCount, text(item.cl));
});

const pool = database.items
  .filter(item => usable(item) && !taken.has(text(item.q)))
  .sort((left, right) => {
    // 양면 각인 우선, 그다음 해시 순서.
    const leftBoth = text(left.pb) ? 0 : 1;
    const rightBoth = text(right.pb) ? 0 : 1;
    if (leftBoth !== rightBoth) return leftBoth - rightBoth;
    return orderKey(text(left.q)) < orderKey(text(right.q)) ? -1 : 1;
  });

const total = target + spare;
const shapeLimit = SHAPE_QUOTA.map(quota => Math.round(quota.share * total));
const colorLimit = Math.max(1, Math.round(COLOR_SHARE_CAP * total));

for (const item of pool) {
  if (chosen.length >= total) break;
  const bucket = shapeBucket(text(item.sh));
  const color = text(item.k1);
  const category = text(item.cl);
  if ((shapeCount.get(bucket) || 0) >= shapeLimit[bucket]) continue;
  if ((colorCount.get(color) || 0) >= colorLimit) continue;
  if ((classCount.get(category) || 0) >= CLASS_CAP) continue;
  chosen.push(item);
  taken.add(text(item.q));
  bump(shapeCount, bucket);
  bump(colorCount, color);
  bump(classCount, category);
}

// 쿼터 때문에 목표를 못 채우면 남은 후보로 채운다(그래도 중복·기준은 지킨다).
if (chosen.length < total) {
  for (const item of pool) {
    if (chosen.length >= total) break;
    if (taken.has(text(item.q))) continue;
    chosen.push(item);
    taken.add(text(item.q));
  }
}

const summary = (label, values) => {
  const counts = new Map();
  values.forEach(value => bump(counts, value));
  return `${label}: ${[...counts.entries()].sort((a, b) => b[1] - a[1]).map(([key, count]) => `${key} ${count}`).join(' · ')}`;
};

const lines = chosen.map(item => `  '${text(item.q)}', // ${text(item.n)} · ${text(item.sh)} · ${text(item.k1)}${text(item.pb) ? ' · 양면각인' : ''}`);
process.stdout.write(`${lines.join('\n')}\n\n`);
process.stderr.write([
  `선정 ${chosen.length}건 (목표 ${target} + 예비 ${spare})`,
  summary('모양', chosen.map(item => text(item.sh))),
  summary('색상', chosen.map(item => text(item.k1))),
  `양면 각인: ${chosen.filter(item => text(item.pb)).length}건 / 앞면만: ${chosen.filter(item => !text(item.pb)).length}건`,
  `약효분류 수: ${new Set(chosen.map(item => text(item.cl))).size}`,
  `기준 세트(${baseSetName || 'fixed20'} · ${BASE_ITEM_IDS.length}건) 포함: ${BASE_ITEM_IDS.every(id => taken.has(id))}`,
  '',
].join('\n'));
