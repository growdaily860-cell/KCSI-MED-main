// ═══════════════════════════════════════════════════════════════════
// KCSI Copilot — 식약처 낱알식별 DB 자동 갱신 스크립트
// GitHub Actions에서 매월 실행 (수동 실행: Actions 탭 → Run workflow)
//
// 동작:
//   1. 공공데이터포털 '의약품 낱알식별 정보' OpenAPI 전체 페이지 수집
//   2. index.html 매칭 엔진(canonMark 등)과 동일한 정규화 적용
//   3. 리포 루트에 pill_db.json 생성 → 커밋되면 Vercel이 자동 배포
//   4. 'e약은요' OpenAPI 수집 → easy_db.json 생성 (효능·주의사항, 런타임 키 불필요)
//
// ※ easy_db.json을 pill_db.json에 병합하지 않고 분리하는 이유:
//   e약은요 본문(효능+주의사항)은 건당 1,000자 내외로 전체 수 MB에 달한다.
//   각인 매칭은 pill_db.json만으로 끝나므로, 상세 텍스트를 합치면 매칭 때마다
//   불필요한 수 MB를 모바일에서 내려받게 된다. 별도 파일로 두고 지연 로드한다.
//
// 필요 환경변수: DATA_GO_KR_KEY (공공데이터포털 Encoding 인증키)
//   ※ 해당 계정에 '의약품 낱알식별 정보' API 활용신청이 되어 있어야 함(자동승인)
//   ※ 'e약은요' API는 별도 활용신청 필요(자동승인). 미신청 시 easy_db.json만 생략되고
//     pill_db.json 갱신은 정상 진행된다.
// ═══════════════════════════════════════════════════════════════════
import { writeFileSync, readFileSync, existsSync } from 'node:fs';

const KEY = process.env.DATA_GO_KR_KEY;
if (!KEY) {
  console.error('❌ DATA_GO_KR_KEY 환경변수가 없습니다. (공공데이터포털 Encoding 인증키)');
  process.exit(1);
}

const OUT  = new URL('../pill_db.json', import.meta.url); // 리포 루트
const OUT_EASY = new URL('../easy_db.json', import.meta.url); // e약은요 상세 (지연 로드용)
const ROWS = 100;          // 페이지당 건수
const DROP_NO_MARK = true; // 각인이 전혀 없는 항목 제외 (각인 매칭 엔진상 어떤 경로로도 매칭 불가)

// 서비스 버전 자동 감지 — 신버전부터 시도, 응답하는 버전 사용 (식약처 버전 개편 대비)
const VERSIONS = [
  '1471000/MdcinGrnIdntfcInfoService03/getMdcinGrnIdntfcInfoList03',
  '1471000/MdcinGrnIdntfcInfoService02/getMdcinGrnIdntfcInfoList02',
  '1471000/MdcinGrnIdntfcInfoService01/getMdcinGrnIdntfcInfoList01',
];

// ── 마약류 성분 태깅 ──
// 식약처 '마약류 약물 및 오남용 정보' API에서 성분 목록을 받아,
// 품목명(성분 표기 포함)과 대조해 마약류 관리대상 품목에 nc 필드를 부여한다.
// ※ 이 API도 같은 인증키로 별도 활용신청 필요(자동승인). 미신청 시 태깅만 생략되고 DB 갱신은 계속된다.
const NARC_API = '1471000/NrcdGnrlzInfoService01/getNrcdGnrlzList';
const NARC_TAG_TYPES = new Set(['마약', '향정신성의약품', '대마']);  // 이 분류만 태깅 (기타/원료물질/환각성유해화학물 제외)
// 마약류 성분명을 '포함'하지만 마약류가 아닌 유사명 예외 (오탐 방지)
// 예: 아포모르핀(파킨슨 치료제)은 '모르핀'을 포함하지만 마약류가 아님
const NARC_EXCLUDE = [/아포모르핀/, /apomorphine/i];

// ── e약은요 (의약품개요정보) ──
// 런타임 DUR_KEY 없이도 효능·주의사항을 표시하기 위해 빌드타임에 미리 수집한다.
// 응답 필드는 낱알식별(대문자 SNAKE)과 달리 camelCase임에 주의.
const EASY_API = '1471000/DrbEasyDrugInfoService/getDrbEasyDrugList';

