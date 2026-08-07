// 실제 실패 사례로 수정 효과를 검증한다
const fs=require('fs'), vm=require('vm');
const html=fs.readFileSync('index.html','utf8');
const src=html.match(/<script>([\s\S]*)<\/script>/)[1];
const realIds=new Set([...html.matchAll(/\sid="([^"]+)"/g)].map(m=>m[1]));
const el=()=>({classList:{add(){},remove(){},toggle(){},contains(){return false}},style:{},addEventListener(){},value:'',textContent:'',innerHTML:'',children:[],childElementCount:0,appendChild(){},querySelectorAll:()=>[],getContext:()=>({drawImage(){},getImageData:(x,y,w,h)=>({data:new Uint8ClampedArray(4)})})});
const win={document:{getElementById:id=>realIds.has(id)?el():null,querySelectorAll:()=>[],createElement:el,addEventListener(){},body:el(),head:el()},
 localStorage:{getItem:()=>null,setItem(){}},sessionStorage:{getItem:()=>null,setItem(){}},
 navigator:{onLine:false},location:{href:'',reload(){}},fetch:()=>new Promise(()=>{}),
 console,setTimeout,clearTimeout,alert(){},addEventListener(){},history:{pushState(){},back(){}},
 Math,JSON,Date,Promise,Uint8Array,Uint8ClampedArray,Map,Set,RegExp,Error,parseInt,parseFloat,isNaN,String,Number,Object,Array,Boolean,btoa,atob};
win.window=win;
vm.createContext(win);
vm.runInContext(src+'\n;globalThis.__p={markSubsetMatch,colorMatch,colorNear,fuzzyMark,canonMark};',win);
const {markSubsetMatch,colorMatch,colorNear,fuzzyMark,canonMark}=win.__p;

let fail=0;
const t=(name,got,want)=>{const ok=got===want;if(!ok)fail++;console.log(`  ${ok?'PASS':'FAIL'}  ${name}  →  ${got} (기대 ${want})`);};

console.log('■ 에페릭손 사례 — 다줄 각인 "IH"/"AC50" → Vision "IHAC50"');
t('DB "IH"  ↔ Vision "IHAC50"  (접두)', markSubsetMatch('IH','IHAC50'), true);
t('DB "AC50"↔ Vision "IHAC50"  (접미)', markSubsetMatch('AC50','IHAC50'), true);
t('오매칭 방지: "IH" ↔ "XIHYZ" (중간)', markSubsetMatch('IH','XIHYZ'), false);
t('오매칭 방지: 1글자 "I" ↔ "IHAC50"', markSubsetMatch('I','IHAC50'), false);
t('종전 동작 유지: "HAC" ↔ "IHAC50" (3글자 중간)', markSubsetMatch('HAC','IHAC50'), true);

console.log('\n■ 펙소나딘 사례 — 살구색이 주황/연분홍으로 갈림');
t('엄격 판정은 그대로 (colorMatch 분홍↔주황)', colorMatch('분홍','주황'), false);
t('후보 선별은 통과 (colorNear 분홍↔주황)', colorNear('분홍','주황'), true);
t('DB "연분홍" 표기도 통과', colorNear('분홍','연한 주황색'), true);
t('먼 색은 여전히 배제 (분홍↔초록)', colorNear('분홍','초록'), false);
t('하양↔회색 허용', colorNear('하양','회색'), true);
t('복합 k1 "노랑|투명" ↔ 주황', colorNear('노랑|투명','주황'), true);

console.log('\n■ 로고면 처리(회귀)');
t('DB "마크" → 빈 문자열', canonMark('마크'), '');
t('Vision "없음" → 빈 문자열', canonMark('없음'), '');

console.log('\n■ 분홍 DT20 사례 — 그룹 D120 / 개별 DT20 혼동');
t('T↔1 혼동문자 후보 유지', fuzzyMark('DT20'), fuzzyMark('D120'));

console.log(fail? `\n✗ ${fail}건 실패` : '\n✓ 전부 통과');
process.exit(fail?1:0);
