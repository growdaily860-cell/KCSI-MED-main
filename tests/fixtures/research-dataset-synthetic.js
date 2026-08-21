/**
 * 합성 정답지 fixture · Task A 전용
 *
 * 실제 사건·환자 자료를 쓰지 않기 위해 만든 가짜 정답지입니다.
 * `cells`는 데모에서 합성 스캔 PDF를 그릴 때, `makeWords()`가 만든 좌표는
 * Node 테스트에서 OCR word 좌표를 표로 재구성할 때 사용합니다.
 */
(function initResearchDatasetFixture(root, factory) {
  const api = factory();
  root.KCSIResearchDatasetFixture = api;
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
})(typeof window !== 'undefined' ? window : globalThis, function factory() {
  'use strict';

  const COLUMN_X = [40, 300, 560, 860, 1160, 1440];
  const CHAR_WIDTH = 13;
  const ROW_HEIGHT = 22;
  const ROW_GAP = 46;
  const START_Y = 60;

  function makeWords(rows, options) {
    const settings = options || {};
    const columnX = settings.columnX || COLUMN_X;
    const charWidth = settings.charWidth || CHAR_WIDTH;
    const rowHeight = settings.rowHeight || ROW_HEIGHT;
    const rowGap = settings.rowGap || ROW_GAP;
    const startY = settings.startY || START_Y;
    const words = [];
    rows.forEach((cells, rowIndex) => {
      const y0 = startY + rowIndex * rowGap;
      cells.forEach((cell, columnIndex) => {
        if (cell == null) return;
        const value = typeof cell === 'string' ? { text: cell } : cell;
        if (!value.text) return;
        let x = columnX[columnIndex];
        String(value.text).split(' ').forEach(token => {
          const width = Math.max(charWidth, token.length * charWidth);
          words.push({
            text: token,
            bbox: { x0: x, y0, x1: x + width, y1: y0 + rowHeight },
            confidence: value.confidence == null ? 94 : value.confidence,
          });
          x += width + 7;
        });
      });
    });
    return words;
  }

  const cellText = cell => (cell == null ? '' : (typeof cell === 'string' ? cell : cell.text));

  // 표 위에 제목 줄이 있고 한글·영문 머리글이 섞인 스캔본
  const titledCells = [
    ['정답지 스캔본', null, null, null, null, null],
    ['시험번호', 'front image', '뒷면사진', '제품명', '앞면각인', '뒷면각인'],
    ['CASE-001', 'CASE-001_front.jpg', 'CASE-001_back.jpg', '테스트정', 'AB 10', 'K1'],
    ['CASE-002', 'CASE-002_front.jpg', 'CASE-002_back.jpg', '가나다정', 'CD', { text: '20', confidence: 41 }],
  ];

  // 1페이지에만 머리글이 있고 2페이지는 이어지는 표
  const pageCells = [
    [
      ['시험번호', '앞면사진', '뒷면사진', '의약품명', '앞면각인', '뒷면각인'],
      ['CASE-001', 'CASE-001_front.jpg', 'CASE-001_back.jpg', '테스트정', 'AB 10', 'K1'],
      ['CASE-002', 'CASE-002_front.jpg', 'CASE-002_back.jpg', '가나다정', 'CD', { text: '20', confidence: 38 }],
    ],
    [
      ['CASE-003', 'CASE-003_front.jpg', 'CASE-003_back.jpg', '라마바정', 'EF', '30'],
      ['CASE-004', 'CASE-004_front.jpg', 'CASE-004_back.jpg', '', 'GH', '40'],
    ],
  ];

  // 정답지 열이 2개만 맞는 표 (머리글로 인정하면 안 됨)
  const weakHeaderCells = [
    ['비고', '색상', '합계'],
    ['메모', '흰색', '3'],
  ];

  // 정답지와 무관한 문서
  const unrelatedCells = [
    ['영수증', '금액', '합계'],
  ];

  return {
    columnX: COLUMN_X,
    charWidth: CHAR_WIDTH,
    rowHeight: ROW_HEIGHT,
    rowGap: ROW_GAP,
    startY: START_Y,
    makeWords,
    cellText,
    titledCells,
    pageCells,
    weakHeaderCells,
    unrelatedCells,
  };
});