// ── 의약품 제품 허가정보 (효능효과 원문) ──
// e약은요는 일반의약품 중심(약 4.8천건)이라 실무 주 대상인 전문의약품이 대부분 누락된다.
// 허가정보는 허가된 전 품목(4.3만건)을 담고 있어 커버리지가 훨씬 넓고, 내용도 법적 원문
// (허가사항)이라 포렌식 리포트 근거로 더 적합하다. ITEM_SEQ가 낱알식별과 동일해 그대로 조인.
// 우선순위: 허가정보(prm) > e약은요(easy) — 둘 다 없으면 앱이 분류명으로 대체.
//
// ※ 아래 조합은 PROBE 모드로 실제 응답을 확인해 확정한 값이다(2026-07 기준).
//   서비스 경로는 07인데 오퍼레이션은 06으로, 버전 숫자가 일치하지 않는다.
//   추측으로 맞추다 두 번 실패했으므로 임의로 바꾸지 말 것.
//   재확인이 필요하면 PROBE=true로 실행하면 유효 조합과 필드명이 로그에 출력된다.
const PRM_VERSIONS = [
  '1471000/DrugPrdtPrmsnInfoService07/getDrugPrdtPrmsnDtlInq06',  // ✅ 확인된 조합
  '1471000/DrugPrdtPrmsnInfoService06/getDrugPrdtPrmsnDtlInq06',  // 폴백 (버전 승격 대비)
  '1471000/DrugPrdtPrmsnInfoService08/getDrugPrdtPrmsnDtlInq07',
];
// 허가정보는 전체 43,030건(2026-07 확인)으로 낱알식별의 1.7배다.
// 실측상 소요시간은 응답 크기보다 '요청 횟수'가 지배한다(페이지당 약 2초).
// 30건/페이지로 하면 1,435페이지 ≈ 50분이 되므로 100건/페이지(431페이지)로 둔다.
// 페이지 실패는 아래 재시도로 흡수한다.
const PRM_ROWS = 100;
const ATPN_MAX = 700;  // 주의사항 최대 길이 — 파일 비대화 방지 (초과 시 말줄임)
const EFCY_MAX = 500;  // 효능·적응증 최대 길이

// ── index.html의 canonMark와 반드시 동일하게 유지 ──
// 각인을 비교용 "순수 글자"로 정규화: 표기어 제거 → 영문/숫자/한글만 → 대문자
function canonMark(s) {
  if (!s || s === '없음' || s === '확인불가') return '';
  return String(s)
    .replace(/분할선|마크|식별/g, '')        // 표기어 제거
    .replace(/[^A-Za-z0-9가-힣]/g, '')        // 영문/숫자/한글 외 전부 제거
    .toUpperCase();
}

// ── index.html의 COLOR_MAP과 동일한 표준 색상어 매핑 ──
// DB측 색상도 앱의 15개 표준어로 통일해야 colorMatch가 정확히 동작한다 (예: 자주→보라)
const COLOR_MAP = [
  ['하양', /하양|흰|백색|화이트|아이보리|미백|유백/],
  ['노랑', /노랑|노란|황색|담황|미황|연노랑|황갈/],
  ['주황', /주황|오렌지|살구|귤/],
  ['분홍', /분홍|핑크|연분홍|살색/],
  ['빨강', /빨강|빨간|적색|레드|자적|진홍/],
  ['갈색', /갈색|브라운|밤색|적갈|황토|커피/],
  ['파랑', /파랑|파란|청색|블루|하늘/],
  ['남색', /남색|네이비|짙은파랑|어두운파랑/],
  ['청록', /청록|틸|민트/],
  ['초록', /초록|녹색|그린|진녹/],
  ['연두', /연두|연녹|라임|연초록/],
  ['보라', /보라|자주|퍼플|바이올렛|라벤더/],
  ['회색', /회색|그레이|은색|회백/],
  ['검정', /검정|검은|흑색|블랙/],
  ['투명', /투명|무색/],
];
// 앞/뒷면 색상값(복합값 포함)을 표준어로 정규화해 '|'로 결합
function normColors(...vals) {
  const out = [];
  for (const v of vals) {
    if (!v) continue;
    for (const tok of String(v).split(/[|,/·+\s]+/)) {
      if (!tok) continue;
      let std = tok;
      for (const [w, re] of COLOR_MAP) if (re.test(tok)) { std = w; break; }
      if (!out.includes(std)) out.push(std);
    }
  }
  return out.join('|');
}

