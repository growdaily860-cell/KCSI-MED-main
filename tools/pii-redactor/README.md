# 오프라인 PNG 개인정보 비식별화

사용자가 제공한 `redact_pii_image.py`의 EasyOCR·Presidio 방식을 저장소 안에서 다시 실행할 수 있게 정리한 로컬 전용 도구입니다. 웹 앱의 의료기록 첨부 흐름은 브라우저용 `deidentify.js`를 사용하며 이 Python 도구를 서버에서 실행하지 않습니다.

## 준비

Python 3.10~3.13 환경을 권장합니다. EasyOCR와 PyTorch 설치 용량이 크고, 최초 실행 시 한글·영문 OCR 모델을 내려받습니다.

```powershell
cd tools\pii-redactor
.\setup.ps1
```

`setup.ps1`은 일반 Windows의 `py`·`python`을 먼저 찾고, Codex 데스크톱의 번들 Python이 있으면 그 경로도 자동으로 사용합니다.

## 실행

실제 문서는 Git에 들어가지 않도록 `private/`에, 결과는 `output/`에 둡니다. 두 폴더는 저장소의 `.gitignore`에 포함되어 있습니다.

```powershell
New-Item -ItemType Directory -Force private, output
Copy-Item -LiteralPath 'C:\승인된로컬경로\진단서.png' -Destination private\진단서.png
.\run.ps1 -InputPath private\진단서.png -OutputPath output\진단서_redacted.png
git status --short
```

가림 색상과 탐지 항목을 제한할 수 있습니다.

```powershell
.\run.ps1 -InputPath private\input.png -OutputPath output\redacted.png -Fill '64,64,64'
.\run.ps1 -InputPath private\input.png -OutputPath output\redacted.png -Entities KR_RRN,KR_PHONE_NUMBER,EMAIL_ADDRESS,PERSON
```

## 동작 방식

1. EasyOCR가 이미지의 텍스트와 좌표를 추출합니다.
2. Presidio와 한국어 spaCy 모델이 주민등록번호·전화번호·이메일·이름을 탐지합니다.
3. OCR 오차에 대비해 `@` 포함 문자열과 `성명`·`이름` 라벨 오른쪽 값을 추가 탐지합니다.
4. 탐지 좌표를 색상 상자로 덮은 새 PNG를 만듭니다.

자동 탐지는 누락·오탐이 있을 수 있습니다. 출력 이미지는 반드시 사람이 확대해 확인한 뒤 사용하세요.

저장소 반영 시 첨부 ZIP의 `gpt_example.png`를 실행 검증했으며, 가림 영역 9개와 함께 첨부된 `gpt_example_redacted.png`와 동일한 SHA-256 결과가 생성되는 것을 확인했습니다. 예시 이미지 자체는 개인정보 파일의 Git 커밋을 막기 위해 저장소에 포함하지 않습니다.

## 원본과 복구

- 입력 파일은 수정하지 않고 출력 파일을 별도로 만듭니다.
- 덮어쓴 픽셀은 출력 PNG에서 복원할 수 없습니다. 다시 필요하면 승인된 원본을 사용합니다.
- 실제 문서, 출력 사본, OCR 캐시를 GitHub에 올리지 마세요.
- 운영 웹 흐름과 코드 복구 방법은 [`../../docs/DEIDENTIFICATION_RECOVERY.md`](../../docs/DEIDENTIFICATION_RECOVERY.md)를 참고하세요.
