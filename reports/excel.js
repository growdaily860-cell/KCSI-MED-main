'use strict';

function xmlEsc(value) {
  return String(value == null ? '' : value).replace(/[&<>'"]/g, ch => ({ '&':'&amp;','<':'&lt;','>':'&gt;',"'":'&apos;','"':'&quot;' })[ch]);
}
function columnName(index) {
  let value = index + 1, output = '';
  while (value) { value -= 1; output = String.fromCharCode(65 + (value % 26)) + output; value = Math.floor(value / 26); }
  return output;
}
function sheetXml(rows) {
  const body = (rows || []).map((row, r) => `<row r="${r + 1}">${row.map((value, c) => {
    const ref = `${columnName(c)}${r + 1}`;
    if (typeof value === 'number' && Number.isFinite(value)) return `<c r="${ref}"><v>${value}</v></c>`;
    if (typeof value === 'boolean') return `<c r="${ref}" t="b"><v>${value ? 1 : 0}</v></c>`;
    return `<c r="${ref}" t="inlineStr"><is><t xml:space="preserve">${xmlEsc(value)}</t></is></c>`;
  }).join('')}</row>`).join('');
  return `<?xml version="1.0" encoding="UTF-8" standalone="yes"?><worksheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main"><sheetData>${body}</sheetData></worksheet>`;
}

const CRC_TABLE = (() => {
  const table = new Uint32Array(256);
  for (let n = 0; n < 256; n += 1) { let c = n; for (let k = 0; k < 8; k += 1) c = (c & 1) ? 0xEDB88320 ^ (c >>> 1) : c >>> 1; table[n] = c >>> 0; }
  return table;
})();
function crc32(bytes) { let c = 0xFFFFFFFF; for (const byte of bytes) c = CRC_TABLE[(c ^ byte) & 0xFF] ^ (c >>> 8); return (c ^ 0xFFFFFFFF) >>> 0; }
function u16(value) { return [value & 255, (value >>> 8) & 255]; }
function u32(value) { return [value & 255, (value >>> 8) & 255, (value >>> 16) & 255, (value >>> 24) & 255]; }
function concat(parts) { const size = parts.reduce((sum, part) => sum + part.length, 0); const out = new Uint8Array(size); let offset = 0; for (const part of parts) { out.set(part, offset); offset += part.length; } return out; }
function zipStore(files) {
  const encoder = new TextEncoder();
  const locals = [], centrals = [];
  let offset = 0;
  for (const file of files) {
    const name = encoder.encode(file.name);
    const data = typeof file.content === 'string' ? encoder.encode(file.content) : file.content;
    const crc = crc32(data);
    const local = new Uint8Array([
      ...u32(0x04034b50), ...u16(20), ...u16(0), ...u16(0), ...u16(0), ...u16(0), ...u32(crc), ...u32(data.length), ...u32(data.length), ...u16(name.length), ...u16(0), ...name, ...data,
    ]);
    locals.push(local);
    const central = new Uint8Array([
      ...u32(0x02014b50), ...u16(20), ...u16(20), ...u16(0), ...u16(0), ...u16(0), ...u16(0), ...u32(crc), ...u32(data.length), ...u32(data.length), ...u16(name.length), ...u16(0), ...u16(0), ...u16(0), ...u16(0), ...u32(0), ...u32(offset), ...name,
    ]);
    centrals.push(central);
    offset += local.length;
  }
  const centralSize = centrals.reduce((sum, part) => sum + part.length, 0);
  const end = new Uint8Array([...u32(0x06054b50), ...u16(0), ...u16(0), ...u16(files.length), ...u16(files.length), ...u32(centralSize), ...u32(offset), ...u16(0)]);
  return concat([...locals, ...centrals, end]);
}
function safe(value) { return value == null ? '' : value; }
function buildSheets(dataset) {
  const summary = dataset.summary || {};
  const summaryRows = [['Metric','Value'], ...Object.entries(summary).map(([key, value]) => [key, safe(value)])];
  const modelRows = [[
    'Provider','Model','Samples','Truth Mode','Drug Samples','Top1 Accuracy','Drug Partial Rate',
    'Imprint Samples','Imprint Accuracy','Imprint Partial Rate','Imprint CER','Evaluated Imprint Sides','Invented Imprints',
    'Dangerous Misidentification','Front CER','Back CER','Brier Loss','Latency ms','Total Cost USD','Cost/Sample USD','Robustness Score',
  ], ...(dataset.models || []).map(m => [
    m.provider,m.model,m.samples,m.truth_mode,m.drug_samples,safe(m.top1_accuracy),safe(m.partial_rate),
    m.imprint_samples,safe(m.imprint_accuracy),safe(m.imprint_partial_rate),safe(m.imprint_CER),m.evaluated_imprint_sides,m.invented_imprints,
    m.high_confidence_misidentification,safe(m.front_imprint_CER),safe(m.back_imprint_CER),safe(m.Brier_loss),safe(m.average_latency_ms),safe(m.total_cost_usd),safe(m.cost_per_sample_usd),safe(m.robustness_score),
  ])];
  const perSampleRows = [[
    'Sample ID','Pill ID','Source Front Image','Source Back Image','Provided Sides','Score Line',
    'Run ID','Provider','Model','Variant','Truth Mode','Classification','Dangerous Misidentification',
    'Truth Drug','Predicted Drug','Truth Front','Pred Front','Truth Back','Pred Back','Drug Similarity','Drug Code Exact',
    'Front Similarity','Back Similarity','Imprint Exact','Imprint Partial','Imprint Similarity','Front CER','Back CER','Imprint CER',
    'Imprint Orientation','Evaluated Imprint Sides','Invented Imprints','Confidence','Brier Loss','Latency ms','Cost USD','Legacy Score',
  ], ...(dataset.samples || []).map(s => [
    s.sample_id,s.pill_id,s.images?.front,s.images?.back,s.provided_sides || s.condition?.provided_sides,s.score_line || s.condition?.score_line,
    s.run_id,s.provider,s.model,s.variant,s.truth_mode || s.metrics?.truth_mode,s.classification,s.high_confidence_misidentification,
    s.answer?.drug_name,s.prediction?.drug_name,s.answer?.front_imprint,s.prediction?.front_imprint,s.answer?.back_imprint,s.prediction?.back_imprint,s.metrics?.drug_name_similarity,s.metrics?.drug_code_exact,
    s.metrics?.front_imprint_similarity,s.metrics?.back_imprint_similarity,s.metrics?.imprint_exact_match,s.metrics?.imprint_partial_match,s.metrics?.imprint_similarity,s.metrics?.front_imprint_CER,s.metrics?.back_imprint_CER,s.metrics?.imprint_CER,
    s.metrics?.imprint_orientation,s.metrics?.evaluated_imprint_sides,s.metrics?.invented_imprints,s.metrics?.confidence,s.metrics?.Brier_loss,s.metrics?.latency,s.usage?.cost_usd,s.legacy_score?.total,
  ])];
  const errorRows = [['Sample ID','Provider','Model','Classification','Dangerous Misidentification','Predicted Drug','Confidence','Error'], ...(dataset.failures || []).map(f => [f.sample_id,f.provider,f.model,f.classification,f.high_confidence_misidentification,f.predicted_drug_name,safe(f.confidence),f.error && (f.error.message || f.error.code || f.error)])];
  const robustnessRows = [['Sample ID','Provider','Model','Variants','Original Accuracy','Variant Accuracy','Accuracy Drop','Consistency','Robustness Score'], ...(dataset.robustness?.per_sample || []).map(r => [r.sample_id,r.provider,r.model,(r.variants || []).join('|'),r.original_accuracy,safe(r.variant_accuracy),safe(r.accuracy_drop),safe(r.consistency),safe(r.robustness_score)])];
  const costRows = [['Provider','Model','Total Cost USD','Cost/Sample USD'], ...(dataset.costs?.by_model || []).map(c => [c.provider,c.model,safe(c.total_cost_usd),safe(c.cost_per_sample_usd)])];
  return [
    ['Summary', summaryRows], ['Model Comparison', modelRows], ['Per Sample', perSampleRows], ['Errors', errorRows], ['Robustness', robustnessRows], ['Cost', costRows],
  ];
}
function buildExcelWorkbook(dataset) {
  const sheets = buildSheets(dataset || {});
  const sheetEntries = sheets.map(([name, rows], index) => ({ name, index: index + 1, xml: sheetXml(rows) }));
  const contentTypes = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?><Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types"><Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/><Default Extension="xml" ContentType="application/xml"/><Override PartName="/xl/workbook.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.sheet.main+xml"/><Override PartName="/xl/styles.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.styles+xml"/>${sheetEntries.map(s => `<Override PartName="/xl/worksheets/sheet${s.index}.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.worksheet+xml"/>`).join('')}</Types>`;
  const rootRels = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?><Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="xl/workbook.xml"/></Relationships>`;
  const workbook = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?><workbook xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main" xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships"><sheets>${sheetEntries.map(s => `<sheet name="${xmlEsc(s.name)}" sheetId="${s.index}" r:id="rId${s.index}"/>`).join('')}</sheets></workbook>`;
  const workbookRels = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?><Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">${sheetEntries.map(s => `<Relationship Id="rId${s.index}" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/worksheet" Target="worksheets/sheet${s.index}.xml"/>`).join('')}<Relationship Id="rId${sheetEntries.length + 1}" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/styles" Target="styles.xml"/></Relationships>`;
  const styles = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?><styleSheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main"><fonts count="1"><font><sz val="11"/><name val="Arial"/></font></fonts><fills count="1"><fill><patternFill patternType="none"/></fill></fills><borders count="1"><border/></borders><cellStyleXfs count="1"><xf numFmtId="0" fontId="0" fillId="0" borderId="0"/></cellStyleXfs><cellXfs count="1"><xf numFmtId="0" fontId="0" fillId="0" borderId="0" xfId="0"/></cellXfs></styleSheet>`;
  const files = [
    { name:'[Content_Types].xml', content:contentTypes }, { name:'_rels/.rels', content:rootRels }, { name:'xl/workbook.xml', content:workbook }, { name:'xl/_rels/workbook.xml.rels', content:workbookRels }, { name:'xl/styles.xml', content:styles },
    ...sheetEntries.map(s => ({ name:`xl/worksheets/sheet${s.index}.xml`, content:s.xml })),
  ];
  return zipStore(files);
}

module.exports = { sheetXml, buildSheets, buildExcelWorkbook, zipStore };
