// ═══════════════════════════════════════════════════════════════════
// KCSI Copilot — pill_db.json 과거 등재 품목 복구 (1회성)
//
// 왜 필요한가:
//   식약처 낱알식별 API는 '현재 유통 중'인 품목만 제공한다. 단종·허가취하되면
//   응답에서 빠지고, 갱신 스크립트가 매번 전체를 덮어써 왔기 때문에 그 품목은
//   DB에서 영구히 사라졌다. 그런데 변사 현장에서 나오는 약은 상당수가 그런
//   오래된 약이다(고령자 댁 보관분 등).
//   실제 사례: 아크라톤정50mg(각인 IH AC50) — 2026-05 보험코드 삭제 후 조회 불가.
//
// 어떻게 복구하는가:
//   pill_db.json은 매월 자동 갱신되어 git에 커밋돼 왔다. 즉 과거 커밋마다
//   그 시점의 전체 품목 스냅샷이 남아 있다. 전체 이력을 합치면 한 번이라도
//   등재됐던 품목을 모두 되살릴 수 있다. 외부 데이터원이 필요 없다.
//
// 사용법 (리포 루트에서):
//   node scripts/recover_pill_db.mjs           # 미리보기 (파일 안 씀)
//   node scripts/recover_pill_db.mjs --write   # 실제 병합·저장
//
// 실행 후:
//   · 복구된 항목에는 x:1 (과거 등재) 표시가 붙는다.
//   · 이후 월간 갱신(update_pill_db.mjs)이 누적 병합으로 바뀌었으므로
//     이 스크립트는 다시 돌릴 필요가 없다.
// ═══════════════════════════════════════════════════════════════════
import { execFileSync } from 'node:child_process';
import { writeFileSync, existsSync, readFileSync } from 'node:fs';

const FILE  = 'pill_db.json';
const WRITE = process.argv.includes('--write');

const git = (args) =>
  execFileSync('git', args, { encoding: 'utf8', maxBuffer: 512 * 1024 * 1024 });

// 스냅샷 하나에서 항목 배열을 꺼낸다. 형식이 바뀐 적이 있어 둘 다 받는다.
function itemsOf(text) {
  const j = JSON.parse(text);
  return Array.isArray(j) ? j : (j.items || []);
}

function main() {
  if (!existsSync(FILE)) {
    console.error(`❌ ${FILE}이 없습니다. 리포 루트에서 실행하세요.`);
    process.exit(1);
  }

  // 1) 이 파일을 건드린 모든 커밋 (최신순)
  let shas = [];
  try {
    shas = git(['log', '--format=%H %ad', '--date=short', '--', FILE])
      .trim().split('\n').filter(Boolean).map(l => {
        const [sha, date] = l.split(' ');
        return { sha, date };
      });
  } catch (e) {
    console.error('❌ git 이력을 읽지 못했습니다:', e.message);
    console.error('   전체 이력이 있는 클론에서 실행하세요 (Actions라면 fetch-depth: 0).');
    process.exit(1);
  }
  if (!shas.length) { console.error('❌ 이 파일의 커밋 이력이 없습니다.'); process.exit(1); }
  console.log(`· ${FILE} 커밋 이력 ${shas.length}건 (${shas[shas.length-1].date} ~ ${shas[0].date})`);

  // 2) 현재 파일
  const curRaw  = JSON.parse(readFileSync(FILE, 'utf8'));
  const curArr  = Array.isArray(curRaw) ? curRaw : (curRaw.items || []);
  const merged  = new Map();                       // q → entry
  for (const e of curArr) if (e && e.q) merged.set(e.q, e);
  const curIds  = new Set(merged.keys());
  console.log(`· 현재 ${curIds.size}건`);

  // 3) 과거 스냅샷을 오래된 것부터 훑어 없는 품목만 채운다.
  //    최신 정보를 과거 값으로 덮지 않도록, 이미 있는 q는 건드리지 않는다.
  //    한 스냅샷씩 처리해 메모리에 여러 벌이 동시에 뜨지 않게 한다.
  const firstSeen = new Map();                     // q → 마지막으로 등재됐던 날짜
  let scanned = 0, failed = 0;
  for (let i = shas.length - 1; i >= 0; i--) {
    const { sha, date } = shas[i];
    let arr;
    try { arr = itemsOf(git(['show', `${sha}:${FILE}`])); }
    catch (e) { failed++; continue; }              // 형식이 다르거나 손상된 스냅샷은 건너뛴다
    scanned++;
    for (const e of arr) {
      if (!e || !e.q) continue;
      if (!merged.has(e.q)) merged.set(e.q, { ...e, x: 1 });   // 과거 등재
      if (!curIds.has(e.q)) firstSeen.set(e.q, date);          // 사라진 품목의 마지막 등재일
    }
    if (scanned % 5 === 0) console.log(`  … ${scanned}/${shas.length} 스냅샷 (누적 ${merged.size}건)`);
  }

  const recovered = merged.size - curIds.size;
  console.log(`\n· 스냅샷 ${scanned}건 조회${failed ? ` (건너뜀 ${failed}건)` : ''}`);
  console.log(`· 복구 대상 ${recovered}건`);

  if (recovered) {
    const sample = [...merged.values()].filter(e => e.x).slice(0, 15);
    console.log('\n  복구되는 품목 (최대 15건 예시)');
    for (const e of sample) {
      const mark = [e.cf, e.cb].filter(Boolean).join('/') || '-';
      console.log(`   · ${e.n || e.q}  각인 ${mark}  (마지막 등재 ${firstSeen.get(e.q) || '?'})`);
    }
  }

  if (!WRITE) {
    console.log('\n미리보기입니다. 실제로 반영하려면 --write 를 붙여 다시 실행하세요.');
    return;
  }
  if (!recovered) { console.log('\n복구할 항목이 없습니다. 파일을 변경하지 않습니다.'); return; }

  const entries = [...merged.values()].sort((a, b) => a.q.localeCompare(b.q));
  const out = {
    generated: curRaw.generated || new Date(Date.now() + 9 * 3600e3).toISOString().slice(0, 10),
    source: curRaw.source,
    count: entries.length,
    apiCount: curIds.size,          // 다음 갱신의 안전장치 기준
    recovered,
    items: entries,
  };
  writeFileSync(FILE, JSON.stringify(out));
  console.log(`\n✅ ${FILE} 갱신 — 총 ${entries.length}건 (현행 ${curIds.size} + 복구 ${recovered})`);
  console.log('   git add pill_db.json && git commit 후 배포하세요.');
}

main();
