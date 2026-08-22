// 합성 의료문서 서식 정의.
//
// 실제 의료기록은 개인정보라 저장소에 넣을 수 없다. 그래서 가짜 값으로 채운 서식을
// 만들어 쓴다. 값이 가짜이므로 정답지(어디에 어떤 개인정보가 있는지)를 정확히 알 수 있고,
// 촬영 조건도 마음대로 만들 수 있다 — 실제 문서로는 불가능한 실험이다.
//
// 이름·번호는 모두 지어낸 것이다. 주민등록번호는 실제로 발급될 수 없는 조합을 쓴다
// (생년월일 자리에 존재하지 않는 월/일, 검증번호 불일치).

export const PAGE = { width: 1240, height: 1754 };   // A4 150dpi

const NAMES = ['김하늘', '박서준', '이수민', '최윤호', '정다인', '장민석', '오세라', '한지우'];
const DOCTORS = ['조은결', '남기훈', '문가온', '백서린'];
const HOSPITALS = ['한빛종합병원', '새길의료원', '푸른내과의원', '이레정형외과'];
const ADDRESSES = ['서울특별시 가온구 한빛로 123', '부산광역시 새길구 푸른대로 45', '대전광역시 이레구 미르길 7'];
const DRUGS = ['자이로릭정 100mg', '타이레놀정 500mg', '노바스크정 5mg', '리피토정 10mg'];
const TESTS = ['혈액검사', '흉부 X선', '심전도', '요검사'];

// 존재할 수 없는 주민등록번호를 만든다(13월·32일 등). 실수로도 실제 번호가 되지 않게.
function fakeRrn(seed) {
  const yy = String(70 + (seed % 30)).padStart(2, '0');
  const mm = '13';
  const dd = String(32 + (seed % 8)).padStart(2, '0');
  return `${yy}${mm}${dd}-${(seed % 4) + 1}${String(seed * 7919 % 1000000).padStart(6, '0')}`;
}
const fakePhone = seed => `010-${String(1000 + (seed * 37) % 9000)}-${String(1000 + (seed * 91) % 9000)}`;
const fakeChart = seed => `P-${String(100000 + (seed * 613) % 900000)}`;
const fakeBirth = seed => `19${70 + (seed % 30)}-${String(1 + (seed % 12)).padStart(2, '0')}-${String(1 + (seed % 28)).padStart(2, '0')}`;
const pick = (list, seed) => list[seed % list.length];

// 각 서식은 라벨(가릴 필요 없음)과 값(가려야 함)을 좌표와 함께 돌려준다.
// PII 항목만 정답지에 들어간다.
export const FORMS = [
  {
    id: 'diagnosis',
    label: '진단서',
    build(seed) {
      const name = pick(NAMES, seed);
      return {
        title: `진 단 서`,
        subtitle: pick(HOSPITALS, seed),
        rows: [
          { label: '환자 성명', value: name, pii: '성명' },
          { label: '주민등록번호', value: fakeRrn(seed), pii: '주민등록번호' },
          { label: '생년월일', value: fakeBirth(seed), pii: '생년월일' },
          { label: '연락처', value: fakePhone(seed), pii: '전화번호' },
          { label: '주소', value: pick(ADDRESSES, seed), pii: '주소' },
          { label: '환자번호', value: fakeChart(seed), pii: '개인식별번호' },
          { label: '병명', value: '상세불명의 고혈압' },
          { label: '진단일', value: '2026-08-14' },
          { label: '담당의사', value: pick(DOCTORS, seed), pii: '성명' },
        ],
        note: '본 문서는 성능 측정을 위한 합성 문서이며 실제 환자 정보가 아닙니다.',
      };
    },
  },
  {
    id: 'prescription',
    label: '처방전',
    build(seed) {
      return {
        title: `처 방 전`,
        subtitle: pick(HOSPITALS, seed + 1),
        rows: [
          { label: '성명', value: pick(NAMES, seed + 3), pii: '성명' },
          { label: '주민등록번호', value: fakeRrn(seed + 5), pii: '주민등록번호' },
          { label: '전화번호', value: fakePhone(seed + 2), pii: '전화번호' },
          { label: '환자번호', value: fakeChart(seed + 4), pii: '개인식별번호' },
          { label: '처방의약품', value: pick(DRUGS, seed) },
          { label: '용법', value: '1일 1회 1정 아침 식후' },
          { label: '투약일수', value: '30일' },
          { label: '처방의사', value: pick(DOCTORS, seed + 2), pii: '성명' },
        ],
        note: '본 문서는 성능 측정을 위한 합성 문서이며 실제 환자 정보가 아닙니다.',
      };
    },
  },
  {
    id: 'lab',
    label: '검사결과지',
    build(seed) {
      return {
        title: `검사 결과 통보서`,
        subtitle: pick(HOSPITALS, seed + 2),
        rows: [
          { label: '수검자 성명', value: pick(NAMES, seed + 6), pii: '성명' },
          { label: '생년월일', value: fakeBirth(seed + 3), pii: '생년월일' },
          { label: '주민등록번호', value: fakeRrn(seed + 9), pii: '주민등록번호' },
          { label: '검사번호', value: fakeChart(seed + 7), pii: '개인식별번호' },
          { label: '연락처', value: fakePhone(seed + 5), pii: '전화번호' },
          { label: '검사항목', value: pick(TESTS, seed) },
          { label: '결과', value: '참고치 이내' },
          { label: '판독일', value: '2026-08-18' },
        ],
        note: '본 문서는 성능 측정을 위한 합성 문서이며 실제 환자 정보가 아닙니다.',
      };
    },
  },
];

export function findForm(id) {
  const form = FORMS.find(item => item.id === id);
  if (!form) throw new Error(`알 수 없는 서식: ${id} (사용 가능: ${FORMS.map(f => f.id).join(', ')})`);
  return form;
}
