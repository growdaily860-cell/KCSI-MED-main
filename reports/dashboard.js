'use strict';

function pct(value) { return Number.isFinite(value) ? value * 100 : null; }

function buildDashboardViewModel(dataset) {
  const summary = dataset && dataset.summary || {};
  const cards = [
    ['전체 샘플', summary.total_samples, 'count'],
    ['완료', summary.completed, 'count'],
    ['오류', summary.errors, 'count'],
    ['Top-1 Accuracy', summary.top1_accuracy, 'ratio'],
    ['부분정답', summary.partial_rate, 'ratio'],
    ['위험 오식별', summary.high_confidence_misidentification, 'count'],
    ['앞면 imprint CER', summary.front_imprint_CER, 'ratio'],
    ['뒷면 imprint CER', summary.back_imprint_CER, 'ratio'],
    ['평균 confidence', summary.average_confidence, 'ratio'],
    ['Brier loss', summary.Brier_loss, 'number'],
    ['평균 latency', summary.average_latency_ms, 'ms'],
    ['총 비용', summary.total_cost_usd, 'usd'],
    ['sample당 비용', summary.cost_per_sample_usd, 'usd'],
    ['robustness score', summary.robustness_score, 'ratio'],
  ].map(([label, value, format]) => ({ label, value, format }));

  const models = (dataset && dataset.models || []).map(model => ({
    provider: model.provider,
    model: model.model,
    samples: model.samples,
    accuracy: pct(model.top1_accuracy),
    partial: pct(model.partial_rate),
    dangerous_misidentification: model.high_confidence_misidentification,
    front_imprint_CER: model.front_imprint_CER,
    back_imprint_CER: model.back_imprint_CER,
    confidence: model.average_confidence,
    Brier_loss: model.Brier_loss,
    latency_ms: model.average_latency_ms,
    total_cost_usd: model.total_cost_usd,
    cost_per_sample_usd: model.cost_per_sample_usd,
    robustness_score: model.robustness_score,
  }));

  const conditions = [];
  for (const [field, values] of Object.entries(dataset && dataset.conditions || {})) {
    for (const [value, stat] of Object.entries(values || {})) {
      conditions.push({ condition: field, value, samples: stat.samples, accuracy: pct(stat.top1_accuracy), error_rate: pct(stat.error_rate) });
    }
  }
  return { cards, models, conditions };
}

module.exports = { buildDashboardViewModel };
