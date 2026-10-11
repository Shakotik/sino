"""Extract card-ready HSK vocabulary from the Russian-language source PDFs.

The PDFs have a visual table, not a machine-readable spreadsheet.  Instead of
trying to guess entries from plain text, this script uses the table columns:
number, word, pinyin and Russian translation.  It creates a reviewable JSON
file which the JavaScript catalogue builder reads afterwards.

Run from the project folder:
    python scripts/extractRussianHskPdfCatalogs.py
"""

from __future__ import annotations

import json
import re
import unicodedata
from collections import defaultdict
from pathlib import Path

import pdfplumber


DOWNLOADS = Path(r"C:\Users\Legion\Downloads")
OUTPUT_PATH = Path(__file__).resolve().parents[1] / "data" / "sources" / "russian-hsk2-6-from-pdfs.json"

# Column positions differ slightly between the two PDF designs.  x coordinates
# are measured from the left edge of each PDF page in points.
SOURCES = {
    2: {
        "file": "HSK2_3.0_список_словаря_русский_2026.pdf",
        "number_range": (65, 85),
        "word_range": (85, 145),
        "pinyin_range": (145, 225),
        "translation_range": (220, 400),
        "pinyin_brackets_required": False,
        "table_cells": True,
        "publisher": "Chinesimple by Khanji School",
    },
    3: {
        "file": "HSK_3_0_Uroven_3.pdf",
        "number_range": (45, 70),
        "word_range": (70, 135),
        "pinyin_range": (130, 220),
        "translation_range": (220, 520),
        "pinyin_brackets_required": True,
        "publisher": "Oskol Chinese (vk.com/oskolchinese)",
    },
    4: {
        "file": "HSK_3_0_Uroven_4.pdf",
        "number_range": (45, 70),
        "word_range": (70, 132),
        "pinyin_range": (130, 202),
        "translation_range": (200, 520),
        "pinyin_brackets_required": True,
        "publisher": "Oskol Chinese (vk.com/oskolchinese)",
    },
    5: {
        "file": "HSK_3_0_Uroven_5.pdf",
        "number_range": (45, 70),
        "word_range": (70, 135),
        "pinyin_range": (130, 220),
        "translation_range": (220, 520),
        "pinyin_brackets_required": True,
        "publisher": "Oskol Chinese (vk.com/oskolchinese)",
    },
    6: {
        "file": "HSK_3_0_Uroven_6.pdf",
        "number_range": (45, 70),
        "word_range": (70, 135),
        "pinyin_range": (130, 220),
        "translation_range": (220, 520),
        "pinyin_brackets_required": True,
        "publisher": "Oskol Chinese (vk.com/oskolchinese)",
    },
}


def clean_text(value: str) -> str:
    """Normalise PDF glyph variants and make wrapped text readable."""
    normalized = unicodedata.normalize("NFKC", value)
    # The HSK 2 PDF uses the simplified radical glyphs in six words.  They look
    # like ordinary characters on the page but are separate Unicode symbols,
    # which would break search and comparison in the application.
    normalized = normalized.translate(
        str.maketrans({
            "⻋": "车",
            "⻓": "长",
            "⻔": "门",
            "⻜": "飞",
            "⻥": "鱼",
            "⻦": "鸟",
        })
    )
    normalized = re.sub(r"\s+", " ", normalized).strip()
    return normalized


def line_groups(words: list[dict]) -> list[list[dict]]:
    """Group PDF words that sit on one printed line (with a small tolerance)."""
    groups: list[list[dict]] = []
    for word in sorted(words, key=lambda item: (item["top"], item["x0"])):
        # In the HSK 2 PDF the Chinese word is placed a few points above its
        # row number; five points still keeps adjacent printed lines separate.
        if not groups or abs(word["top"] - groups[-1][0]["top"]) > 5:
            groups.append([word])
        else:
            groups[-1].append(word)
    return groups


def is_row_start(line: list[dict], config: dict) -> dict | None:
    """Return the numbering cell when a table row starts on this line."""
    number_min, number_max = config["number_range"]
    word_min, word_max = config["word_range"]
    pinyin_min, pinyin_max = config["pinyin_range"]

    number = next(
        (
            item
            for item in line
            if number_min <= item["x0"] <= number_max and item["text"].isdigit()
        ),
        None,
    )
    if number is None:
        return None

    has_word = any(word_min <= item["x0"] < word_max for item in line)
    pinyin_tokens = [
        item["text"]
        for item in line
        if pinyin_min <= item["x0"] < pinyin_max
    ]
    pinyin_text = "".join(pinyin_tokens)
    has_pinyin = bool(pinyin_text)
    if config["pinyin_brackets_required"]:
        has_pinyin = has_pinyin and "[" in pinyin_text

    return number if has_word and has_pinyin else None


