// 합성 의료문서 표본 생성기.
// SVG로 그려 PNG로 굽고, 촬영 조건별 변형을 입힌 뒤 정답지(항목 종류 + 좌표)를 함께 낸다.
// 좌표를 정확히 아는 것이 핵심이다 — 글자를 우리가 그렸으니 어디에 무엇이 있는지 안다.

import { mkdir, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { PAGE, FORMS, findForm } from './doc-forms.mjs';
import { createZip } from './zip-writer.mjs';

const FONT = 'WenQuanYi Zen Hei, Noto Sans CJK KR, Unifont, sans-serif';
const LAYOUT = { left: 110, labelWidth: 240, top: 300, lineHeight: 84, fontSize: 34, titleSize: 58 };

const escapeXml = value => String(value == null ? '' : value)
  .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');

// 글자 폭을 정확히 재려면 폰트 메트릭이 필요하지만, 정답 상자는 조금 넉넉해도 된다.
// 가려야 할 영역을 좁게 잡으면 실제로는 안 가려졌는데 가렸다고 채점될 수 있어 위험하다.
function textWidth(text, fontSize) {
  let units = 0;
  for (const char of String(text)) units += /[가-힣ㄱ-ㅎ]/.test(char) ? 1 : (/[0-9A-Za-z]/.test(char) ? 0.56 : 0.4);
  return Math.ceil(units * fontSize);
}

export function layoutDocument(form, seed) {
  const content = form.build(seed);
  const items = [];
  const lines = [];
  content.rows.forEach((row, index) => {
    const y = LAYOUT.top + index * LAYOUT.lineHeight;
    const valueX = LAYOUT.left + LAYOUT.labelWidth;
    lines.push({ label: row.label, value: row.value, x: LAYOUT.left, valueX, y });
    if (!row.pii) return;
    const width = textWidth(row.value, LAYOUT.fontSize);
    items.push({
      type: row.pii,
      // baseline 기준 y이므로 위로 올려 상자를 만든다.
      box: { x: valueX - 6, y: y - LAYOUT.fontSize, w: width + 12, h: LAYOUT.fontSize + 16 },
    });
  });
  return { content, lines, items };
}

function renderSvg(form, seed) {
  const { content, lines, items } = layoutDocument(form, seed);
  const body = lines.map(line => `
    <text x="${line.x}" y="${line.y}" font-family="${FONT}" font-size="${LAYOUT.fontSize}" fill="#333">${escapeXml(line.label)}</text>
    <text x="${line.valueX}" y="${line.y}" font-family="${FONT}" font-size="${LAYOUT.fontSize}" fill="#111">${escapeXml(line.value)}</text>`).join('');
  const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="${PAGE.width}" height="${PAGE.height}" viewBox="0 0 ${PAGE.width} ${PAGE.height}">
    <rect width="100%" height="100%" fill="#ffffff"/>
    <text x="${PAGE.width / 2}" y="150" text-anchor="middle" font-family="${FONT}" font-size="${LAYOUT.titleSize}" font-weight="bold" fill="#111">${escapeXml(content.title)}</text>
    <text x="${PAGE.width / 2}" y="215" text-anchor="middle" font-family="${FONT}" font-size="34" fill="#444">${escapeXml(content.subtitle)}</text>
    <line x1="${LAYOUT.left}" y1="245" x2="${PAGE.width - LAYOUT.left}" y2="245" stroke="#888" stroke-width="2"/>
    ${body}
    <line x1="${LAYOUT.left}" y1="${PAGE.height - 190}" x2="${PAGE.width - LAYOUT.left}" y2="${PAGE.height - 190}" stroke="#888" stroke-width="2"/>
    <text x="${LAYOUT.left}" y="${PAGE.height - 130}" font-family="${FONT}" font-size="26" fill="#666">${escapeXml(content.note)}</text>
  </svg>`;
  return { svg, items };
}

// 촬영 조건. 좌표를 정확히 옮길 수 있는 변형만 쓴다 —
// 접힘·구김은 기하 왜곡 대신 음영으로 흉내 낸다. 좌표를 못 옮기면 정답지가 틀려지고,
// 틀린 정답지로 낸 수치는 없느니만 못하다.
export const CONDITIONS = [
  { id: 'original', label: '정상 스캔', logged: 'original' },
  { id: 'fold', label: '접힘(가로 음영)', logged: 'fold' },
  { id: 'crumple', label: '구겨짐(얼룩 음영)', logged: 'crumple' },
  { id: 'skew5', label: '기울어짐 5°', logged: 'skew', angle: 5 },
  { id: 'skew15', label: '기울어짐 15°', logged: 'skew', angle: 15 },
  { id: 'lowlight', label: '저조도', logged: 'lowlight' },
  { id: 'noise', label: '스캔 노이즈', logged: 'noise' },
  { id: 'lowres', label: '저해상도', logged: 'lowres', scale: 0.5 },
];

function rotatePoint(x, y, angleDeg, width, height, outWidth, outHeight) {
  const angle = (angleDeg * Math.PI) / 180;
  const cos = Math.cos(angle);
  const sin = Math.sin(angle);
  const cx = width / 2;
  const cy = height / 2;
  return {
    x: (x - cx) * cos - (y - cy) * sin + outWidth / 2,
    y: (x - cx) * sin + (y - cy) * cos + outHeight / 2,
  };
}

function rotatedSize(width, height, angleDeg) {
  const angle = (angleDeg * Math.PI) / 180;
  const cos = Math.abs(Math.cos(angle));
  const sin = Math.abs(Math.sin(angle));
  return {
    width: Math.round(width * cos + height * sin),
    height: Math.round(width * sin + height * cos),
  };
}

// 회전한 글자 상자는 축에 나란하지 않다. 가림 상자도 축에 나란하므로
// 네 꼭짓점을 감싸는 축정렬 사각형이 정확한 목표가 된다.
function transformItems(items, condition, size) {
  if (condition.angle) {
    const out = rotatedSize(size.width, size.height, condition.angle);
    return {
      size: out,
      items: items.map(item => {
        const corners = [
          [item.box.x, item.box.y], [item.box.x + item.box.w, item.box.y],
          [item.box.x, item.box.y + item.box.h], [item.box.x + item.box.w, item.box.y + item.box.h],
        ].map(([x, y]) => rotatePoint(x, y, condition.angle, size.width, size.height, out.width, out.height));
        const xs = corners.map(point => point.x);
        const ys = corners.map(point => point.y);
        return {
          type: item.type,
          box: {
            x: Math.round(Math.min(...xs)), y: Math.round(Math.min(...ys)),
            w: Math.round(Math.max(...xs) - Math.min(...xs)), h: Math.round(Math.max(...ys) - Math.min(...ys)),
          },
        };
      }),
    };
  }
  if (condition.scale) {
    const factor = condition.scale;
    return {
      size: { width: Math.round(size.width * factor), height: Math.round(size.height * factor) },
      items: items.map(item => ({
        type: item.type,
        box: {
          x: Math.round(item.box.x * factor), y: Math.round(item.box.y * factor),
          w: Math.round(item.box.w * factor), h: Math.round(item.box.h * factor),
        },
      })),
    };
  }
  return { size, items };
}

async function applyCondition(sharp, base, condition, size) {
  let image = sharp(base);
  if (condition.angle) image = image.rotate(condition.angle, { background: '#d8d8d8' });
  if (condition.scale) image = image.resize(Math.round(size.width * condition.scale));
  if (condition.id === 'lowlight') image = image.modulate({ brightness: 0.55 }).linear(0.9, 8);
  if (condition.id === 'fold') {
    // 가로로 접힌 자국 — 종이가 접히면 그 줄만 그늘이 진다.
    const band = Buffer.from(`<svg width="${size.width}" height="${size.height}">
      <rect x="0" y="${Math.round(size.height * 0.47)}" width="${size.width}" height="26" fill="#000" opacity="0.28"/>
      <rect x="0" y="${Math.round(size.height * 0.47) + 26}" width="${size.width}" height="10" fill="#fff" opacity="0.35"/>
    </svg>`);
    image = image.composite([{ input: band, blend: 'over' }]);
  }
  if (condition.id === 'crumple') {
    const blobs = Array.from({ length: 14 }, (_, index) => {
      const x = (index * 977) % size.width;
      const y = (index * 1613) % size.height;
      return `<ellipse cx="${x}" cy="${y}" rx="${140 + (index % 5) * 40}" ry="${60 + (index % 4) * 30}" fill="#000" opacity="0.13"/>`;
    }).join('');
    image = image.composite([{ input: Buffer.from(`<svg width="${size.width}" height="${size.height}">${blobs}</svg>`), blend: 'over' }]);
  }
  if (condition.id === 'noise') {
    const dots = Array.from({ length: 2600 }, (_, index) => {
      const x = (index * 7919) % size.width;
      const y = (index * 6271) % size.height;
      return `<rect x="${x}" y="${y}" width="2" height="2" fill="${index % 3 ? '#000' : '#999'}" opacity="0.5"/>`;
    }).join('');
    image = image.composite([{ input: Buffer.from(`<svg width="${size.width}" height="${size.height}">${dots}</svg>`), blend: 'over' }]);
  }
  return image.jpeg({ quality: 88 }).toBuffer();
}

export async function buildDocumentSamples(options = {}) {
  const sharpModule = await import('sharp').catch(() => null);
  if (!sharpModule) throw new Error('문서 표본을 만들려면 sharp가 필요합니다. `npm install --no-save sharp` 후 다시 실행하세요.');
  const sharp = sharpModule.default || sharpModule;
  const perCondition = Math.max(1, Number(options.perCondition) || 5);
  const outputDirectory = options.outputDirectory || 'samples';
  const forms = options.formIds ? options.formIds.map(findForm) : FORMS;
  const log = options.log || (() => {});

  const entries = [];
  const answers = [];
  let index = 0;

  for (const form of forms) {
    for (const condition of CONDITIONS) {
      for (let repeat = 0; repeat < perCondition; repeat += 1) {
        index += 1;
        const seed = index * 13 + repeat;
        const docId = `DOC-${String(index).padStart(4, '0')}`;
        const { svg, items } = renderSvg(form, seed);
        const base = await sharp(Buffer.from(svg)).png().toBuffer();
        const bytes = await applyCondition(sharp, base, condition, PAGE);
        const mapped = transformItems(items, condition, PAGE);
        const fileName = `${docId}_${form.id}_${condition.id}.jpg`;
        entries.push({ name: `images/${fileName}`, data: bytes });
        answers.push({
          doc_id: docId,
          form: form.id,
          form_label: form.label,
          condition: condition.id,
          condition_label: condition.label,
          logged_condition: condition.logged,
          image: fileName,
          width: mapped.size.width,
          height: mapped.size.height,
          items: mapped.items,
        });
        log(`[${index}] ${docId} · ${form.label} · ${condition.label} · 항목 ${mapped.items.length}개`);
      }
    }
  }

  const manifest = {
    version: 1,
    set: 'synthetic-medical-docs',
    generated_at: options.generatedAt || new Date().toISOString(),
    page: PAGE,
    forms: forms.map(form => ({ id: form.id, label: form.label })),
    conditions: CONDITIONS.map(item => ({ id: item.id, label: item.label, logged: item.logged })),
    per_condition: perCondition,
    document_count: answers.length,
    item_count: answers.reduce((sum, row) => sum + row.items.length, 0),
    notice: '합성 문서입니다. 이름·주민등록번호·전화번호는 모두 지어낸 값이며 실제 인물과 무관합니다.',
    documents: answers,
  };

  entries.unshift({ name: 'answer_sheet.json', data: Buffer.from(`${JSON.stringify(manifest, null, 2)}\n`, 'utf8') });
  entries.unshift({ name: 'README.txt', data: Buffer.from([
    'KCSI MED · 비식별화 성능 측정용 합성 의료문서',
    '',
    `- 문서 ${manifest.document_count}건 · 개인정보 항목 ${manifest.item_count}개`,
    `- 서식 ${forms.length}종 × 조건 ${CONDITIONS.length}종 × ${perCondition}건`,
    '- answer_sheet.json에 문서별 개인정보 항목 종류와 좌표가 들어 있습니다.',
    '- 모든 값은 지어낸 것입니다. 주민등록번호는 실제로 발급될 수 없는 조합입니다.',
    '- 접힘·구김은 음영으로 흉내 낸 것이며 기하 왜곡은 기울어짐 조건에만 있습니다.',
    '- 이 표본으로 낸 수치는 합성 문서 기준이며 실제 스캔 문서 성능과 다를 수 있습니다.',
    '',
  ].join('\n'), 'utf8') });

  await mkdir(outputDirectory, { recursive: true });
  const archivePath = path.join(outputDirectory, 'KCSI_MED_synthetic_docs.zip');
  const manifestPath = path.join(outputDirectory, 'KCSI_MED_synthetic_docs.manifest.json');
  const zipBytes = await createZip(entries);
  await writeFile(archivePath, zipBytes);
  await writeFile(manifestPath, `${JSON.stringify(manifest, null, 2)}\n`);
  return { archivePath, manifestPath, bytes: zipBytes.length, manifest };
}
