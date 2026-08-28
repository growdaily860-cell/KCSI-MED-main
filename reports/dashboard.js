'use strict';

function pct(value) { return Number.isFinite(value) ? value * 100 : null; }

function meanFinite(values) {
  const finite = (values || []).filter(Number.isFinite);
  return finite.length ? finite.reduce((sum, value) => sum + value, 0) / finite.length : null;
}

function ratio(rows, classification) {
  return rows.length ? rows.filter(row => row.classification === classification).length / rows.length : null;
}

function sampleTruthMode(sample) {
  const explicit = sample && (sample.truth_mode || sample.metrics && sample.metrics.truth_mode);
  if (explicit) return explicit;
  const answer = sample && sample.answer || {};
  if (String(answer.drug_name || answer.mfds_item_id || '').trim()) return 'drug';
  const imprints = [answer.front_imprint, answer.back_imprint].map(value => String(value == null ? '' : value).trim());
  return imprints.some(value => value && !/^\(?\s*(?:확인불가|판독불가|식별불가)\s*\)?$/i.test(value)) ? 'imprint' : 'none';
}

function combinedTruthMode(rows) {
  const modes = Array.from(new Set(rows.map(sampleTruthMode).filter(mode => mode && mode !== 'none')));
  return modes.length === 1 ? modes[0] : modes.length > 1 ? 'mixed' : 'none';
}

function imprintStats(rows) {
  return {
    samples: rows.length,
    accuracy: ratio(rows, 'correct'),
    partial_rate: ratio(rows, 'partial'),
    imprint_CER: meanFinite(rows.map(row => row.metrics && row.metrics.imprint_CER)),
    front_imprint_CER: meanFinite(rows.map(row => row.metrics && row.metrics.front_imprint_CER)),
    back_imprint_CER: meanFinite(rows.map(row => row.metrics && row.metrics.back_imprint_CER)),
    evaluated_imprint_sides: rows.reduce((sum, row) => sum + (Number(row.metrics && row.metrics.evaluated_imprint_sides) || 0), 0),
    invented_imprints: rows.reduce((sum, row) => sum + (Number(row.metrics && row.metrics.invented_imprints) || 0), 0),
  };
}

