"""PNG 이미지 속 한국어 개인정보를 찾아 새 PNG에 비식별화 상자를 합성한다.

원본 파일은 수정하지 않는다. 출력에서 가림을 되돌릴 수 없으므로 원본은 기관 정책에
맞는 승인된 로컬 저장소에서 별도로 관리한다.
"""

from __future__ import annotations

import argparse
from pathlib import Path

import numpy as np
from PIL import Image, ImageDraw
from presidio_analyzer import AnalyzerEngine, Pattern, PatternRecognizer
from presidio_analyzer.nlp_engine import NlpEngineProvider
from presidio_image_redactor import ImageAnalyzerEngine
from presidio_image_redactor.ocr import OCR


NAME_LABELS = ["성명", "이름"]
LABEL_VALUE_MAX_GAP_PX = 40
LABEL_VALUE_STOP_TOKENS = {"|", ":"}
EMAIL_MERGE_GAP_PX = 20
COLUMN_SPLIT_GAP_PX = 150
ROW_Y_TOLERANCE_PX = 12


class EasyOCRBackend(OCR):
    """EasyOCR를 presidio-image-redactor OCR 인터페이스에 연결한다."""

    def __init__(self, langs: tuple[str, ...] = ("ko", "en")) -> None:
        import easyocr

        self._reader = easyocr.Reader(list(langs), gpu=False, verbose=False)

    def perform_ocr(self, image, **kwargs) -> dict:
        del kwargs
        if isinstance(image, Image.Image):
            image = np.array(image.convert("RGB"))
        results = self._reader.readtext(image)

        text, left, top, width, height, conf = [], [], [], [], [], []
        for bbox, detected_text, score in results:
            xs = [point[0] for point in bbox]
            ys = [point[1] for point in bbox]
            l, t = min(xs), min(ys)
            text.append(detected_text)
            left.append(int(l))
            top.append(int(t))
            width.append(int(max(xs) - l))
            height.append(int(max(ys) - t))
            conf.append(score * 100)

        return {
            "text": text,
            "left": left,
            "top": top,
            "width": width,
            "height": height,
            "conf": conf,
        }


def build_korean_analyzer() -> AnalyzerEngine:
    nlp_configuration = {
        "nlp_engine_name": "spacy",
        "models": [{"lang_code": "ko", "model_name": "ko_core_news_sm"}],
    }
    nlp_engine = NlpEngineProvider(nlp_configuration=nlp_configuration).create_engine()
    analyzer = AnalyzerEngine(nlp_engine=nlp_engine, supported_languages=["ko"])

    recognizers = [
        PatternRecognizer(
            supported_entity="KR_RRN",
            supported_language="ko",
            patterns=[Pattern(name="rrn", regex=r"\d{6}[-\s]?[1-8]\d{6}", score=0.9)],
        ),
        PatternRecognizer(
            supported_entity="KR_PHONE_NUMBER",
            supported_language="ko",
            patterns=[
                Pattern(name="mobile", regex=r"01[016789][-\s]?\d{3,4}[-\s]?\d{4}", score=0.85),
                Pattern(name="landline", regex=r"0\d{1,2}[-\s]?\d{3,4}[-\s]?\d{4}", score=0.6),
            ],
        ),
        PatternRecognizer(
            supported_entity="EMAIL_ADDRESS",
            supported_language="ko",
            patterns=[
                Pattern(
                    name="email",
                    regex=r"[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}",
                    score=0.85,
                )
            ],
        ),
    ]
    for recognizer in recognizers:
        analyzer.registry.add_recognizer(recognizer)
    return analyzer


def _box(word: dict) -> tuple[int, int, int, int]:
    return (
        word["left"],
        word["top"],
        word["left"] + word["width"],
        word["top"] + word["height"],
    )


def _merge_boxes(boxes: list[tuple[int, int, int, int]]) -> tuple[int, int, int, int]:
    return (
        min(box[0] for box in boxes),
        min(box[1] for box in boxes),
        max(box[2] for box in boxes),
        max(box[3] for box in boxes),
    )


def _words_from_ocr_dict(ocr_result: dict) -> list[dict]:
    words = []
    for index, text in enumerate(ocr_result["text"]):
        text = text.strip()
        if not text:
            continue
        words.append(
            {
                "text": text,
                "left": ocr_result["left"][index],
                "top": ocr_result["top"][index],
                "width": ocr_result["width"][index],
                "height": ocr_result["height"][index],
            }
        )
    return words


def _cluster_rows(words: list[dict]) -> list[list[dict]]:
    """세로 중심이 비슷한 단어를 같은 행으로 묶되 기준점은 첫 단어에 고정한다."""
    rows: list[dict] = []
    for word in sorted(words, key=lambda item: item["top"]):
        center = word["top"] + word["height"] / 2
        for row in rows:
            if abs(center - row["ref_center"]) <= ROW_Y_TOLERANCE_PX:
                row["words"].append(word)
                break
        else:
            rows.append({"words": [word], "ref_center": center})
    return [sorted(row["words"], key=lambda item: item["left"]) for row in rows]


