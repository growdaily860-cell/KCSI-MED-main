'use strict';

function csvCell(value) {
  let text = String(value == null ? '' : value).replace(/\r?\n/g, ' ');
  if (/^[=+\-@]/.test(text)) text = `'${text}`;
  return `"${text.replace(/"/g, '""')}"`;
}

function rowsFromDataset(dataset) {
  const headers = [
    'sample_id','run_id','provider','model','variant','classification','high_confidence_misidentification',
    'drug_name_truth','drug_name_prediction','front_imprint_truth','front_imprint_prediction','back_imprint_truth','back_imprint_prediction',
    'exact_match','partial_match','drug_name_similarity','front_imprint_similarity','back_imprint_similarity','imprint_CER',
    'confidence','Brier_loss','latency_ms','error_rate','legacy_score','input_tokens','output_tokens','cached_tokens','cost_usd','cost_source','error',
    'truth_mode','drug_code_exact','imprint_exact_match','imprint_partial_match','imprint_similarity',
    'front_imprint_CER','back_imprint_CER','imprint_orientation','evaluated_imprint_sides','invented_imprints',
    'pill_id','source_front_image','source_back_image','provided_sides','score_line',
  ];
  const rows = (dataset.samples || []).map(sample => [
    sample.sample_id, sample.run_id, sample.provider, sample.model, sample.variant, sample.classification, sample.high_confidence_misidentification,
    sample.answer && sample.answer.drug_name, sample.prediction && sample.prediction.drug_name,
    sample.answer && sample.answer.front_imprint, sample.prediction && sample.prediction.front_imprint,
    sample.answer && sample.answer.back_imprint, sample.prediction && sample.prediction.back_imprint,
    sample.metrics && sample.metrics.exact_match, sample.metrics && sample.metrics.partial_match, sample.metrics && sample.metrics.drug_name_similarity,
    sample.metrics && sample.metrics.front_imprint_similarity, sample.metrics && sample.metrics.back_imprint_similarity, sample.metrics && sample.metrics.imprint_CER,
    sample.metrics && sample.metrics.confidence, sample.metrics && sample.metrics.Brier_loss, sample.metrics && sample.metrics.latency,
    sample.metrics && sample.metrics.error_rate, sample.legacy_score && sample.legacy_score.total,
    sample.usage && sample.usage.input_tokens, sample.usage && sample.usage.output_tokens, sample.usage && sample.usage.cached_tokens,
    sample.usage && sample.usage.cost_usd, sample.usage && sample.usage.source, sample.error && (sample.error.message || sample.error.code || sample.error),
    sample.truth_mode || sample.metrics && sample.metrics.truth_mode,
    sample.metrics && sample.metrics.drug_code_exact,
    sample.metrics && sample.metrics.imprint_exact_match,
    sample.metrics && sample.metrics.imprint_partial_match,
    sample.metrics && sample.metrics.imprint_similarity,
    sample.metrics && sample.metrics.front_imprint_CER,
    sample.metrics && sample.metrics.back_imprint_CER,
    sample.metrics && sample.metrics.imprint_orientation,
    sample.metrics && sample.metrics.evaluated_imprint_sides,
    sample.metrics && sample.metrics.invented_imprints,
    sample.pill_id,
    sample.images && sample.images.front,
    sample.images && sample.images.back,
    sample.provided_sides || sample.condition && sample.condition.provided_sides,
    sample.score_line || sample.condition && sample.condition.score_line,
  ]);
  return { headers, rows };
}

function buildCsv(dataset) {
  const { headers, rows } = rowsFromDataset(dataset || {});
  return '\uFEFF' + [headers, ...rows].map(row => row.map(csvCell).join(',')).join('\r\n');
}

module.exports = { csvCell, rowsFromDataset, buildCsv };
