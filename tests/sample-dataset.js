const assert = require('assert');
const crypto = require('crypto');
const fs = require('fs');
const { execFileSync } = require('child_process');
const arena = require('../arena.js');

const archivePath = 'samples/KCSI_MED_MFDS_sample_20.zip';
const manifestPath = 'samples/KCSI_MED_MFDS_sample_20.manifest.json';
assert(fs.existsSync(archivePath), 'fixed MFDS sample archive must exist');
assert(fs.existsSync(manifestPath), 'fixed MFDS sample manifest must exist');

const archive = fs.readFileSync(archivePath);
const manifest = JSON.parse(fs.readFileSync(manifestPath, 'utf8'));
assert.equal(manifest.sample_count, 20);
assert.equal(manifest.image_count, 40);
assert.equal(manifest.items.length, 20);
assert.equal(crypto.createHash('sha256').update(archive).digest('hex'), manifest.archive_sha256);
assert.equal(new Set(manifest.items.map(item => item.case_id)).size, 20, 'sample case ids must be unique');
assert(manifest.items.every(item => /^https:\/\/nedrug\.mfds\.go\.kr\/pbp\/cmn\/itemImageDownload\//.test(item.original_image_url)));

const entries = execFileSync('unzip', ['-Z1', archivePath], { encoding: 'utf8' }).trim().split(/\r?\n/);
const imageEntries = entries.filter(name => /^images\/.+_(?:front|back)\.jpg$/.test(name));
assert.equal(imageEntries.length, 40);
assert(entries.includes('answer_sheet.csv'));
assert(entries.includes('source_manifest.csv'));
assert(entries.includes('README.txt'));

const answerCsv = execFileSync('unzip', ['-p', archivePath, 'answer_sheet.csv'], { encoding: 'utf8' });
const parsed = arena.normalizeDatasetTable(arena.parseDelimitedRows(answerCsv));
const validation = arena.validateDatasetRows(parsed.rows, imageEntries);
assert.equal(parsed.rows.length, 20);
assert.equal(validation.summary.validRows, 20);
assert.equal(validation.summary.invalidRows, 0);
assert.equal(validation.summary.matchedImages, 40);

console.log('[sample-dataset] PASS — fixed 20 cases · 40 split images · CSV/image matching');
