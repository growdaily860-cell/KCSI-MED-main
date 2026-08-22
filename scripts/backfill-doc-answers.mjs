// 이미 커밋된 합성 문서 팩의 정답지에 항목별 라벨·값을 채워 넣는다.
//
// 좌표만 있는 정답지로는 누락 항목이 "규칙이 못 잡은 것"인지 "OCR이 못 읽은 것"인지
// 구분할 수 없다. 라벨·값이 있으면 브라우저에서 현재 규칙만으로 상한선을 계산해
// 둘을 갈라낼 수 있다. 값은 전부 합성이라 저장해도 개인정보가 아니다.
//
// 이미지는 그대로 두고 answer_sheet.json과 매니페스트만 다시 쓴다. 문서 배치 순서와
// 시드 계산은 빌더와 같으므로, 새로 계산한 상자가 기존 상자와 한 픽셀도 다르지 않은지
// 먼저 확인하고, 다르면 아무것도 쓰지 않고 멈춘다 — 정답지가 이미지와 어긋나면
// 이후 모든 측정이 조용히 틀리기 때문이다.

import fs from 'node:fs/promises';
import path from 'node:path';
import { inflateRaw } from 'node:zlib';
import { promisify } from 'node:util';
import { createZip } from './lib/zip-writer.mjs';
import { FORMS, findForm, PAGE } from './lib/doc-forms.mjs';
import { CONDITIONS, layoutDocument, transformItems } from './lib/build-doc-samples.mjs';

const inflateRawAsync = promisify(inflateRaw);

// 이 빌더가 만드는 ZIP은 압축 방식이 0(무압축) 또는 8(deflate)뿐이다.
async function readZip(buffer) {
  const files = new Map();
  const order = [];
  const endIndex = buffer.lastIndexOf(Buffer.from([0x50, 0x4b, 0x05, 0x06]));
  if (endIndex < 0) throw new Error('ZIP 끝 레코드를 찾지 못했습니다.');
  const entryCount = buffer.readUInt16LE(endIndex + 10);
  let offset = buffer.readUInt32LE(endIndex + 16);
  for (let index = 0; index < entryCount; index += 1) {
    if (buffer.readUInt32LE(offset) !== 0x02014b50) throw new Error('중앙 디렉터리 서명 불일치');
    const method = buffer.readUInt16LE(offset + 10);
    const compressedSize = buffer.readUInt32LE(offset + 20);
    const nameLength = buffer.readUInt16LE(offset + 28);
    const extraLength = buffer.readUInt16LE(offset + 30);
    const commentLength = buffer.readUInt16LE(offset + 32);
    const localOffset = buffer.readUInt32LE(offset + 42);
    const name = buffer.toString('utf8', offset + 46, offset + 46 + nameLength);
    const localNameLength = buffer.readUInt16LE(localOffset + 26);
    const localExtraLength = buffer.readUInt16LE(localOffset + 28);
    const dataStart = localOffset + 30 + localNameLength + localExtraLength;
    const raw = buffer.subarray(dataStart, dataStart + compressedSize);
    files.set(name, method === 0 ? Buffer.from(raw) : await inflateRawAsync(raw));
    order.push(name);
    offset += 46 + nameLength + extraLength + commentLength;
  }
  return { files, order };
}

function sameBox(a, b) {
  return a.x === b.x && a.y === b.y && a.w === b.w && a.h === b.h;
}

// 빌더와 같은 순서로 돌면서 문서별 항목(라벨·값·상자)을 다시 만든다.
function rebuildItems(formIds, perCondition) {
  const forms = formIds ? formIds.map(findForm) : FORMS;
  const out = new Map();
  let index = 0;
  for (const form of forms) {
    for (const condition of CONDITIONS) {
      for (let repeat = 0; repeat < perCondition; repeat += 1) {
        index += 1;
        const seed = index * 13 + repeat;
        const docId = `DOC-${String(index).padStart(4, '0')}`;
        const { items } = layoutDocument(form, seed);
        out.set(docId, transformItems(items, condition, PAGE).items);
      }
    }
  }
  return out;
}

export async function backfillDocAnswers(options = {}) {
  const directory = options.outputDirectory || 'samples';
  const zipPath = path.join(directory, 'KCSI_MED_synthetic_docs.zip');
  const manifestPath = path.join(directory, 'KCSI_MED_synthetic_docs.manifest.json');
  const log = options.log || (() => {});

  const zipBuffer = await fs.readFile(zipPath);
  const { files, order } = await readZip(zipBuffer);
  const answerRaw = files.get('answer_sheet.json');
  if (!answerRaw) throw new Error('ZIP 안에 answer_sheet.json이 없습니다.');
  const manifest = JSON.parse(answerRaw.toString('utf8'));

  const rebuilt = rebuildItems(manifest.forms ? manifest.forms.map(form => form.id) : null, manifest.per_condition);
  let filled = 0;
  manifest.documents.forEach(document => {
    const items = rebuilt.get(document.doc_id);
    if (!items) throw new Error(`${document.doc_id}: 다시 만든 문서 목록에 없습니다.`);
    if (items.length !== document.items.length) {
      throw new Error(`${document.doc_id}: 항목 수가 다릅니다(${document.items.length} → ${items.length}).`);
    }
    document.items.forEach((item, index) => {
      const rebuiltItem = items[index];
      if (item.type !== rebuiltItem.type || !sameBox(item.box, rebuiltItem.box)) {
        throw new Error(`${document.doc_id} #${index}: 좌표·종류가 기존 정답지와 다릅니다. 이미지를 다시 만들어야 합니다.`);
      }
      item.label = rebuiltItem.label;
      item.value = rebuiltItem.value;
      filled += 1;
    });
  });

  manifest.version = 2;
  manifest.answer_fields = ['type', 'label', 'value', 'box'];

  const answerBuffer = Buffer.from(`${JSON.stringify(manifest, null, 2)}\n`, 'utf8');
  const entries = order.map(name => ({
    name,
    data: name === 'answer_sheet.json' ? answerBuffer : files.get(name),
  }));
  await fs.writeFile(zipPath, await createZip(entries));
  await fs.writeFile(manifestPath, answerBuffer);
  log(`정답지 항목 ${filled}개에 라벨·값을 채웠습니다 (문서 ${manifest.documents.length}건).`);
  return { documents: manifest.documents.length, items: filled };
}

if (process.argv[1] && process.argv[1].endsWith('backfill-doc-answers.mjs')) {
  backfillDocAnswers({ log: message => console.log(message) }).catch(error => {
    console.error(error.message);
    process.exit(1);
  });
}