// API 레코드 → 앱 DB 항목 (index.html이 사용하는 필드 스키마 유지)
function toEntry(it) {
  const pf = String(it.PRINT_FRONT || '').trim();
  const pb = String(it.PRINT_BACK  || '').trim();
  return {
    q:  String(it.ITEM_SEQ || ''),   // 품목기준코드 (e약은요·DUR 조회 키)
    n:  it.ITEM_NAME || '',          // 품목명
    e:  it.ENTP_NAME || '',          // 업체명
    pf, pb,                          // 원본 각인 (표시용)
    cf: canonMark(pf),               // 정규화 각인 (매칭용)
    cb: canonMark(pb),
    sh: it.DRUG_SHAPE || '',         // 모양
    k1: normColors(it.COLOR_CLASS1, it.COLOR_CLASS2), // 표준 색상 (앞|뒤 통합)
    fm: it.FORM_CODE_NAME || '',     // 제형
    c:  it.CHART || '',              // 성상
    cl: it.CLASS_NAME || '',         // 분류명
    ot: it.ETC_OTC_NAME || '',       // 전문/일반
    en: it.ITEM_ENG_NAME || '',      // 영문 품목명
    img: it.ITEM_IMAGE || '',        // 식약처 등록 낱알 사진 URL (현장 육안 대조용)
  };
}

function makeUrl(svc, pageNo, numOfRows = ROWS) {
  // serviceKey는 포털에서 이미 URL인코딩된 값(Encoding키)이므로 raw로 붙인다
  return `https://apis.data.go.kr/${svc}?serviceKey=${KEY}&type=json&numOfRows=${numOfRows}&pageNo=${pageNo}`;
}

async function getJson(url, tries = 3) {
  for (let a = 1; a <= tries; a++) {
    try {
      const res = await fetch(url);
      const txt = await res.text();
      if (!res.ok) throw new Error('HTTP ' + res.status);
      try { return JSON.parse(txt); }
      catch { throw new Error('JSON 아님(인증키 오류 시 XML 반환됨): ' + txt.slice(0, 160)); }
    } catch (e) {
      if (a === tries) throw e;
      await new Promise(r => setTimeout(r, 1500 * a)); // 재시도 백오프
    }
  }
}

const bodyOf  = d => d?.body ?? d?.response?.body ?? null;
const itemsOf = b => {
  const raw = b?.items ?? null;
  if (!raw) return [];
  if (Array.isArray(raw)) return raw;
  return raw.item ? (Array.isArray(raw.item) ? raw.item : [raw.item]) : [];
};

// 마약류 성분 목록 수집 — 실패해도 null 반환(태깅만 생략, DB 갱신은 계속)
async function fetchNarcotics() {
  try {
    const first = bodyOf(await getJson(makeUrl(NARC_API, 1, 100)));
    const total = Number(first?.totalCount || 0);
    if (!total) throw new Error('totalCount 0');
    const raw = [...itemsOf(first)];
    const pages = Math.ceil(total / 100);
    for (let p = 2; p <= pages; p++) {
      raw.push(...itemsOf(bodyOf(await getJson(makeUrl(NARC_API, p, 100)))));
      await new Promise(r => setTimeout(r, 80));
    }
    const out = raw.map(x => ({
      kr:   String(x.DRFSTF || '').replace(/\s+/g, ''),
      eng:  String(x.DRFSTF_ENG || '').trim().toLowerCase(),
      type: String(x.TYPE_CODE || '').trim(),
    })).filter(x => x.kr || x.eng);
    console.log(`✓ 마약류 성분 목록 ${out.length}건 수집 (태깅 대상: ${[...NARC_TAG_TYPES].join('/')})`);
    return out;
  } catch (e) {
    console.warn(`⚠ 마약류 목록 API 실패 — 이번 갱신은 마약류 태깅 없이 진행합니다. (${e.message})`);
    console.warn('  ↳ data.go.kr에서 "마약류 약물 및 오남용 정보" 활용신청(자동승인) 여부를 확인하세요.');
    return null;
  }
}