def _split_into_columns(row: list[dict]) -> list[list[dict]]:
    if not row:
        return []
    groups = [[row[0]]]
    for previous, current in zip(row, row[1:]):
        gap = current["left"] - (previous["left"] + previous["width"])
        if gap > COLUMN_SPLIT_GAP_PX:
            groups.append([])
        groups[-1].append(current)
    return groups


def find_email_like_boxes(words: list[dict]) -> list[tuple[int, int, int, int]]:
    boxes = []
    for row in _cluster_rows(words):
        for index, word in enumerate(row):
            if "@" not in word["text"]:
                continue
            group = [word]
            for neighbor_index in (index - 1, index + 1):
                if not 0 <= neighbor_index < len(row):
                    continue
                other = row[neighbor_index]
                gap = min(
                    abs(other["left"] - (word["left"] + word["width"])),
                    abs(word["left"] - (other["left"] + other["width"])),
                )
                if gap <= EMAIL_MERGE_GAP_PX:
                    group.append(other)
            boxes.append(_merge_boxes([_box(item) for item in group]))
    return boxes


def find_label_value_boxes(
    words: list[dict], labels: list[str] = NAME_LABELS
) -> list[tuple[int, int, int, int]]:
    boxes = []
    for row in _cluster_rows(words):
        for group in _split_into_columns(row):
            concatenated = "".join(word["text"] for word in group).replace(" ", "")
            for label in labels:
                label_index = concatenated.find(label)
                if label_index == -1:
                    continue
                position = 0
                label_end_index = None
                for index, word in enumerate(group):
                    position += len(word["text"].replace(" ", ""))
                    if position >= label_index + len(label):
                        label_end_index = index
                        break
                if label_end_index is None:
                    continue

                value_words = []
                previous_right = None
                for word in group[label_end_index + 1 :]:
                    if word["text"] in LABEL_VALUE_STOP_TOKENS:
                        break
                    if (
                        previous_right is not None
                        and word["left"] - previous_right > LABEL_VALUE_MAX_GAP_PX
                    ):
                        break
                    value_words.append(word)
                    previous_right = word["left"] + word["width"]
                if value_words:
                    boxes.append(_merge_boxes([_box(word) for word in value_words]))
                break
    return boxes


def parse_fill(value: str) -> tuple[int, int, int]:
    try:
        channels = tuple(int(channel.strip()) for channel in value.split(","))
    except ValueError as error:
        raise argparse.ArgumentTypeError("가림 색상은 R,G,B 숫자 형식이어야 합니다.") from error
    if len(channels) != 3 or any(channel < 0 or channel > 255 for channel in channels):
        raise argparse.ArgumentTypeError("가림 색상의 각 값은 0~255 범위여야 합니다.")
    return channels


def redact_image(
    input_path: Path,
    output_path: Path,
    fill: tuple[int, int, int] = (0, 0, 0),
    entities: list[str] | None = None,
    apply_heuristics: bool = True,
) -> int:
    if input_path.resolve() == output_path.resolve():
        raise ValueError("원본 보호를 위해 입력과 출력 경로를 다르게 지정해야 합니다.")

    analyzer = build_korean_analyzer()
    ocr_backend = EasyOCRBackend()
    image_analyzer = ImageAnalyzerEngine(analyzer_engine=analyzer, ocr=ocr_backend)
    with Image.open(input_path) as opened:
        image = opened.convert("RGB")

    ocr_result = ocr_backend.perform_ocr(image)
    words = _words_from_ocr_dict(ocr_result)
    results = image_analyzer.analyze(image, language="ko", entities=entities)
    boxes = [
        (result.left, result.top, result.left + result.width, result.top + result.height)
        for result in results
    ]
    if apply_heuristics:
        boxes.extend(find_email_like_boxes(words))
        boxes.extend(find_label_value_boxes(words))

    redacted = image.copy()
    draw = ImageDraw.Draw(redacted)
    for box in boxes:
        draw.rectangle(box, fill=fill)
    output_path.parent.mkdir(parents=True, exist_ok=True)
    redacted.save(output_path, format="PNG")
    return len(boxes)


def main() -> None:
    parser = argparse.ArgumentParser(description="PNG 이미지 내 한국어 개인정보 비식별화")
    parser.add_argument("input", type=Path, help="원본 PNG 경로")
    parser.add_argument("output", type=Path, help="별도로 저장할 비식별화 PNG 경로")
    parser.add_argument(
        "--fill",
        type=parse_fill,
        default=(0, 0, 0),
        help="가릴 색상 R,G,B (기본: 0,0,0)",
    )
    parser.add_argument(
        "--entities",
        nargs="*",
        default=None,
        help="탐지 항목 제한 (예: KR_RRN KR_PHONE_NUMBER EMAIL_ADDRESS PERSON)",
    )
    parser.add_argument(
        "--no-heuristics",
        action="store_true",
        help="@ 및 성명/이름 라벨 기반 보정 규칙 끄기",
    )
    args = parser.parse_args()

    count = redact_image(
        args.input,
        args.output,
        fill=args.fill,
        entities=args.entities,
        apply_heuristics=not args.no_heuristics,
    )
    print(f"저장 완료: {args.output} (가림 영역 {count}개)")
    print("자동 탐지는 누락될 수 있습니다. 출력 파일을 확대해 직접 확인하세요.")


if __name__ == "__main__":
    main()
