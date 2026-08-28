(function initDeidReport(root) {
  'use strict';

  // 비식별화 성능 보고 화면 (/deid-report).
  //
  // 수치를 콘솔에서만 꺼낼 수 있으면 발표에 쓸 수 없다. 이 화면은 세 가지를 보여준다.
  //   1) 직접 테스트 — 문서 한 장을 지금 넣어 보고 무엇이 잡히는지 눈으로 본다
  //   2) 실사용 처리기록 — /field에서 실제로 비식별화한 문서의 결과가 쌓인다
  //   3) 합성 문서 배치 측정 — 정답지가 붙은 문서를 돌려 재현율을 잰다
  // 세 수치는 재는 것이 다르므로 화면에서도 끝까지 분리해 둔다. 특히 1번은
  // 같은 문서를 열 번 돌릴 수 있으므로 2번의 분모에 절대 섞지 않는다.

  const JSZIP_URL = 'https://cdn.jsdelivr.net/npm/jszip@3.10.1/dist/jszip.min.js';
  const SAMPLE_URL = '/samples/KCSI_MED_synthetic_docs.zip';

  const esc = value => String(value == null ? '' : value)
    .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
  const pct = value => (Number.isFinite(value) ? `${value}%` : '—');

  function isReportRoute() {
    const path = String(root.location && root.location.pathname || '').replace(/\/+$/, '') || '/';
    const search = String(root.location && root.location.search || '');
    return path === '/deid-report' || /(?:^|[?&])app=deid-report(?:&|$)/.test(search);
  }

  function loadScript(url, ready) {
    if (ready()) return Promise.resolve();
    return new Promise((resolve, reject) => {
      const script = document.createElement('script');
      script.src = url;
      script.async = true;
      script.onload = () => (ready() ? resolve() : reject(new Error('스크립트를 불러오지 못했습니다')));
      script.onerror = () => reject(new Error(`${url} 를 불러오지 못했습니다`));
      document.head.appendChild(script);
    });
  }

  function download(name, content, type) {
    const blob = new Blob([content], { type });
    const url = URL.createObjectURL(blob);
    const anchor = document.createElement('a');
    anchor.href = url;
    anchor.download = name;
    anchor.click();
    setTimeout(() => URL.revokeObjectURL(url), 1500);
  }

  const state = {
    batch: null, running: false, stop: false, sheet: null, images: new Map(),
    // 직접 테스트는 결과만 들고 있다가 다시 그릴 때 쓴다. 이미지는 캔버스에만 있고
    // 저장하지 않으므로 새로고침하면 사라진다 — 그게 맞는 동작이다.
    trial: null, trialRunning: false,
  };

  function markup() {
    return `<div class="arena-shell">
      <section class="arena-hero">
        <div class="arena-eyebrow">KCSI DEIDENTIFICATION · PERFORMANCE REPORT</div>
        <h1>비식별화 성능 보고</h1>
        <p>직접 테스트 · 실사용 처리기록 · 정답지가 붙은 합성 문서 채점을 함께 봅니다. 세 수치는 재는 것이 다르므로 바꿔 쓰지 마세요.</p>
        <div class="arena-privacy">🔐 문서는 브라우저 메모리에서만 처리합니다. 이미지와 개인정보 값은 저장하지도 전송하지도 않습니다.</div>
      </section>

      <section class="arena-card">
        <div class="arena-card-h"><div><h2><span class="arena-step">1</span>직접 테스트</h2>
        <p>문서 한 장을 넣어 <b>지금 이 규칙이 무엇을 잡는지</b> 눈으로 봅니다. 아래 2번 실사용 기록과 분모를 섞지 않고 따로 셉니다.</p></div></div>
        <div class="kcsi-report-warn">
          <b>여기서는 가린 사본이 만들어지지 않습니다.</b>
          이 화면은 탐지 결과만 보여주는 측정용입니다. 실제로 가린 파일을 받으려면
          <a href="/field">/field</a>에서 사람 확인을 거쳐야 합니다.
        </div>
        <div class="arena-dataset-import" id="deidTrialControls">
          <div><b>테스트할 문서</b><span>진단서·처방전·검사결과지 등 의료기록 이미지 한 장.</span>
          <span class="arena-dataset-random" id="deidTrialNote">JPG · PNG · 사진 촬영</span></div>
          <select class="arena-select" id="deidTrialCondition" aria-label="촬영 조건">
            <option value="original" selected>정상 스캔</option>
            <option value="fold">접힘</option>
            <option value="crumple">구겨짐</option>
            <option value="skew">기울어짐</option>
            <option value="lowlight">저조도</option>
            <option value="noise">노이즈</option>
            <option value="lowres">저해상도</option>
            <option value="unknown">모르겠음</option>
          </select>
          <button class="arena-action" type="button" id="deidTrialPick">📄 파일 선택</button>
          <button class="arena-action arena-action-ghost" type="button" id="deidTrialCamera">📷 촬영</button>
        </div>
        <input type="file" id="deidTrialFile" accept="image/*">
        <input type="file" id="deidTrialCameraFile" accept="image/*" capture="environment">
        <div class="arena-ocr-panel" id="deidTrialProgressWrap" hidden>
          <div class="arena-ocr-head"><div><b id="deidTrialPhase">준비 중</b><span id="deidTrialDetail"></span></div></div>
          <div class="arena-ocr-track"><span id="deidTrialBar"></span></div>
        </div>
        <div class="arena-stat-grid" id="deidTrialStats"></div>
        <div class="kcsi-report-preview" id="deidTrialPreviewWrap" hidden>
          <canvas id="deidTrialCanvas"></canvas>
          <div class="kcsi-report-preview-note" id="deidTrialPreviewNote"></div>
        </div>
        <div id="deidTrialFindings"></div>
      </section>

      <section class="arena-card">
        <div class="arena-card-h"><div><h2><span class="arena-step">2</span>실사용 처리기록</h2>
        <p><b>/field</b>에서 실제로 비식별화한 문서의 결과가 여기에 쌓입니다. 정답지가 없으므로 "얼마나 손이 덜 갔는가"를 재고, 개인정보를 빠짐없이 가렸는지는 아래 3번에서 잽니다.</p></div></div>
        <div class="arena-stat-grid" id="deidLiveStats"></div>
        <div class="arena-store" id="deidLiveSentences"></div>
        <div id="deidLiveTrialNote"></div>
        <div class="arena-dashboard-actions">
          <button class="arena-action secondary" type="button" id="deidLiveCsv">처리기록 CSV</button>
          <button class="arena-action secondary" type="button" id="deidLiveCopy">문장 복사</button>
          <button class="arena-action danger" type="button" id="deidLiveClear">처리기록 지우기</button>
        </div>
        <div id="deidLiveConditions"></div>
      </section>

      <section class="arena-card">
        <div class="arena-card-h"><div><h2><span class="arena-step">3</span>합성 문서 배치 측정</h2>
        <p>정답지가 붙은 합성 의료문서를 자동 탐지에 태워 <b>개인정보를 빠짐없이 가렸는지</b>를 잽니다. 사람 확인 창은 뜨지 않고 사본도 만들지 않습니다.</p></div></div>
        <div class="arena-dataset-import" id="deidBatchControls">
          <div><b>측정할 합성 문서 세트</b><span>npm run build:docs 로 만든 ZIP입니다.</span><span class="arena-dataset-random" id="deidBatchNote"></span></div>
          <select class="arena-select" id="deidBatchLimit" aria-label="측정할 문서 수">
            <option value="8">빠른 확인 · 8건</option>
            <option value="24">24건</option>
            <option value="0" selected>전체</option>
          </select>
          <button class="arena-action" type="button" id="deidBatchStart">📂 ZIP 불러와 측정</button>
          <button class="arena-action arena-action-ghost" type="button" id="deidBatchPick">다른 ZIP 선택</button>
        </div>
        <input type="file" id="deidBatchFile" accept=".zip,application/zip">
        <div class="arena-ocr-panel" id="deidBatchProgressWrap" hidden>
          <div class="arena-ocr-head"><div><b id="deidBatchPhase">측정 준비 중</b><span id="deidBatchDetail"></span></div>
          <button class="arena-preset" type="button" id="deidBatchStop">중단</button></div>
          <div class="arena-ocr-track"><span id="deidBatchBar"></span></div>
        </div>
        <details class="arena-glossary" id="deidSetProfile">
          <summary>이 합성 문서 세트는 무엇으로 만들어졌나</summary>
          <div id="deidSetProfileBody"></div>
        </details>
        <div class="arena-stat-grid" id="deidBatchStats"></div>
        <div class="arena-store" id="deidBatchSentences"></div>
        <div id="deidBatchTables"></div>
        <div class="arena-dashboard-actions" id="deidBatchActions" hidden>
          <button class="arena-action secondary" type="button" id="deidBatchCsv">측정결과 CSV</button>
          <button class="arena-action secondary" type="button" id="deidBatchCopy">문장 복사</button>
        </div>
      </section>

      <details class="arena-glossary" id="deidCiteRules" open>
        <summary>이 수치를 인용할 때의 규칙</summary>
        <div><section class="arena-glossary-group">
          <article class="arena-glossary-item"><b>표본 수 없이 비율만 쓰지 않는다</b><dl>
            <dt>이유</dt><dd>"100% 판독 가능"은 그 자체로 근거가 없는 문장입니다. 몇 건 중 몇 건인지 항상 함께 적습니다.</dd></dl></article>
          <article class="arena-glossary-item"><b>정상 스캔과 열화 조건을 나눠 적는다</b><dl>
            <dt>이유</dt><dd>접힘·구겨짐·기울어짐이 섞인 평균값은 어느 쪽도 대표하지 못합니다.</dd></dl></article>
          <article class="arena-glossary-item"><b>합성 문서 기준임을 밝힌다</b><dl>
            <dt>이유</dt><dd>실제 스캔본은 종이질·스캐너·조명이 제각각이라 성능이 다릅니다.</dd></dl></article>
          <article class="arena-glossary-item"><b>재현율과 과잉 가림을 함께 적는다</b><dl>
            <dt>이유</dt><dd>문서를 통째로 칠하면 재현율은 100%가 됩니다. 과잉 가림 배수 없이는 반쪽짜리 숫자입니다.</dd></dl></article>
          <article class="arena-glossary-item"><b>주 지표는 항목 재현율이다</b><dl>
            <dt>정의</dt><dd>정답지의 개인정보 항목 중 넓이의 90% 이상이 가려진 항목의 비율입니다.</dd>
            <dt>이유</dt><dd>문서 단위 "누락 0건" 비율은 7개 중 6개를 가린 문서와 하나도 못 가린 문서를 똑같은 실패로 셉니다. 개선해도 숫자가 안 움직여 무엇을 고쳐야 할지 알려주지 못합니다.</dd></dl></article>
          <article class="arena-glossary-item"><b>"완전 비식별화"라고 부르지 않는다</b><dl>
            <dt>바뀐 이름</dt><dd>누락 0건 문서</dd>
            <dt>이유</dt><dd>"완전 비식별화"는 통과한 문서가 법적으로 안전하다는 뜻으로 읽힙니다. 이 값이 재는 것은 "우리가 만든 정답지에 적힌 항목을 다 가렸는가"뿐이고, 정답지에 없는 개인정보는 애초에 세지 않습니다.</dd></dl></article>
          <article class="arena-glossary-item"><b>고위험 항목은 따로 적는다</b><dl>
            <dt>대상</dt><dd>주민등록번호 · 개인식별번호(환자번호·검사번호 등)</dd>
            <dt>이유</dt><dd>전체 평균 하나로는 이 두 종류가 통째로 빠져도 다른 항목에 묻혀 보이지 않습니다. 유출 시 피해가 가장 큰 항목이므로 분리해 봅니다.</dd></dl></article>
          <article class="arena-glossary-item"><b>규칙 상한과 실측을 함께 적는다</b><dl>
            <dt>규칙 상한</dt><dd>정답지의 라벨·값을 이미지 대신 글자로 규칙에 직접 넣었을 때의 재현율입니다. OCR이 완벽했을 때의 최댓값입니다.</dd>
            <dt>이유</dt><dd>누락이 "규칙이 그 칸을 개인정보로 안 봐서"인지 "OCR이 글자를 못 읽어서"인지 갈라 줍니다. 100%와 상한의 차이는 규칙을 고쳐야 줄고, 상한과 실측의 차이는 촬영·해상도로 줍니다.</dd></dl></article>
        </section></div>
      </details>
    </div>`;
  }

  // ── 직접 테스트 ────────────────────────────────────────────────────────────
  //
  // 배치 측정은 정답지가 있어야 돌고, /field는 사람 확인 창을 띄운다. 그 사이에
  // "내 문서 한 장 넣어 보면 뭐가 잡히나"를 볼 자리가 없었다. 여기가 그 자리다.
  // 사본을 만들지 않으므로 이것으로 비식별화를 마쳤다고 오해하지 않도록
  // 화면에도 못을 박아 둔다.

  function trialProgress(phase, detail, ratio) {
    const wrap = document.getElementById('deidTrialProgressWrap');
    if (!wrap) return;
    wrap.hidden = false;
    document.getElementById('deidTrialPhase').textContent = phase;
    document.getElementById('deidTrialDetail').textContent = detail || '';
    document.getElementById('deidTrialBar').style.width = `${Math.round((ratio || 0) * 100)}%`;
  }

  // 가려질 영역을 덮어 그린다. 실제 가림과 같은 상자를 쓰되 사본은 만들지 않는다.
  function drawTrialPreview(canvas, detection) {
    const target = document.getElementById('deidTrialCanvas');
    if (!target) return;
    const maxWidth = 720;
    const scale = Math.min(1, maxWidth / Math.max(1, canvas.width));
    target.width = Math.round(canvas.width * scale);
    target.height = Math.round(canvas.height * scale);
    const context = target.getContext('2d');
    context.drawImage(canvas, 0, 0, target.width, target.height);
    const boxes = detection.boxes || [];
    boxes.forEach(box => {
      context.fillStyle = '#111827';
      context.fillRect(box.x * scale, box.y * scale, box.w * scale, box.h * scale);
    });
    // 상자가 없으면 화면에 뜬 것은 가려진 그림이 아니라 원본 그대로다.
    // 설명을 고정해 두면 아무것도 못 가린 문서를 가려진 것처럼 보여주게 된다.
    document.getElementById('deidTrialPreviewNote').textContent = boxes.length
      ? '가려질 영역을 덮어 그린 미리보기입니다. 이 이미지는 저장되지 않습니다.'
      : '가릴 영역을 찾지 못해 원본 그대로입니다. 이 이미지는 저장되지 않습니다.';
    document.getElementById('deidTrialPreviewWrap').hidden = false;
  }

  function renderTrial() {
    const stats = document.getElementById('deidTrialStats');
    const findings = document.getElementById('deidTrialFindings');
    if (!stats || !findings) return;
    const trial = state.trial;
    if (!trial) {
      stats.innerHTML = '';
      findings.innerHTML = '';
      return;
    }
    const kinds = trial.kinds || [];
    const total = kinds.reduce((sum, row) => sum + row.count, 0);
    stats.innerHTML = [
      { value: trial.ocrFailed ? '실패' : `${total}곳`, label: '가릴 영역' },
      { value: kinds.length ? `${kinds.length}종` : '—', label: '개인정보 종류' },
      { value: Number.isFinite(trial.meanConfidence) ? `${Math.round(trial.meanConfidence * 100)}%` : '—', label: 'OCR 평균 신뢰도' },
      { value: `${(trial.elapsedMs / 1000).toFixed(1)}초`, label: '소요 시간' },
    ].map(card => `<div class="arena-stat"><b>${esc(card.value)}</b><span>${esc(card.label)}</span></div>`).join('');

    // 무엇이 잡혔는지보다 "안 잡힌 게 있는지"가 중요하다. 판단은 사람이 해야 하므로
    // 눈으로 대조하라고 분명히 적는다.
    const verdict = trial.ocrFailed
      ? `<div class="kcsi-report-warn"><b>글자를 읽지 못했습니다.</b> ${esc(trial.ocrError || '')} 해상도를 높이거나 더 밝게 찍어 다시 시도하세요. <a href="/field">/field</a>에서는 직접 상자를 그려 가릴 수 있습니다.</div>`
      : (total
        ? `<div class="kcsi-report-note"><b>가릴 영역 ${total}곳을 찾았습니다.</b><div>미리보기에서 <b>가려지지 않은 개인정보가 남아 있는지 눈으로 대조하세요.</b> 이 화면은 찾은 것만 보여줄 뿐, 못 찾은 것은 알려주지 못합니다.</div></div>`
        : '<div class="kcsi-report-warn"><b>가릴 영역을 하나도 찾지 못했습니다.</b> 개인정보가 없는 문서일 수도 있고, 규칙이 못 잡은 것일 수도 있습니다. 문서에 이름·번호가 보인다면 규칙 공백입니다.</div>');

    findings.innerHTML = `${verdict}${kinds.length ? `
      <div class="arena-table-wrap"><table class="arena-table"><thead><tr><th>개인정보 종류</th><th>찾은 영역</th></tr></thead><tbody>${
        kinds.map(row => `<tr><td>${esc(row.kind)}</td><td>${row.count}</td></tr>`).join('')}</tbody></table></div>` : ''}`;
  }

  async function runTrial(file, condition) {
    const deid = root.KCSI_DEID;
    if (!deid || typeof deid.detectOnly !== 'function') {
      trialProgress('실행할 수 없음', '비식별화 모듈을 불러오지 못했습니다', 0);
      return;
    }
    state.trialRunning = true;
    state.trial = null;
    renderTrial();
    document.getElementById('deidTrialPreviewWrap').hidden = true;
    try {
      trialProgress('문서를 여는 중', file.name ? `${file.name.split('.').pop()} 파일` : '', 0.05);
      const bitmap = await createImageBitmap(file);
      const canvas = document.createElement('canvas');
      canvas.width = bitmap.width;
      canvas.height = bitmap.height;
      canvas.getContext('2d').drawImage(bitmap, 0, 0);
      if (bitmap.close) bitmap.close();

      const detection = await deid.detectOnly(canvas, {
        onProgress: message => trialProgress('탐지 중', message, 0.5),
      });
      const kinds = new Map();
      (detection.boxes || []).forEach(box => {
        const kind = String(box.kind || '기타');
        kinds.set(kind, (kinds.get(kind) || 0) + 1);
      });

      // 이 문서로 한 번 돌린 것을 기록에 남긴다. 출처를 report_test로 박아
      // /field 실사용 비율이 시험 삼아 돌린 것으로 흔들리지 않게 한다.
      const ext = String(file.name || '').split('.').pop();
      deid.recordDetection(detection, {
        source: 'report_test',
        sourceType: 'image',
        sourceExt: ext && ext.length <= 8 ? ext : '',
        condition,
      });

      state.trial = {
        ...detection,
        kinds: [...kinds.entries()].map(([kind, count]) => ({ kind, count })).sort((a, b) => b.count - a.count),
      };
      drawTrialPreview(canvas, detection);
      trialProgress(detection.ocrFailed ? '탐지 실패' : '탐지 완료', `${(detection.elapsedMs / 1000).toFixed(1)}초`, 1);
      renderTrial();
      renderLive();
    } catch (error) {
      trialProgress('테스트 실패', (error && error.message) || '알 수 없는 오류', 0);
    } finally {
      state.trialRunning = false;
      await deid.closeOcr().catch(() => {});
    }
  }

  function renderLive() {
    const deid = root.KCSI_DEID;
    const logger = root.KCSIDocLog;
    if (!deid || !logger) return;
    // 실사용(/field)만 센다. 위 직접 테스트는 같은 문서를 열 번 돌릴 수 있어
    // 여기 분모에 들어가면 실사용 비율이 조용히 망가진다.
    const summary = deid.summarizeDocLog({ source: 'field' });
    const trials = deid.summarizeDocLog({ source: 'report_test' });
    const stats = document.getElementById('deidLiveStats');
    stats.innerHTML = [
      { value: summary.docs, label: '처리 문서(/field)' },
      { value: pct(summary.autoOnlyRate), label: '자동만으로 완료' },
      { value: pct(summary.manualTouchedRate), label: '사람이 손댐' },
      { value: summary.failed, label: '가림 없이 종료' },
    ].map(card => `<div class="arena-stat"><b>${esc(card.value)}</b><span>${esc(card.label)}</span></div>`).join('');
    document.getElementById('deidLiveSentences').innerHTML = summary.docs
      ? deid.docLogSentences({ source: 'field' }).map(line => `<div>${esc(line)}</div>`).join('')
      : '<div>아직 <b>/field</b>에서 처리한 문서가 없습니다. 의료기록을 비식별화하면 여기에 쌓입니다.</div>';
    // 직접 테스트 기록은 있다는 사실만 알리고 분모 밖에 둔다. CSV에는 출처 열로 함께 나간다.
    document.getElementById('deidLiveTrialNote').innerHTML = trials.docs
      ? `<div class="kcsi-report-note"><b>직접 테스트 ${trials.docs}건은 위 수치에서 빠져 있습니다.</b>`
        + `<div>같은 문서를 여러 번 돌릴 수 있어 실사용 비율과 섞으면 안 됩니다. `
        + `참고로 그중 ${trials.autoOnly}건(${pct(trials.autoOnlyRate)})에서 자동 탐지가 영역을 찾았습니다. `
        + `CSV에는 <code>source</code> 열로 함께 들어갑니다.</div></div>`
      : '';
    const conditions = summary.conditions.filter(item => item.condition !== 'unknown');
    document.getElementById('deidLiveConditions').innerHTML = conditions.length
      ? `<div class="arena-table-wrap"><table class="arena-table"><thead><tr><th>조건</th><th>문서</th><th>자동만</th><th>가림 완료율</th></tr></thead><tbody>${
        conditions.map(item => `<tr><td>${esc(item.condition)}</td><td>${item.docs}</td><td>${item.auto} (${pct(item.autoRate)})</td><td>${pct(item.handledRate)}</td></tr>`).join('')}</tbody></table></div>`
      : '';
  }

  // 규칙 상한선 블록.
  //
  // 누락 항목이 나왔을 때 원인은 "규칙이 그 칸을 개인정보로 안 본다"와
  // "OCR이 글자를 못 읽었다" 둘로 갈린다. 실측치만 보면 구분이 안 돼
  // 스캔 품질을 올려도 넘을 수 없는 벽을 품질 탓으로 오해한다.
  // 정답지의 라벨·값을 규칙에 글자로 직접 넣어 상한선을 재고, 그 차이를 나눠 적는다.
  function renderCeilingBlock(summary, ceiling) {
    if (!ceiling || !Number.isFinite(ceiling.itemCeiling)) {
      return '<div class="kcsi-report-note">이 정답지에는 항목별 라벨·값이 없어 규칙 상한선을 계산할 수 없습니다. '
        + '<code>npm run build:docs</code>로 다시 만든 팩을 쓰면 표시됩니다.</div>';
    }
    const measured = Number(summary.itemRecall);
    const ruleGap = Math.round(Math.max(0, 100 - ceiling.itemCeiling) * 10) / 10;
    const ocrLoss = Number.isFinite(measured) ? Math.round(Math.max(0, ceiling.itemCeiling - measured) * 10) / 10 : null;
    const gaps = (ceiling.gaps || []).slice(0, 5);
    return `
      <div class="kcsi-report-note">
        <b>규칙 상한 ${pct(ceiling.itemCeiling)} / 실측 ${pct(summary.itemRecall)}</b>
        <div>규칙 공백 ${ruleGap}%p — OCR이 완벽해도 현재 규칙이 못 잡는 몫입니다. 규칙을 고쳐야 줄어듭니다.</div>
        <div>OCR 손실 ${ocrLoss == null ? '—' : `${ocrLoss}%p`} — 규칙은 잡을 수 있는데 글자를 못 읽어 놓친 몫입니다. 촬영·해상도로 줄어듭니다.</div>
        ${gaps.length ? `<div>규칙이 못 잡는 칸: ${gaps.map(gap => `${esc(gap.label || gap.type)}(${gap.count}건)`).join(', ')}</div>` : ''}
      </div>`;
  }

  // ── 합성 문서 세트 구성 ────────────────────────────────────────────────────
  //
  // "합성 문서 120건으로 쟀습니다"만 적으면 그 120건이 무엇인지 알 수 없다. 어떤 칸을
  // 지어냈는지, 촬영 조건이 실제 왜곡인지 흉내인지, 값이 몇 종류인지를 보여준다.
  // 설명은 화면에 적어 두지 않고 불러온 정답지에서 뽑는다 — 적어 두면 팩을 바꿔도
  // 설명은 그대로 남아 조용히 거짓말이 된다.
  function renderSetProfile() {
    const body = document.getElementById('deidSetProfileBody');
    const wrap = document.getElementById('deidSetProfile');
    const describe = root.KCSISyntheticProfile;
    if (!body || !wrap) return;
    if (!state.sheet || !describe) {
      body.innerHTML = '<div class="kcsi-report-note">합성 문서 ZIP을 불러오면 이 세트가 무엇으로 만들어졌는지 여기에 표시됩니다.</div>';
      return;
    }
    const profile = describe.describeSyntheticSet(state.sheet);
    if (!profile.available) {
      body.innerHTML = `<div class="kcsi-report-warn">${esc(profile.reason || '정답지를 읽지 못했습니다.')}</div>`;
      return;
    }

    const formTables = profile.forms.map(form => `
      <h4>${esc(form.label)} · ${form.docs}건 · 개인정보 ${form.items}개</h4>
      <div class="arena-table-wrap"><table class="arena-table"><thead><tr>
        <th>서식의 칸</th><th>종류</th><th>건수</th><th>값 가짓수</th><th>합성값 예시</th>
      </tr></thead><tbody>${form.fields.map(field => `<tr>
        <td>${esc(field.label || '(라벨 없음)')}</td><td>${esc(field.type)}</td>
        <td>${field.count}</td><td>${field.distinct || '—'}</td>
        <td>${field.samples.length ? esc(field.samples.join(', ')) : '—'}</td>
      </tr>`).join('')}</tbody></table></div>`).join('');

    const rrn = profile.rrn;
    const rrnNote = rrn.checked
      ? (rrn.safe
        ? `<div class="kcsi-report-note"><b>주민등록번호 ${rrn.checked}개 전부가 실제로 발급될 수 없는 번호입니다.</b>`
          + `<div>정답지에 실린 값을 직접 검사한 결과입니다 — 월·일 자리가 존재하지 않는 조합(13월, 32일 이상)이라 어떤 실존 인물과도 겹칠 수 없습니다.</div></div>`
        : `<div class="kcsi-report-warn"><b>주민등록번호 ${rrn.checked}개 가운데 ${rrn.checked - rrn.impossible}개는 월·일이 실재할 수 있는 조합입니다.</b>`
          + `<div>예: ${esc(rrn.possible.join(', '))} — 실존 번호와 겹칠 수 있으므로 확인이 필요합니다.</div></div>`)
      : '';

    body.innerHTML = `
      <div class="arena-store">${describe.profileSentences(profile).map(line => `<div>${esc(line)}</div>`).join('')}</div>
      ${rrnNote}
      <h4>촬영 조건 — 무엇을 바꾼 것인가</h4>
      <div class="arena-table-wrap"><table class="arena-table"><thead><tr>
        <th>조건</th><th>문서</th><th>변형 방식</th><th>구체적으로</th>
      </tr></thead><tbody>${profile.conditions.map(row => `<tr>
        <td>${esc(row.label)}</td><td>${row.docs}</td>
        <td>${esc(row.kindLabel)}</td><td>${esc(row.detail || '—')}</td>
      </tr>`).join('')}</tbody></table></div>
      <h4>서식별로 무엇을 합성했나</h4>
      ${formTables}
      <h4>이 세트로 말할 수 없는 것</h4>
      <ul>${profile.caveats.map(line => `<li>${esc(line)}</li>`).join('')}</ul>`;
  }

  function renderBatch() {
    const runner = root.KCSIDocBatch;
    const result = state.batch;
    const stats = document.getElementById('deidBatchStats');
    const sentences = document.getElementById('deidBatchSentences');
    const tables = document.getElementById('deidBatchTables');
    const actions = document.getElementById('deidBatchActions');
    if (!result) {
      stats.innerHTML = '';
      sentences.innerHTML = '<div>합성 문서 ZIP을 불러와 측정하면 결과가 여기에 표시됩니다.</div>';
      tables.innerHTML = '';
      actions.hidden = true;
      return;
    }
    const summary = result.summary;
    const ceiling = result.ceiling;
    // 주 지표는 항목 재현율이다. 문서 단위 "누락 0건" 비율은 7개 중 6개를 가린 문서와
    // 하나도 못 가린 문서를 똑같이 실패로 세기 때문에 개선이 보이지 않는다.
    // 이름을 "완전 비식별화"에서 "누락 0건 문서"로 바꾼 것도 같은 이유다 —
    // 저 이름은 통과한 문서가 법적으로 안전하다는 뜻으로 읽힌다.
    stats.innerHTML = [
      { value: pct(summary.itemRecall), label: '항목 재현율(주 지표)' },
      { value: pct(summary.highRiskRecall), label: '고위험 항목 재현율' },
      { value: ceiling && Number.isFinite(ceiling.itemCeiling) ? pct(ceiling.itemCeiling) : '—', label: '규칙 상한' },
      { value: Number.isFinite(summary.meanMissedPerDoc) ? `${summary.meanMissedPerDoc}개` : '—', label: '문서당 평균 누락' },
      { value: summary.docs, label: '채점 문서' },
      { value: pct(summary.completeRate), label: '누락 0건 문서' },
      { value: Number.isFinite(summary.meanOverRedactionFactor) ? `${summary.meanOverRedactionFactor}배` : '—', label: '평균 과잉 가림' },
    ].map(card => `<div class="arena-stat"><b>${esc(card.value)}</b><span>${esc(card.label)}</span></div>`).join('');
    sentences.innerHTML = runner.batchSentences(result).map(line => `<div>${esc(line)}</div>`).join('');
    const ceilingByType = new Map(((ceiling && ceiling.types) || []).map(item => [item.type, item]));
    const distribution = summary.missDistribution || {};
    const distributionRate = summary.missDistributionRate || {};
    tables.innerHTML = `
      ${renderCeilingBlock(summary, ceiling)}
      <div class="arena-table-wrap"><table class="arena-table"><thead><tr><th>문서당 누락 항목 수</th><th>문서</th><th>비율</th></tr></thead><tbody>
        <tr><td>0개 (누락 0건 문서)</td><td>${distribution.none || 0}</td><td>${pct(distributionRate.none)}</td></tr>
        <tr><td>1개</td><td>${distribution.one || 0}</td><td>${pct(distributionRate.one)}</td></tr>
        <tr><td>2개 이상</td><td>${distribution.twoPlus || 0}</td><td>${pct(distributionRate.twoPlus)}</td></tr>
      </tbody></table></div>
      <div class="arena-table-wrap" style="margin-top:10px"><table class="arena-table"><thead><tr><th>촬영 조건</th><th>문서</th><th>항목 재현율</th><th>누락 0건 문서</th></tr></thead><tbody>${
        summary.conditions.map(item => `<tr><td>${esc(item.condition)}</td><td>${item.docs}</td><td>${pct(item.itemRecall)}</td><td>${item.complete} (${pct(item.completeRate)})</td></tr>`).join('')}</tbody></table></div>
      <div class="arena-table-wrap" style="margin-top:10px"><table class="arena-table"><thead><tr><th>개인정보 항목</th><th>개수</th><th>가려짐</th><th>재현율</th><th>규칙 상한</th></tr></thead><tbody>${
        summary.types.map(item => `<tr><td>${esc(item.type)}</td><td>${item.items}</td><td>${item.covered}</td><td>${pct(item.recall)}</td><td>${
          pct((ceilingByType.get(item.type) || {}).rate)}</td></tr>`).join('')}</tbody></table></div>`;
    actions.hidden = false;
  }

  function setProgress(phase, detail, ratio) {
    const wrap = document.getElementById('deidBatchProgressWrap');
    wrap.hidden = false;
    document.getElementById('deidBatchPhase').textContent = phase;
    document.getElementById('deidBatchDetail').textContent = detail || '';
    document.getElementById('deidBatchBar').style.width = `${Math.round((ratio || 0) * 100)}%`;
  }

  async function loadArchive(blob) {
    await loadScript(JSZIP_URL, () => !!root.JSZip);
    const archive = await root.JSZip.loadAsync(await blob.arrayBuffer());
    const answerEntry = archive.file('answer_sheet.json');
    if (!answerEntry) throw new Error('ZIP 안에 answer_sheet.json 이 없습니다. npm run build:docs 로 만든 파일인지 확인하세요');
    const sheet = JSON.parse(await answerEntry.async('string'));
    const images = new Map();
    Object.values(archive.files).forEach(entry => {
      if (!entry.dir && /^images\/.+\.(?:jpe?g|png)$/i.test(entry.name)) images.set(entry.name.split('/').pop(), entry);
    });
    if (!images.size) throw new Error('ZIP 안에 문서 이미지가 없습니다');
    state.sheet = sheet;
    state.images = images;
    document.getElementById('deidBatchNote').textContent = `${sheet.document_count || sheet.documents.length}건 · 항목 ${sheet.item_count || '?'}개 · 조건 ${(sheet.conditions || []).length}종`;
    renderSetProfile();
    return sheet;
  }

  async function runMeasurement() {
    const deid = root.KCSI_DEID;
    const runner = root.KCSIDocBatch;
    if (!deid || !runner || typeof deid.detectOnly !== 'function') {
      setProgress('실행할 수 없음', '비식별화 모듈을 불러오지 못했습니다', 0);
      return;
    }
    state.running = true;
    state.stop = false;
    const limitValue = Number(document.getElementById('deidBatchLimit').value) || 0;
    try {
      const result = await runner.runBatch(state.sheet, async (doc, position) => {
        const entry = state.images.get(doc.image);
        if (!entry) throw new Error(`이미지 ${doc.image} 를 찾지 못했습니다`);
        const blob = await entry.async('blob');
        const bitmap = await createImageBitmap(blob);
        const canvas = document.createElement('canvas');
        canvas.width = bitmap.width;
        canvas.height = bitmap.height;
        canvas.getContext('2d').drawImage(bitmap, 0, 0);
        bitmap.close && bitmap.close();
        setProgress(`측정 중 ${position.index + 1}/${position.total}`, `${doc.doc_id} · ${doc.condition_label || doc.condition}`, position.index / position.total);
        return deid.detectOnly(canvas);
      }, {
        limit: limitValue || undefined,
        shouldStop: () => state.stop,
        onProgress: event => {
          if (event.phase === 'done' || event.phase === 'error') {
            setProgress(`측정 중 ${event.index + 1}/${event.total}`, `${event.docId} · ${event.phase === 'error' ? '탐지 실패' : (event.complete ? '완전 가림' : '누락 있음')}`, (event.index + 1) / event.total);
          }
        },
      });
      state.batch = result;
      setProgress(state.stop ? '중단됨' : '측정 완료', `${result.scored}건 채점 · ${Math.round(result.totalElapsedMs / 1000)}초`, 1);
      renderBatch();
    } catch (error) {
      setProgress('측정 실패', error.message || '알 수 없는 오류', 0);
    } finally {
      state.running = false;
      await deid.closeOcr().catch(() => {});
    }
  }

  function bind() {
    // 직접 테스트. 파일 선택과 촬영은 입력만 다르고 이후 흐름은 같다.
    const startTrial = async file => {
      if (state.trialRunning || !file) return;
      const condition = document.getElementById('deidTrialCondition').value;
      await runTrial(file, condition);
    };
    document.getElementById('deidTrialPick').addEventListener('click', () => {
      if (!state.trialRunning) document.getElementById('deidTrialFile').click();
    });
    document.getElementById('deidTrialCamera').addEventListener('click', () => {
      if (!state.trialRunning) document.getElementById('deidTrialCameraFile').click();
    });
    ['deidTrialFile', 'deidTrialCameraFile'].forEach(id => {
      document.getElementById(id).addEventListener('change', async event => {
        const file = event.target.files && event.target.files[0];
        // 같은 파일을 연달아 고를 수 있게 값을 비운다.
        event.target.value = '';
        await startTrial(file);
      });
    });

    document.getElementById('deidLiveCsv').addEventListener('click', () => {
      const csv = root.KCSI_DEID.docLogCsv();
      if (!csv || csv.split('\r\n').length < 2) return;
      download(`KCSI_deident_log_${new Date().toISOString().slice(0, 10)}.csv`, csv, 'text/csv;charset=utf-8');
    });
    document.getElementById('deidLiveCopy').addEventListener('click', async () => {
      const text = root.KCSI_DEID.docLogSentences().join('\n');
      try { await navigator.clipboard.writeText(text); } catch (_) { root.prompt('아래 문장을 복사하세요', text); }
    });
    document.getElementById('deidLiveClear').addEventListener('click', () => {
      if (!root.confirm('이 브라우저의 비식별화 처리기록을 모두 지울까요?')) return;
      root.KCSI_DEID.clearDocLog();
      renderLive();
    });

    document.getElementById('deidBatchStart').addEventListener('click', async () => {
      if (state.running) return;
      try {
        if (!state.sheet) {
          setProgress('합성 문서 세트를 내려받는 중', SAMPLE_URL, 0);
          const response = await fetch(SAMPLE_URL, { cache: 'no-store' });
          if (response.status === 404) throw new Error('samples/KCSI_MED_synthetic_docs.zip 이 아직 배포에 없습니다. npm run build:docs 로 만들어 커밋하세요');
          if (!response.ok) throw new Error(`합성 문서 세트를 받지 못했습니다 (${response.status})`);
          await loadArchive(await response.blob());
        }
        await runMeasurement();
      } catch (error) {
        setProgress('측정 실패', error.message || '알 수 없는 오류', 0);
      }
    });
    document.getElementById('deidBatchPick').addEventListener('click', () => document.getElementById('deidBatchFile').click());
    document.getElementById('deidBatchFile').addEventListener('change', async event => {
      const file = event.target.files && event.target.files[0];
      event.target.value = '';
      if (!file) return;
      try {
        setProgress('ZIP을 여는 중', file.name, 0);
        await loadArchive(file);
        await runMeasurement();
      } catch (error) {
        setProgress('측정 실패', error.message || '알 수 없는 오류', 0);
      }
    });
    document.getElementById('deidBatchStop').addEventListener('click', () => { state.stop = true; });
    document.getElementById('deidBatchCsv').addEventListener('click', () => {
      if (!state.batch) return;
      download(`KCSI_deident_batch_${new Date().toISOString().slice(0, 10)}.csv`, root.KCSIDocBatch.buildBatchCsv(state.batch), 'text/csv;charset=utf-8');
    });
    document.getElementById('deidBatchCopy').addEventListener('click', async () => {
      if (!state.batch) return;
      const text = root.KCSIDocBatch.batchSentences(state.batch).join('\n');
      try { await navigator.clipboard.writeText(text); } catch (_) { root.prompt('아래 문장을 복사하세요', text); }
    });
  }

  function install() {
    if (!isReportRoute()) return;
    const app = document.getElementById('app');
    const header = app && app.querySelector('header');
    if (!app || !header || document.getElementById('deidReportRoot')) return;
    // 연구 화면과 같은 레이아웃을 쓰되 클래스는 따로 둔다 — 서로의 표시 규칙을 건드리지 않는다.
    app.classList.add('kcsi-report');
    document.documentElement.classList.add('kcsi-report-route');
    document.title = 'KCSI · 비식별화 성능 보고';
    const brand = header.querySelector('.brand');
    if (brand) brand.innerHTML = 'KCSI <b>Report</b> · 비식별화 성능';
    const container = document.createElement('div');
    container.id = 'deidReportRoot';
    container.innerHTML = markup();
    header.insertAdjacentElement('afterend', container);
    bind();
    renderLive();
    renderTrial();
    renderSetProfile();
    renderBatch();
  }

  if (typeof document !== 'undefined') {
    if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', install, { once: true });
    else install();
  }

  // render는 화면 밖에서 상태를 채운 뒤 다시 그리기 위해 노출한다.
  // 이게 없으면 ZIP 하나를 실제로 불러오지 않는 한 그려진 결과를 확인할 방법이 없다.
  root.KCSIDeidReport = {
    isReportRoute,
    install,
    state,
    render() {
      if (!document.getElementById('deidReportRoot')) return false;
      renderLive();
      renderTrial();
      renderSetProfile();
      renderBatch();
      return true;
    },
  };
})(typeof window !== 'undefined' ? window : globalThis);