// 품목명·영문명에 마약류 성분명이 포함되면 nc(분류) 부여.
// 최장일치 우선: 더 긴 성분명이 먼저 매칭되므로, 목록에 '아포모르핀(기타)' 같은
// 상위 명칭이 있으면 '모르핀(마약)'보다 우선되어 자연스럽게 오탐이 걸러진다.
function tagNarcotics(entries, narc) {
  if (!narc || !narc.length) return 0;
  const kor = narc.filter(x => x.kr.length >= 2).sort((a, b) => b.kr.length - a.kr.length);
  const eng = narc.filter(x => x.eng.length >= 5).sort((a, b) => b.eng.length - a.eng.length);
  let tagged = 0; const stat = {};
  for (const e of entries) {
    const name = (e.n || '').replace(/\s+/g, '');
    const enName = (e.en || '').toLowerCase();
    if (NARC_EXCLUDE.some(rx => rx.test(name) || rx.test(enName))) continue;  // 알려진 유사명 제외
    let hit = kor.find(x => name.includes(x.kr));
    if (!hit && enName) hit = eng.find(x => enName.includes(x.eng));
    if (hit && NARC_TAG_TYPES.has(hit.type)) {
      e.nc = hit.type;
      tagged++; stat[hit.type] = (stat[hit.type] || 0) + 1;
    }
  }
  console.log(`✓ 마약류 태깅 ${tagged}건 — ` + (Object.entries(stat).map(([k, v]) => `${k} ${v}`).join(' · ') || '해당 없음'));
  return tagged;
}

// ── e약은요 본문 정리 ──
// 원문에는 <p> 태그·전각 공백·중복 개행이 섞여 있어 그대로 두면 카드에 깨져 보인다.
function cleanText(s, max) {
  if (!s) return '';
  const t = String(s)
    // CDATA를 태그 제거보다 먼저 푼다. <![CDATA[본문]]> 은 여는 '<'부터 닫는 '>'까지
    // 사이에 '>'가 없어, 아래 태그 제거 정규식이 본문째로 삼켜버린다(실제로 발생).
    .replace(/<!\[CDATA\[([\s\S]*?)\]\]>/g, '$1')
    .replace(/<br\s*\/?>/gi, '\n')
    .replace(/<\/(p|PARAGRAPH|ARTICLE|SECTION)>/gi, '\n')
    .replace(/<[^>]+>/g, '')          // 잔여 태그 제거
    .replace(/&nbsp;/g, ' ')
    .replace(/&amp;/g, '&').replace(/&lt;/g, '<').replace(/&gt;/g, '>')
    .replace(/[ \u3000\t]+/g, ' ')
    .replace(/\n{2,}/g, '\n')
    .trim();
  return t.length > max ? t.slice(0, max).trim() + '…' : t;
}

// e약은요 전체 수집 — 실패해도 null 반환(easy_db.json만 생략, pill_db 갱신은 계속)
async function fetchEasy() {
  try {
    const first = bodyOf(await getJson(makeUrl(EASY_API, 1, 1)));
    const total = Number(first?.totalCount || 0);
    if (!total) throw new Error('totalCount 0');
    const pages = Math.ceil(total / ROWS);
    console.log(`✓ e약은요 전체 ${total}건 · ${pages}페이지 수집 시작`);

    const map = new Map(); // itemSeq → {ef, at}
    for (let p = 1; p <= pages; p++) {
      const b = bodyOf(await getJson(makeUrl(EASY_API, p, ROWS)));
      for (const it of itemsOf(b)) {
        const seq = String(it.itemSeq || '').trim();
        if (!seq) continue;
        const ef = cleanText(it.efcyQesitm, EFCY_MAX);
        const at = cleanText(it.atpnQesitm, ATPN_MAX);
        if (!ef && !at) continue;              // 빈 항목은 담지 않음
        if (!map.has(seq)) map.set(seq, { ef, at });
      }
      if (p % 10 === 0 || p === pages) console.log(`  … ${p}/${pages} 페이지 (누적 ${map.size}건)`);
      await new Promise(r => setTimeout(r, 80));
    }
    return map;
  } catch (e) {
    console.warn(`⚠ e약은요 API 실패 — easy_db.json 없이 진행합니다. (${e.message})`);
    console.warn('  ↳ data.go.kr에서 "의약품개요정보(e약은요)" 활용신청(자동승인) 여부를 확인하세요.');
    return null;
  }
}