function buildDashboardViewModel(dataset) {
  const summary = dataset && dataset.summary || {};
  const samples = dataset && dataset.samples || [];
  const drugRows = samples.filter(sample => sampleTruthMode(sample) === 'drug');
  const imprintRows = samples.filter(sample => sampleTruthMode(sample) === 'imprint');
  const imprint = samples.length ? imprintStats(imprintRows) : {
    samples: summary.imprint_samples || 0,
    accuracy: summary.imprint_accuracy,
    partial_rate: summary.imprint_partial_rate,
    imprint_CER: summary.imprint_CER,
    front_imprint_CER: summary.front_imprint_CER,
    back_imprint_CER: summary.back_imprint_CER,
    evaluated_imprint_sides: summary.evaluated_imprint_sides || 0,
    invented_imprints: summary.invented_imprints || 0,
  };
  const top1Accuracy = samples.length ? ratio(drugRows, 'correct') : summary.top1_accuracy;
  const drugPartialRate = samples.length ? ratio(drugRows, 'partial') : summary.partial_rate;
  const dangerous = samples.length
    ? drugRows.filter(row => row.high_confidence_misidentification).length
    : summary.high_confidence_misidentification;
  const cards = [
    ['전체 샘플', summary.total_samples, 'count'],
    ['완료', summary.completed, 'count'],
    ['오류', summary.errors, 'count'],
    ['Top-1 Accuracy', top1Accuracy, 'ratio'],
    ['부분정답', drugPartialRate, 'ratio'],
    ['위험 오식별', dangerous, 'count'],
    ['앞면 imprint CER', summary.front_imprint_CER, 'ratio'],
    ['뒷면 imprint CER', summary.back_imprint_CER, 'ratio'],
    ['평균 confidence', summary.average_confidence, 'ratio'],
    ['Brier loss', summary.Brier_loss, 'number'],
    ['평균 latency', summary.average_latency_ms, 'ms'],
    ['총 비용', summary.total_cost_usd, 'usd'],
    ['sample당 비용', summary.cost_per_sample_usd, 'usd'],
    ['robustness score', summary.robustness_score, 'ratio'],
    ['각인 채점 샘플', imprint.samples, 'count'],
    ['각인 정확도', imprint.accuracy, 'ratio'],
    ['각인 부분정답', imprint.partial_rate, 'ratio'],
    ['전체 imprint CER', imprint.imprint_CER, 'ratio'],
    ['지어낸 각인', imprint.invented_imprints, 'count'],
  ].map(([label, value, format]) => ({ label, value, format }));

  const models = (dataset && dataset.models || []).map(model => {
    const modelRows = samples.filter(row => row.provider === model.provider && row.model === model.model);
    const modelDrugRows = modelRows.filter(row => sampleTruthMode(row) === 'drug');
    const modelImprintRows = modelRows.filter(row => sampleTruthMode(row) === 'imprint');
    const modelImprint = imprintStats(modelImprintRows);
    return {
      provider: model.provider,
      model: model.model,
      samples: model.samples,
      truth_mode: modelRows.length ? combinedTruthMode(modelRows) : model.truth_mode || 'unknown',
      accuracy: pct(modelRows.length ? ratio(modelDrugRows, 'correct') : model.top1_accuracy),
      partial: pct(modelRows.length ? ratio(modelDrugRows, 'partial') : model.partial_rate),
      imprint_accuracy: pct(modelRows.length ? modelImprint.accuracy : model.imprint_accuracy),
      imprint_partial: pct(modelRows.length ? modelImprint.partial_rate : model.imprint_partial_rate),
      imprint_CER: modelRows.length ? modelImprint.imprint_CER : model.imprint_CER,
      evaluated_imprint_sides: modelRows.length ? modelImprint.evaluated_imprint_sides : model.evaluated_imprint_sides,
      invented_imprints: modelRows.length ? modelImprint.invented_imprints : model.invented_imprints,
      dangerous_misidentification: model.high_confidence_misidentification,
      front_imprint_CER: model.front_imprint_CER,
      back_imprint_CER: model.back_imprint_CER,
      confidence: model.average_confidence,
      Brier_loss: model.Brier_loss,
      latency_ms: model.average_latency_ms,
      total_cost_usd: model.total_cost_usd,
      cost_per_sample_usd: model.cost_per_sample_usd,
      robustness_score: model.robustness_score,
    };
  });

  const conditions = [];
  for (const [field, values] of Object.entries(dataset && dataset.conditions || {})) {
    for (const [value, stat] of Object.entries(values || {})) {
      const matchingRows = samples.filter(sample => {
        const conditionValue = field === 'variant'
          ? sample.variant || sample.condition && sample.condition.variant
          : sample.condition && sample.condition[field];
        return String(conditionValue) === String(value);
      });
      const matchingDrugRows = matchingRows.filter(row => sampleTruthMode(row) === 'drug');
      const matchingImprintRows = matchingRows.filter(row => sampleTruthMode(row) === 'imprint');
      conditions.push({
        condition: field,
        value,
        samples: stat.samples,
        truth_mode: matchingRows.length ? combinedTruthMode(matchingRows) : 'unknown',
        accuracy: pct(matchingRows.length ? ratio(matchingDrugRows, 'correct') : stat.top1_accuracy),
        imprint_accuracy: pct(ratio(matchingImprintRows, 'correct')),
        invented_imprints: matchingImprintRows.reduce((sum, row) => sum + (Number(row.metrics && row.metrics.invented_imprints) || 0), 0),
        error_rate: pct(stat.error_rate),
      });
    }
  }
  const truthModeCounts = samples.reduce((counts, sample) => {
    const mode = sampleTruthMode(sample);
    counts[mode] = (counts[mode] || 0) + 1;
    return counts;
  }, { drug: 0, imprint: 0, none: 0 });
  return {
    truth_mode: combinedTruthMode(samples),
    truth_mode_counts: truthModeCounts,
    imprint_metrics: imprint,
    cards,
    models,
    conditions,
  };
}

module.exports = { buildDashboardViewModel };
