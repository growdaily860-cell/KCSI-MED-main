(function initRunStore(root, factory) {
  'use strict';

  const api = factory();
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
  if (root) root.KCSIRunStore = api;
})(typeof globalThis !== 'undefined' ? globalThis : this, function createRunStore() {
  'use strict';

  // 누적 연구결과 저장소.
  //
  // 브라우저 localStorage는 대략 5MB에서 막히고, 막히는 순간 setItem이 예외를 던진다.
  // 그 예외를 삼키면 화면은 "저장했습니다"라고 말하는데 실제로는 아무것도 남지 않는다.
  // 연구에서 이보다 나쁜 실패는 없다. 그래서 이 모듈은 저장 결과를 항상 사실대로 돌려준다.

  const BACKUP_KIND = 'kcsi-arena-runs-backup';
  const BACKUP_VERSION = 1;
  const DEFAULT_MAX_RUNS = 100;

  const safeText = value => String(value == null ? '' : value);
  const isObject = value => !!value && typeof value === 'object' && !Array.isArray(value);

  function describeError(error) {
    const name = safeText(error && error.name);
    const message = safeText(error && error.message);
    if (/quota|exceeded|NS_ERROR_DOM_QUOTA/i.test(`${name} ${message}`)) return 'quota';
    if (/security|denied|access/i.test(`${name} ${message}`)) return 'blocked';
    return 'unknown';
  }

  // 자동채점 산정 근거 문장은 채점하는 그 화면에서만 쓴다. 다시 열었을 때는 어디에도
  // 표시되지 않는데 저장 용량의 4분의 1을 차지한다. 총점·판정·항목점수는 남긴다 —
  // CSV와 보고서, 대시보드가 그 값들을 쓴다.
  function pruneRunForStorage(run) {
    if (!isObject(run)) return run;
    const copy = { ...run };
    if (isObject(run.results)) {
      copy.results = {};
      Object.keys(run.results).forEach(label => {
        const result = run.results[label];
        if (!isObject(result)) { copy.results[label] = result; return; }
        const next = { ...result };
        delete next.raw;
        if (isObject(next.autoRating)) {
          const auto = { ...next.autoRating };
          if (Array.isArray(auto.caseMetrics)) {
            auto.caseMetrics = auto.caseMetrics.map(metric => {
              if (!isObject(metric)) return metric;
              const trimmed = { ...metric };
              delete trimmed.reasons;
              return trimmed;
            });
          }
          next.autoRating = auto;
        }
        copy.results[label] = next;
      });
    }
    return copy;
  }

  function serializeRuns(runs) {
    return JSON.stringify((Array.isArray(runs) ? runs : []).map(pruneRunForStorage));
  }

  function estimateBytes(runs) {
    return serializeRuns(runs).length;
  }

  function loadRuns(raw) {
    try {
      const parsed = JSON.parse(safeText(raw) || '[]');
      return Array.isArray(parsed) ? parsed.filter(isObject) : [];
    } catch (_) {
      return [];
    }
  }

  /**
   * 저장한다. 용량이 모자라면 가장 오래된 배치부터 덜어내고 다시 시도하되,
   * 몇 건을 덜어냈는지 반드시 돌려준다. 조용히 버리지 않는다.
   * @returns {{ok:boolean, saved:number, dropped:number, bytes:number, runs:object[], reason:string}}
   */
  function saveRuns(runs, options = {}) {
    const setItem = typeof options.setItem === 'function' ? options.setItem : null;
    const maxRuns = Number.isFinite(options.maxRuns) ? Math.max(1, options.maxRuns) : DEFAULT_MAX_RUNS;
    const all = Array.isArray(runs) ? runs : [];
    let kept = all.slice(-maxRuns);
    let dropped = all.length - kept.length;
    let reason = '';

    if (!setItem) return { ok: false, saved: 0, dropped, bytes: 0, runs: kept, reason: 'blocked' };

    for (;;) {
      const payload = serializeRuns(kept);
      try {
        setItem(payload);
        return { ok: true, saved: kept.length, dropped, bytes: payload.length, runs: kept, reason: '' };
      } catch (error) {
        reason = describeError(error);
        if (reason !== 'quota' || !kept.length) {
          return { ok: false, saved: 0, dropped, bytes: payload.length, runs: kept, reason: reason || 'unknown' };
        }
        const remove = Math.max(1, Math.ceil(kept.length * 0.2));
        kept = kept.slice(remove);
        dropped += remove;
      }
    }
  }

  function backupFileName(now = new Date()) {
    const stamp = now.toISOString().slice(0, 19).replace(/[:T]/g, '').replace(/-/g, '');
    return `KCSI_Arena_runs_${stamp}.json`;
  }

  function buildBackup(runs, meta = {}) {
    const list = (Array.isArray(runs) ? runs : []).map(pruneRunForStorage);
    return {
      kind: BACKUP_KIND,
      version: BACKUP_VERSION,
      exported_at: safeText(meta.exportedAt) || new Date().toISOString(),
      app_version: safeText(meta.appVersion),
      count: list.length,
      runs: list,
    };
  }

  function parseBackup(text) {
    let parsed;
    try {
      parsed = JSON.parse(safeText(text));
    } catch (_) {
      return { ok: false, runs: [], reason: 'JSON 형식이 아닙니다' };
    }
    // 배열만 든 옛 백업도 받아 준다.
    const runs = Array.isArray(parsed) ? parsed : (isObject(parsed) && Array.isArray(parsed.runs) ? parsed.runs : null);
    if (!runs) return { ok: false, runs: [], reason: '연구기록 백업 파일이 아닙니다' };
    if (isObject(parsed) && parsed.kind && parsed.kind !== BACKUP_KIND) {
      return { ok: false, runs: [], reason: `다른 종류의 파일입니다(${safeText(parsed.kind)})` };
    }
    const valid = runs.filter(run => isObject(run) && safeText(run.id).trim() && isObject(run.results));
    if (!valid.length) return { ok: false, runs: [], reason: '복원할 배치가 없습니다' };
    return { ok: true, runs: valid, reason: '', skipped: runs.length - valid.length };
  }

  // 같은 배치를 두 번 세지 않는다. id와 실행시각이 모두 같으면 같은 배치로 본다.
  function runKey(run) {
    return `${safeText(run && run.id).trim()}@${safeText(run && run.createdAt).trim()}`;
  }

  function mergeRuns(existing, incoming) {
    const merged = new Map();
    [...(Array.isArray(existing) ? existing : []), ...(Array.isArray(incoming) ? incoming : [])]
      .filter(isObject)
      .forEach(run => { merged.set(runKey(run), run); });
    return [...merged.values()].sort((left, right) => {
      const a = Date.parse(safeText(left.createdAt)) || 0;
      const b = Date.parse(safeText(right.createdAt)) || 0;
      return a - b;
    });
  }

  function countNewRuns(existing, incoming) {
    const known = new Set((Array.isArray(existing) ? existing : []).filter(isObject).map(runKey));
    return (Array.isArray(incoming) ? incoming : []).filter(run => isObject(run) && !known.has(runKey(run))).length;
  }

  function storageReport(runs, options = {}) {
    const list = Array.isArray(runs) ? runs : [];
    const bytes = estimateBytes(list);
    const limit = Number.isFinite(options.limitBytes) ? options.limitBytes : 5 * 1024 * 1024;
    const maxRuns = Number.isFinite(options.maxRuns) ? options.maxRuns : DEFAULT_MAX_RUNS;
    // 앞으로 몇 배치를 더 담을 수 있는지. 용량과 보관 상한 중 먼저 걸리는 쪽이 답이다 —
    // 용량만 계산해 알리면 상한에서 오래된 배치가 밀려 나가는 것을 예고하지 못한다.
    const byBytes = list.length && bytes ? Math.max(0, Math.floor((limit - bytes) / (bytes / list.length))) : null;
    const bySlots = Math.max(0, maxRuns - list.length);
    return {
      runs: list.length,
      maxRuns,
      bytes,
      perRunBytes: list.length ? Math.round(bytes / list.length) : 0,
      usedRatio: limit ? bytes / limit : null,
      remainingRuns: byBytes == null ? bySlots : Math.min(byBytes, bySlots),
      // 무엇이 먼저 한계에 닿는지 — 백업을 언제 받아야 하는지 판단할 근거다.
      limitedBy: byBytes == null ? 'slots' : (byBytes < bySlots ? 'bytes' : 'slots'),
    };
  }

  return {
    BACKUP_KIND,
    BACKUP_VERSION,
    DEFAULT_MAX_RUNS,
    pruneRunForStorage,
    serializeRuns,
    estimateBytes,
    loadRuns,
    saveRuns,
    buildBackup,
    parseBackup,
    mergeRuns,
    countNewRuns,
    storageReport,
    backupFileName,
  };
});