// easy_db.json 저장 — 낱알식별 DB에 존재하는 품목만 남겨 파일을 최소화한다.
// (각인 없는 품목은 앱에서 조회될 일이 없음)
// 병합 우선순위: 허가정보(prm) > e약은요(easy). 각 항목에 출처를 src로 남겨
// 리포트에서 근거 출처를 명시할 수 있게 한다 (포렌식 추적성).
function writeEasyDb(prmMap, easyMap, entries, generated) {
  if (!prmMap && !easyMap) { console.warn('⚠ 효능 소스 없음 — easy_db.json 생략'); return; }
  const seqs = new Set(entries.map(e => e.q));
  const items = {};
  const stat = { prm: 0, easy: 0 };

  for (const seq of seqs) {
    const p = prmMap?.get(seq);
    const e = easyMap?.get(seq);
    // 허가정보 우선. 단 허가정보에 효능이 비어 있으면 e약은요로 보완.
    let rec = null, src = '';
    if (p && p.ef) { rec = p; src = 'prm'; }
    else if (e && e.ef) { rec = e; src = 'easy'; }
    else if (p && p.at) { rec = p; src = 'prm'; }
    else if (e && e.at) { rec = e; src = 'easy'; }
    if (!rec) continue;
    items[seq] = { ef: rec.ef || '', at: rec.at || '', src };
    stat[src]++;
  }
  const hit = Object.keys(items).length;

  // 안전장치 — 기존 대비 급감 시 유지
  let prev = 0;
  if (existsSync(OUT_EASY)) {
    try { prev = Object.keys(JSON.parse(readFileSync(OUT_EASY, 'utf8')).items || {}).length; } catch {}
  }
  if (prev && hit < prev * 0.9) {
    console.warn(`⚠ easy_db 안전장치: 신규 ${hit}건 < 기존 ${prev}건의 90% — easy_db.json 유지`);
    return;
  }
  writeFileSync(OUT_EASY, JSON.stringify({ generated, count: hit, items }));
  const mb = (JSON.stringify(items).length / 1048576).toFixed(2);
  const cover = ((hit / entries.length) * 100).toFixed(1);
  console.log(`✅ easy_db.json 생성 — ${hit}건 · 허가정보 ${stat.prm} · e약은요 ${stat.easy}`);
  console.log(`   낱알식별 ${entries.length}건 중 커버리지 ${cover}% · 약 ${mb}MB`);
}

// ── 허가사항 DOC_DATA 파서 ──
// EE_DOC_DATA(효능효과) 등은 <DOC><SECTION><ARTICLE title="..."><PARAGRAPH>… 구조다.
// type=json 요청 시에도 버전에 따라 (a) XML 문자열 그대로 (b) 파싱된 중첩 객체로
// 오는 경우가 모두 있어 양쪽을 방어적으로 처리한다.
// ※ 이 스크립트는 실 API 응답으로 검증되지 않았다. 최초 실행 시 로그의 샘플 출력을
//   반드시 눈으로 확인할 것 (아래 fetchPrm의 첫 페이지 미리보기).
function parseDocData(v, max) {
  if (!v) return '';
  // (b) 객체로 파싱되어 온 경우 — 모든 문자열 잎노드를 순회 수집
  if (typeof v === 'object') {
    const buf = [];
    (function walk(o) {
      if (o == null) return;
      if (typeof o === 'string') { buf.push(o); return; }
      if (Array.isArray(o)) { o.forEach(walk); return; }
      if (typeof o === 'object') {
        // title 속성은 조항 제목이라 본문보다 먼저 오게 유지
        if (o.title) buf.push(String(o.title));
        for (const [k, val] of Object.entries(o)) { if (k !== 'title') walk(val); }
      }
    })(v);
    return cleanText(buf.join('\n'), max);
  }
  // (a) XML 문자열 — title 속성을 살린 뒤 태그 제거
  return cleanText(
    String(v).replace(/<ARTICLE[^>]*title="([^"]*)"[^>]*>/gi, '\n$1\n'),
    max
  );
}

