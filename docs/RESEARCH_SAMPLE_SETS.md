# 고정 샘플 세트와 무작위 출제

`/research`는 두 가지 식약처 공식사진 고정 샘플을 제공한다.

| 세트 | 건수 | 사진 | 파일 | 용도 |
|---|---:|---:|---|---|
| `fixed20` | 20 | 40장 | `samples/KCSI_MED_MFDS_sample_20.zip` | 빠른 기능 확인, 기존 결과와의 연속성 |
| `extended120` | 120 | 240장 | `samples/KCSI_MED_MFDS_sample_120.zip` | 무작위 출제 기반 모델 비교 |

확장 세트의 앞 20건은 기존 세트와 **같은 품목·같은 순서**다. 그래서 기존 20건으로
낸 결과를 버리지 않고 이어서 볼 수 있다.

## 왜 데이터셋은 고정하고 출제만 무작위인가

데이터셋 자체를 매번 무작위로 만들면 모델 A와 B가 서로 다른 문제를 푼 셈이 되어
비교가 성립하지 않는다. 그래서 문제은행(120건)은 고정하고, **그중 어느 5건을
풀지**만 무작위로 정한다. 뽑기에는 다음 성질을 보장한다.

- **같은 바퀴에서 중복 없음** — 120건을 다 돌 때까지 같은 알약이 다시 나오지 않는다(24배치).
- **전량 순회** — 한 바퀴가 끝나면 새로 섞어 다음 바퀴를 시작한다.
- **재현 가능** — 6자리 `seed`가 뽑기 순서를 결정한다. 배치 ID에 `…-RND<seed>-<회차>` 로
  남으므로 나중에 같은 문제를 다시 뽑아 재실험할 수 있다.

seed 문자는 `0/O`, `1/I`처럼 헷갈리는 글자를 뺀 32자에서 고른다. 사람이 받아 적는 값이기 때문이다.

## 품목 선정 기준

`scripts/select-mfds-sample-items.mjs`가 `pill_db.json`에서 결정적으로 고른다.

- 식약처 공식 등록사진 URL이 허용 형식일 것
- 앞면 각인·모양·색상·제품명이 모두 있을 것(정답지로 쓸 수 있어야 한다)
- 앞·뒷면 각인이 모두 있는 품목 우선 — 양면 판독이 연구 관심사다
- 모양(원형 30% · 타원형 24% · 장방형 24% · 그 외 22%), 색상(한 색상 최대 30%),
  약효분류(같은 분류 최대 4건) 상한으로 쏠림을 막는다
- 정렬은 품목 ID 해시 순서다. 등록연도나 가나다순으로 뽑으면 표본이 한쪽으로 기운다

고른 목록은 `scripts/mfds-sample-sets.mjs`에 **고정 목록**으로 박아 둔다.
목표 120건에 후보는 150건이다. 식약처 서버에서 사진 몇 건이 빠져도 빌드가 멈추지 않게
하기 위해서이며, 실제로 어떤 품목이 빠졌는지는 매니페스트의 `skipped_items`에 남는다.

## 샘플 팩 만들기

`nedrug.mfds.go.kr`에 접속할 수 있는 환경에서 실행한다. 저장소를 클론한 폴더 안에서
실행해야 한다.

```bash
npm install --no-save sharp
node scripts/build-mfds-sample-dataset.mjs
node scripts/build-mfds-sample-dataset.mjs --set=extended120
npm run build:samples
```

`sharp`는 사진을 앞·뒤로 자르는 데 쓴다. `--no-save`를 붙이는 이유는 배포 웹앱에는
필요 없는 도구라 `package.json`에 남기지 않기 위해서다. 설치하지 않으면
ImageMagick(`identify`/`convert`)을 찾고, 둘 다 없으면 무엇을 설치해야 하는지 알려준다.

ZIP은 외부 `zip` 명령 없이 Node만으로 만든다. 윈도우 기본 명령 프롬프트에는 `zip`이
없어서, 예전 방식이면 사진 240장을 다 받은 뒤 마지막 단계에서만 실패했다.

### 윈도우 명령 프롬프트에서

`cmd.exe`는 `#` 주석을 이해하지 못한다. 아래 명령을 **주석 없이 한 줄씩** 붙여 넣는다.

```bat
cd %USERPROFILE%\Documents
git clone https://github.com/growdaily860-cell/KCSI-MED-main.git
cd KCSI-MED-main
git checkout claude/arena-auto-scoring-integration-vuu05a
npm install --no-save sharp
node scripts/build-mfds-sample-dataset.mjs --set=extended120
git add samples/KCSI_MED_MFDS_sample_120.zip samples/KCSI_MED_MFDS_sample_120.manifest.json
git commit -m "chore: add extended 120-case MFDS sample pack"
git push origin claude/arena-auto-scoring-integration-vuu05a
```

`npm install`이 `package-lock.json`을 건드릴 수 있다. 위처럼 `samples/` 두 파일만
`git add` 하면 나머지 변경은 커밋되지 않는다.

만들어진 `samples/*.zip`과 `samples/*.manifest.json`을 커밋하면 배포에 실려 화면의
"샘플 120건 자동 불러오기"가 동작한다. ZIP이 아직 없으면 화면이 그 사실과 실행할
명령을 그대로 알려준다.

사진 분할은 sharp가 설치돼 있으면 sharp를, 없으면 ImageMagick(`identify`/`convert`)을
쓴다. 어느 쪽을 썼는지는 매니페스트의 `image_splitter`에 기록된다.

## 화면에서 쓰는 법

1. **샘플 120건 자동 불러오기** — ZIP을 받아 브라우저 메모리에서 풀고 정답지·사진을 대조한다.
2. **🎲 랜덤 5건 뽑기** — 무작위 5건을 비교 화면에 채운다. seed와 회차가 함께 표시된다.
3. 순서대로 돌리고 싶으면 기존 범위 선택(1–5번, 6–10번 …)을 그대로 쓴다.

## 비용과 해석 주의

- 배치 1회 = 모델 4개 호출이다. 120건을 한 바퀴 돌면 24배치 × 4 = **96회 호출**이다.
  일일 기본 한도는 40회이고 충전으로 최대 440회까지 늘어난다. 한 번에 다 돌리지 말고
  나눠서 진행할 것.
- 공식 등록사진은 조명·배경·각도가 고르다. 여기서 나온 정확도는 **기능·기초 성능**이며
  실제 현장에서 찍은 사진의 정확도와 같지 않다.
- 표본 120건도 모델 성능을 확정하기에는 작다. 촬영 조건을 나눠 반복하고 CSV 원자료와
  함께 보고해야 한다.
- 정답지와 사진은 브라우저 메모리에서만 다루며 서버에 저장하지 않는다.