def text_from_column(segment: list[dict], start: float, end: float) -> str:
    values = [
        clean_text(item["text"])
        for item in sorted(segment, key=lambda item: (item["top"], item["x0"]))
        if start <= item["x0"] < end
    ]
    return clean_text(" ".join(values))


def extract_page_rows(page: pdfplumber.page.Page, config: dict) -> list[dict]:
    """Read vocabulary rows from one PDF page using its visual columns."""
    if config.get("table_cells"):
        return extract_table_cell_rows(page)

    words = page.extract_words()
    lines = line_groups(words)
    anchors: list[tuple[int, dict]] = []
    for line_index, line in enumerate(lines):
        number = is_row_start(line, config)
        if number is not None:
            anchors.append((line_index, number))

    rows: list[dict] = []
    for anchor_index, (start_line, number) in enumerate(anchors):
        end_line = anchors[anchor_index + 1][0] if anchor_index + 1 < len(anchors) else len(lines)
        segment = [item for line in lines[start_line:end_line] for item in line]

        word = text_from_column(segment, *config["word_range"])
        pinyin = text_from_column(segment, *config["pinyin_range"])
        translation = text_from_column(segment, *config["translation_range"])
        pinyin = pinyin.strip("[] ")
        # A download banner is printed at the bottom of several HSK 2 pages.
        # It shares the translation column and therefore has to be removed.
        translation = re.sub(r"\s*Скачайте из Google Play.*$", "", translation).strip()

        # Number cells and headings must never become a card.  This additionally
        # protects against numbered exercise instructions later in the PDFs.
        if word and pinyin and translation:
            rows.append(
                {
                    "sourcePosition": int(number["text"]),
                    "hanzi": word,
                    "pinyin": pinyin,
                    "translationRu": translation,
                    "page": page.page_number,
                }
            )
    return rows


def extract_table_cell_rows(page: pdfplumber.page.Page) -> list[dict]:
    """Read HSK 2 from actual PDF table cells rather than text coordinates.

    The HSK 2 design vertically centres its number and Chinese word in tall
    cells.  A word may therefore sit lower than the first line of its
    translation, so coordinate-only grouping would attach wrapped meanings to
    a neighbouring word.  The PDF exposes a real five-column table, which is
    both simpler and more accurate for this particular document.
    """
    rows: list[dict] = []
    for table in page.extract_tables():
        for cells in table:
            if len(cells) < 4:
                continue

            position, word, pinyin, translation = cells[:4]
            if not position or not clean_text(position).isdigit():
                continue

            word = clean_text(word or "")
            pinyin = clean_text(pinyin or "").strip("[] ")
            translation = clean_text(translation or "")
            if word and pinyin and translation:
                rows.append(
                    {
                        "sourcePosition": int(clean_text(position)),
                        "hanzi": word,
                        "pinyin": pinyin,
                        "translationRu": translation,
                        "page": page.page_number,
                    }
                )
    return rows


def extract_level(level: int, config: dict) -> dict:
    pdf_path = DOWNLOADS / config["file"]
    if not pdf_path.exists():
        raise FileNotFoundError(f"PDF not found: {pdf_path}")

    extracted: list[dict] = []
    with pdfplumber.open(pdf_path) as pdf:
        for page in pdf.pages:
            extracted.extend(extract_page_rows(page, config))

    # Keep only actual numbered vocabulary rows; headings and exercises cannot
    # pass this check.  If the PDF repeats a number, the first table occurrence
    # is retained and the later one is left visible in the source PDF for review.
    by_position: dict[int, dict] = {}
    for row in extracted:
        by_position.setdefault(row["sourcePosition"], row)
    rows = [by_position[position] for position in sorted(by_position)]

    expected_positions = list(range(1, len(rows) + 1))
    actual_positions = [row["sourcePosition"] for row in rows]
    if actual_positions != expected_positions:
        raise ValueError(
            f"HSK {level}: non-contiguous row numbers; got {actual_positions[:3]} … {actual_positions[-3:]}"
        )

    return {
        "level": level,
        "sourceFile": config["file"],
        "publisher": config["publisher"],
        "wordCount": len(rows),
        "words": rows,
    }


def main() -> None:
    catalogues = {str(level): extract_level(level, config) for level, config in SOURCES.items()}
    payload = {
        "format": "sino-russian-hsk-pdf-v1",
        "notes": "Extracted from user-supplied Russian HSK PDFs. Verify publisher rights before public redistribution.",
        "catalogues": catalogues,
    }
    OUTPUT_PATH.parent.mkdir(parents=True, exist_ok=True)
    OUTPUT_PATH.write_text(json.dumps(payload, ensure_ascii=False, indent=2) + "\n", encoding="utf-8")

    for level, catalogue in catalogues.items():
        print(f"HSK {level}: {catalogue['wordCount']} words")
    print(f"Wrote {OUTPUT_PATH}")


if __name__ == "__main__":
    main()