// 허가정보 전체 수집 — 실패해도 null 반환(e약은요로 폴백)
async function fetchPrm() {
  // 서비스 버전 감지
  let SVC = null, total = 0;
  for (const v of PRM_VERSIONS) {
    try {
      const b = bodyOf(await getJson(makeUrl(v, 1, 1)));
      const t = Number(b?.totalCount || 0);
      if (t > 0) { SVC = v; total = t; break; }
    } catch { console.log(`· ${v.split('/')[1]} 응답 없음 → 다음 버전 시도`); }
  }
  if (!SVC) {
    console.warn('⚠ 허가정보 API 응답 없음 — e약은요만으로 진행합니다.');
    console.warn('  ↳ data.go.kr에서 "의약품 제품 허가정보" 활용신청(자동승인) 여부를 확인하세요.');
    return null;
  }
  const pages = Math.ceil(total / PRM_ROWS);
  console.log(`✓ 허가정보 ${SVC.split('/')[1]} · 전체 ${total}건 · ${pages}페이지 수집 시작`);

  const map = new Map(); // ITEM_SEQ → {ef, at}
  let sampled = false, failed = 0;
  for (let p = 1; p <= pages; p++) {
    // 페이지 단위로 격리한다. 허가정보는 건당 허가사항 전문이 실려 응답이 무겁고,
    // 500페이지 넘게 도는 동안 일시적 실패가 나기 쉽다. 한 페이지 때문에 전체를
    // 날리면 pill_db.json 커밋까지 막히므로(실제 발생), 실패는 건너뛰고 계속 간다.
    let b = null;
    for (let tries = 1; tries <= 3; tries++) {
      try { b = bodyOf(await getJson(makeUrl(SVC, p, PRM_ROWS))); break; }
      catch (e) {
        if (tries === 3) { failed++; console.warn(`  ⚠ ${p}페이지 3회 실패 — 건너뜀 (${e.message})`); }
        else await new Promise(r => setTimeout(r, 500 * tries));   // 지수 백오프
      }
    }
    if (!b) continue;
    for (const it of itemsOf(b)) {
      const seq = String(it.ITEM_SEQ || '').trim();
      if (!seq) continue;
      const ef = parseDocData(it.EE_DOC_DATA, EFCY_MAX);  // 효능효과
      const at = parseDocData(it.NB_DOC_DATA, ATPN_MAX);  // 사용상의 주의사항
      if (!sampled && ef) {   // 최초 1건 미리보기 — 파서가 제대로 먹었는지 육안 확인용
        console.log(`  ┌ 파싱 샘플 [${it.ITEM_NAME || seq}]`);
        console.log(`  └ 효능효과: ${ef.slice(0, 120)}…`);
        sampled = true;
      }
      if (!ef && !at) continue;
      if (!map.has(seq)) map.set(seq, { ef, at });
    }
    if (p % 20 === 0 || p === pages) console.log(`  … ${p}/${pages} 페이지 (누적 ${map.size}건)`);
    await new Promise(r => setTimeout(r, 80));
  }
  if (failed) console.warn(`⚠ 허가정보 ${failed}/${pages}페이지 수집 실패 — 나머지로 진행`);
  return map;
}

// ═══════════════════════════════════════════════════════════════════
// 허가정보 API 스키마 탐색 (PROBE 모드)
// ───────────────────────────────────────────────────────────────────
// data.go.kr은 서비스 경로 버전과 오퍼레이션 버전이 일치하지 않는 경우가 많다.
// 실제로 활용신청 화면상 오퍼레이션은 07 / 06 / 07로 제각각이었고,
// 서비스 경로 버전은 화면에 드러나지 않는다. 추측으로 맞추다 두 번 실패했으므로,
// 조합을 직접 찔러보고 되는 것과 실제 응답 필드명을 로그로 확인한다.
// 전체 갱신(12분)을 돌리지 않고 스키마만 확인하고 끝난다.
// ═══════════════════════════════════════════════════════════════════
const PROBE_SERVICES = ['DrugPrdtPrmsnInfoService07','DrugPrdtPrmsnInfoService06',
                        'DrugPrdtPrmsnInfoService05','DrugPrdtPrmsnInfoService04',
                        'DrugPrdtPrmsnInfoService03','DrugPrdtPrmsnInfoService'];
