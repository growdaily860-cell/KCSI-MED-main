#!/usr/bin/env node
'use strict';

// threeui 배경 소스가 import하는 three 모듈만 node_modules에서 vendor/three로 복사한다.
//
// KCSI-MED는 번들러 없이 정적 파일을 그대로 배포하고, 현장에서 네트워크가 끊겨도 화면이
// 떠야 하므로 외부 CDN을 쓰지 않는다. threeui가 배포하는 원본 HTML은 importmap으로
// jsDelivr를 가리키므로, 실제로 필요한 파일을 저장소 안으로 들여오고 로더가 importmap을
// 로컬 경로로 바꿔치기한다(threeui/threeui-background.js).
//
//   node scripts/vendor-three.mjs           복사 실행
//   node scripts/vendor-three.mjs --check   복사본이 최신인지만 확인(종료코드 1이면 재실행 필요)

import { createRequire } from 'node:module';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const require = createRequire(import.meta.url);
const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const sourceDir = path.join(root, 'threeui', 'sources');
const vendorDir = path.join(root, 'vendor', 'three');
const checkOnly = process.argv.includes('--check');

// three/addons/<경로> 형태의 진입점을 소스 HTML에서 모은다.
const ADDON_SPECIFIER = /three\/addons\/([A-Za-z0-9_./-]+\.js)/g;
// 애드온끼리 서로 참조하는 상대경로 import를 따라가기 위한 패턴.
const RELATIVE_IMPORT = /(?:import|export)[\s\S]{0,200}?from\s*['"](\.[^'"]+)['"]|import\s*['"](\.[^'"]+)['"]/g;

function fail(message) {
  console.error(`vendor-three: ${message}`);
  process.exit(1);
}

// three는 package.json을 exports에 열어 두지 않으므로(0.165 기준) 진입 파일에서 위로 올라가며 찾는다.
function threePackageRoot() {
  let entry;
  try {
    entry = require.resolve('three');
  } catch {
    return fail('three가 설치돼 있지 않다 — 먼저 `npm install`을 실행한다');
  }
  for (let dir = path.dirname(entry); dir !== path.dirname(dir); dir = path.dirname(dir)) {
    const manifest = path.join(dir, 'package.json');
    if (fs.existsSync(manifest) && JSON.parse(fs.readFileSync(manifest, 'utf8')).name === 'three') return dir;
  }
  return fail(`three 패키지 경로를 찾지 못했다(${entry})`);
}

function threeVersion(threeRoot) {
  return JSON.parse(fs.readFileSync(path.join(threeRoot, 'package.json'), 'utf8')).version;
}

function collectEntrySpecifiers() {
  if (!fs.existsSync(sourceDir)) return [];
  const entries = new Set();
  for (const name of fs.readdirSync(sourceDir).sort()) {
    if (!name.endsWith('.html')) continue;
    const html = fs.readFileSync(path.join(sourceDir, name), 'utf8');
    for (const match of html.matchAll(ADDON_SPECIFIER)) entries.add(match[1]);
  }
  return [...entries];
}

// 진입점에서 시작해 상대 import를 따라가며 실제로 필요한 파일만 모은다.
// examples/jsm 전체는 15MB이고 그중 쓰는 건 수십 KB뿐이다.
function resolveGraph(threeRoot, entries) {
  const jsmDir = path.join(threeRoot, 'examples', 'jsm');
  const needed = new Map(); // 애드온 상대경로 → 원본 절대경로
  const queue = [...entries];
  while (queue.length) {
    const relative = path.normalize(queue.shift()).replace(/\\/g, '/');
    if (needed.has(relative)) continue;
    const absolute = path.join(jsmDir, relative);
    if (!fs.existsSync(absolute)) {
      fail(`three@${threeVersion(threeRoot)}에 examples/jsm/${relative}가 없다 — three 버전이 소스와 맞는지 확인한다`);
    }
    needed.set(relative, absolute);
    const code = fs.readFileSync(absolute, 'utf8');
    for (const match of code.matchAll(RELATIVE_IMPORT)) {
      const specifier = match[1] || match[2];
      if (!specifier) continue;
      queue.push(path.posix.join(path.posix.dirname(relative), specifier));
    }
  }
  return needed;
}

function plan() {
  const threeRoot = threePackageRoot();
  const entries = collectEntrySpecifiers();
  const files = new Map();
  files.set('three.module.js', path.join(threeRoot, 'build', 'three.module.js'));
  files.set('LICENSE', path.join(threeRoot, 'LICENSE'));
  for (const [relative, absolute] of resolveGraph(threeRoot, entries)) {
    files.set(path.posix.join('addons', relative), absolute);
  }
  return { version: threeVersion(threeRoot), entries, files };
}

function sameContent(target, source) {
  if (!fs.existsSync(target)) return false;
  return fs.readFileSync(target).equals(fs.readFileSync(source));
}

const { version, entries, files } = plan();

if (checkOnly) {
  const stale = [...files].filter(([relative, absolute]) => !sameContent(path.join(vendorDir, relative), absolute));
  if (stale.length) {
    fail(`vendor/three가 three@${version}와 다르다(${stale.length}개) — \`npm run vendor:three\`를 실행한다`);
  }
  console.log(`vendor-three: 최신 (three@${version}, 파일 ${files.size}개)`);
  process.exit(0);
}

// 생성물 디렉터리만 지우고 다시 만든다 — 손으로 넣은 파일이 남아 배포되는 것을 막는다.
fs.rmSync(vendorDir, { recursive: true, force: true });
for (const [relative, absolute] of files) {
  const target = path.join(vendorDir, relative);
  fs.mkdirSync(path.dirname(target), { recursive: true });
  fs.copyFileSync(absolute, target);
}

fs.writeFileSync(
  path.join(vendorDir, 'README.md'),
  [
    '# vendor/three (생성물)',
    '',
    `\`npm run vendor:three\`가 \`node_modules/three\`(three@${version})에서 복사한 파일이다. 직접 고치지 않는다.`,
    '',
    `threeui/sources의 배경 소스가 실제로 import하는 애드온만 담는다(현재 ${entries.length}개 진입점, 파일 ${files.size}개).`,
    '새 배경 소스를 `threeui/sources/`에 추가했다면 `npm run vendor:three`를 다시 실행한다.',
    '',
    'three.js는 MIT 라이선스이며 원문은 이 폴더의 `LICENSE`에 있다.',
    '',
  ].join('\n'),
);

console.log(`vendor-three: three@${version} → vendor/three (진입점 ${entries.length}개, 파일 ${files.size}개)`);
for (const entry of entries) console.log(`  addons/${entry}`);