const PROBE_OPS = ['getDrugPrdtPrmsnInq07','getDrugPrdtPrmsnDtlInq06','getDrugPrdtMcpnDtlInq07'];

async function probePrm() {
  console.log('═'.repeat(60));
  console.log('허가정보 API 스키마 탐색 (PROBE 모드) — DB 갱신은 수행하지 않습니다');
  console.log('═'.repeat(60));
  const found = [];
  for (const svc of PROBE_SERVICES) {
    for (const op of PROBE_OPS) {
      const path = `1471000/${svc}/${op}`;
      try {
        const d = await getJson(makeUrl(path, 1, 1), 1);
        const b = bodyOf(d);
        const total = Number(b?.totalCount || 0);
        if (!total) { console.log(`✗ ${svc}/${op} — totalCount 0`); continue; }
        const items = itemsOf(b);
        console.log('');
        console.log(`✅ ${svc}/${op}`);
        console.log(`   전체 ${total}건`);
        if (items[0]) {
          const keys = Object.keys(items[0]);
          console.log(`   필드 ${keys.length}개: ${keys.join(', ')}`);
          // 효능효과/주의사항/주성분 후보 필드의 실제 값 형태를 확인
          for (const k of keys) {
            const v = items[0][k];
            if (v == null || v === '') continue;
            const isDoc = /DOC_DATA|INGR|MATERIAL|EE_|NB_|UD_/i.test(k);
            if (!isDoc) continue;
            const t = typeof v;
            const preview = t === 'string' ? v.slice(0, 200) : JSON.stringify(v).slice(0, 200);
            console.log(`   ├ ${k} (${t}): ${preview}…`);
          }
        }
        found.push(`${svc}/${op}`);
        await new Promise(r => setTimeout(r, 150));
      } catch (e) {
        console.log(`✗ ${svc}/${op} — ${e.message.slice(0, 90)}`);
      }
    }
  }
  console.log('');
  console.log('═'.repeat(60));
  console.log(found.length ? `탐색 완료 — 유효 조합 ${found.length}개:\n  ${found.join('\n  ')}`
                           : '❌ 유효한 조합 없음 — 인증키 또는 활용신청 상태를 확인하세요');
  console.log('═'.repeat(60));
}

async function main() {
  // PROBE 모드 — 스키마만 확인하고 종료 (전체 갱신 없음)
  if (String(process.env.PROBE || '').toLowerCase() === 'true') {
    await probePrm();
    return;
  }

  // 1) 서비스 버전 감지
  let SVC = null, total = 0;
  for (const v of VERSIONS) {
    try {
      const b = bodyOf(await getJson(makeUrl(v, 1, 1)));
      const t = Number(b?.totalCount || 0);
      if (t > 0) { SVC = v; total = t; break; }
    } catch (e) { console.log(`· ${v.split('/')[1]} 응답 없음 → 다음 버전 시도`); }
  }
  if (!SVC) { console.error('❌ 낱알식별 API 응답 없음 — 인증키/활용신청 상태를 확인하세요.'); process.exit(1); }
  const pages = Math.ceil(total / ROWS);
  console.log(`✓ ${SVC.split('/')[1]} · 전체 ${total}건 · ${pages}페이지 수집 시작`);

  // 2) 전체 페이지 순회 수집
  const byId = new Map(); // ITEM_SEQ 기준 중복 제거
  let noMark = 0;
  for (let p = 1; p <= pages; p++) {
    const b = bodyOf(await getJson(makeUrl(SVC, p)));
    for (const it of itemsOf(b)) {
      const e = toEntry(it);
      if (!e.q) continue;
      if (DROP_NO_MARK && !e.cf && !e.cb) { noMark++; continue; } // 각인 없음 → 매칭 불가 항목 제외
      if (!byId.has(e.q)) byId.set(e.q, e);
    }
    if (p % 30 === 0 || p === pages) console.log(`  … ${p}/${pages} 페이지 (누적 ${byId.size}건)`);
    await new Promise(r => setTimeout(r, 80)); // 공공 API 부하 방지
  }
  const entries = [...byId.values()].sort((a, b) => a.q.localeCompare(b.q)); // 정렬 고정 → git diff 최소화

  // 2.5) 마약류 성분 태깅 (API 실패 시 태깅만 생략 — DB 갱신은 계속)
  const narc = await fetchNarcotics();
  tagNarcotics(entries, narc);

  // 3) 안전장치 — API 응답이 직전 대비 급감(90% 미만)하면 갱신 중단 (API 장애로 인한 DB 유실 방지)
  //    ※ 아래 4)에서 과거 품목을 합치므로, 비교는 '이번 API 응답 건수' 대 '직전 API 응답 건수'로 한다.
  //      병합 후 총건수로 비교하면 총건수는 절대 줄지 않아 안전장치가 영영 발동하지 않는다.
  let prevItems = [], prevApiCount = 0, prevTotal = 0;
  if (existsSync(OUT)) {
    try {
      const prev = JSON.parse(readFileSync(OUT, 'utf8'));
      prevItems = Array.isArray(prev) ? prev : (prev.items || []);
      prevTotal = prevItems.length;
      prevApiCount = Number(prev.apiCount || prev.count || prevTotal) || prevTotal;
    } catch {}
  }
  if (prevApiCount && entries.length < prevApiCount * 0.9) {
    console.error(`❌ 안전장치 발동: 이번 API ${entries.length}건 < 직전 API ${prevApiCount}건의 90% — pill_db.json 유지, 갱신 중단`);
    process.exit(1);
  }

  // 4) 과거 등재 품목 보존 (누적 병합)
  //    식약처 낱알식별 API는 '현재 유통 중'인 품목만 제공한다. 단종·허가취하되면 응답에서 빠지고,
  //    종전처럼 매번 전체를 덮어쓰면 그 품목은 DB에서 영구히 사라진다.
  //    그런데 변사 현장에서 나오는 약은 상당수가 그런 오래된 약이다(고령자 댁 보관분 등).
  //    실제 사례: 아크라톤정50mg(각인 IH AC50) — 2026-05 보험코드 삭제 후 API에서 제외되어
  //    앱에서 조회 불가. 약학정보원에는 여전히 등재되어 있다.
  //    → 한 번이라도 등재됐던 품목은 x:1(과거 등재) 표시를 달아 계속 보존한다.
  //      앱은 이 표시로 "현재 유통 목록에는 없는 품목"임을 조사관에게 알릴 수 있다.
  const freshIds = new Set(entries.map(e => e.q));
  let kept = 0;
  for (const old of prevItems) {
    if (!old || !old.q || freshIds.has(old.q)) continue;
    entries.push({ ...old, x: 1 });   // 과거 등재 — 현재 API 응답에는 없음
    kept++;
  }
  entries.sort((a, b) => a.q.localeCompare(b.q));   // 정렬 고정 → git diff 최소화

  // 5) 저장 — {generated, items} 형식 (index.html v10.5+가 기준일을 읽어 표시)
  const generated = new Date(Date.now() + 9 * 3600e3).toISOString().slice(0, 10); // KST 날짜
  const apiCount = freshIds.size;
  writeFileSync(OUT, JSON.stringify({ generated, source: SVC, count: entries.length, apiCount, items: entries }));
  console.log(`✅ pill_db.json 생성 완료 — 총 ${entries.length}건 (이번 API ${apiCount}건 + 과거 등재 보존 ${kept}건`
    + `, 각인 없음 제외 ${noMark}건, 직전 총 ${prevTotal || '없음'}건) · 기준일 ${generated}`);

  // 5) 효능·주의사항 수집 → easy_db.json
  //    허가정보(전문의약품 포함, 넓은 커버리지)를 주 소스로, e약은요를 보완 소스로 사용.
  //    ※ 이 단계는 무슨 일이 있어도 프로세스를 죽이면 안 된다.
  //      여기서 예외가 나면 node가 exit 1 → 워크플로 실패 → 커밋 스텝이 실행되지 않아
  //      이미 만들어둔 pill_db.json 갱신분까지 통째로 버려진다.
  try {
    const prmMap  = await fetchPrm();
    const easyMap = await fetchEasy();
    writeEasyDb(prmMap, easyMap, entries, generated);
  } catch (e) {
    console.warn(`⚠ easy_db 단계 실패 — pill_db.json 갱신은 정상 커밋됩니다. (${e.message})`);
  }
}

main().catch(e => { console.error('❌ 갱신 실패:', e.message); process.exit(1); });
