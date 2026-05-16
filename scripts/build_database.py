from __future__ import annotations

import csv
import html
import json
import re
import shutil
import sqlite3
import zipfile
from collections import Counter
from pathlib import Path
from xml.etree import ElementTree as ET

from pypdf import PdfReader


ROOT = Path(__file__).resolve().parents[1]
PDF_PATH = Path(
    "/Users/jackreilly/Library/Containers/com.apple.mail/Data/Library/Mail Downloads/"
    "5135A38B-0EAD-4101-805B-00DD648A7A11/LEXILOGIO-THEMATIKO (1).pdf"
)
DATA_DIR = ROOT / "data"
DICTIONARY_PATH = Path("/Users/jackreilly/Downloads/Greek-English Wiktionary dictionary.tsv")
SILENTSHUFFLE_DIR = Path(
    "/Users/jackreilly/Downloads/top-5000-words-in-greek by SilentShuffle [426582]"
)
SILENTSHUFFLE_CSV = SILENTSHUFFLE_DIR / "top-5000-words-in-greek [426582]_(~5000).csv"
SILENTSHUFFLE_MEDIA_DIR = SILENTSHUFFLE_DIR / "top-5000-words-in-greek [426582]_media(4985)"
SITE_AUDIO_DIR = ROOT / "public" / "audio"
EXCEL_VOCAB_PATH = Path("/Users/jackreilly/Downloads/Greek_Vocabulary_Words.xlsx")

THEMES = {
    1: "Οικογένεια: ο θεσμός - οι δεσμοί",
    2: "Κατοικία: οι χώροι και η λειτουργία τους, καθημερινή ζωή",
    3: "Η γειτονιά μου - Χωροταξικά",
    4: "Σχολείο - Εκπαίδευση",
    5: "Επαγγέλματα - Εργασιακός χώρος",
    6: "Διατροφή",
    7: "Ενδυμασία - Προσωπικά αντικείμενα - Αγορά",
    8: "Ελεύθερος χρόνος: παιχνίδια - χόμπι - διασκέδαση - άθληση",
    9: "Ο χρόνος και οι εποχές - Ο καιρός",
    10: "Μεταφορικά μέσα - Ταξίδια",
    11: "Το ανθρώπινο σώμα - Η υγεία",
    12: "Πανίδα - Χλωρίδα",
    13: "Top 5000",
    14: "TetRadio Zografikis",
    15: "Gatos Zita Oikogeneia",
    16: "Xionanthropos",
    17: "Yi Adoption",
    18: "Poli Sto Xioni",
    19: "Nea Geitonia",
}

def course_for_theme(theme_id: int) -> str:
    if 1 <= theme_id <= 12:
        return "Afrodite Lourbakos"
    if theme_id == 13:
        return "Top 5000"
    if 14 <= theme_id <= 19:
        return "3rd Grade A1 Certification"
    return "Other"


def course_id_for_name(name: str) -> str:
    return (
        name.strip()
        .lower()
        .replace(" ", "-")
        .replace("3rd-grade-a1-certification", "3rd-grade-a1-certification")
    )

PAGE_STRUCTURE = {
    1: (1, "Ουσιαστικά", None),
    2: (1, "Ουσιαστικά", None),
    3: (1, "Επίθετα", None),
    4: (1, "Ρήματα", None),
    5: (1, "Εκφράσεις", None),
    6: (2, "Ουσιαστικά", None),
    7: (2, "Ουσιαστικά", None),
    8: (2, "Ουσιαστικά", None),
    9: (2, "Επίθετα", None),
    10: (2, "Ρήματα", None),
    11: (2, "Εκφράσεις", None),
    12: (3, "Ουσιαστικά", None),
    13: (3, "Ουσιαστικά", None),
    14: (3, "Επίθετα", None),
    15: (3, "Ρήματα", None),
    16: (3, "Εκφράσεις", None),
    17: (4, "Ουσιαστικά", None),
    18: (4, "Ουσιαστικά", None),
    19: (4, "Επίθετα", None),
    20: (4, "Ρήματα", None),
    21: (4, "Εκφράσεις", None),
    22: (5, "Ουσιαστικά", None),
    23: (5, "Ουσιαστικά", None),
    24: (5, "Ουσιαστικά", None),
    25: (5, "Επίθετα", None),
    26: (5, "Ρήματα", None),
    27: (5, "Εκφράσεις", None),
    28: (6, "Ουσιαστικά", None),
    29: (6, "Ουσιαστικά", None),
    30: (6, "Ουσιαστικά", None),
    31: (6, "Ουσιαστικά", None),
    32: (6, "Επίθετα", None),
    33: (6, "Ρήματα", None),
    34: (6, "Εκφράσεις", None),
    35: (7, "Ουσιαστικά", None),
    36: (7, "Ουσιαστικά", None),
    37: (7, "Επίθετα", None),
    38: (7, "Ρήματα", None),
    39: (7, "Εκφράσεις", None),
    40: (8, "Ουσιαστικά", None),
    41: (8, "Ουσιαστικά", None),
    42: (8, "Ουσιαστικά", None),
    43: (8, "Ουσιαστικά", None),
    44: (8, "Επίθετα", None),
    45: (8, "Ρήματα", None),
    46: (8, "Εκφράσεις", None),
    47: (9, "Ουσιαστικά", None),
    48: (9, "Ουσιαστικά", None),
    49: (9, "Ουσιαστικά", None),
    50: (9, "Επίθετα", None),
    51: (9, "Ρήματα", None),
    52: (9, "Εκφράσεις", None),
    53: (10, "Ουσιαστικά", None),
    54: (10, "Ουσιαστικά", None),
    55: (10, "Ουσιαστικά", None),
    56: (10, "Επίθετα", None),
    57: (10, "Ρήματα", None),
    58: (10, "Εκφράσεις", None),
    59: (11, "Ουσιαστικά", None),
    60: (11, "Ουσιαστικά", None),
    61: (11, "Ουσιαστικά", None),
    62: (11, "Επίθετα", None),
    63: (11, "Ρήματα", None),
    64: (11, "Εκφράσεις", None),
    65: (12, "Ουσιαστικά", "Πανίδα"),
    66: (12, "Ουσιαστικά", "Πανίδα"),
    67: (12, "Ουσιαστικά", "Πανίδα"),
    68: (12, "Επίθετα", "Πανίδα"),
    69: (12, "Ρήματα", "Πανίδα"),
    70: (12, "Ουσιαστικά", "Χλωρίδα"),
    71: (12, "Ουσιαστικά", "Χλωρίδα"),
    72: (12, "Επίθετα", "Χλωρίδα"),
    73: (12, "Ρήματα", "Χλωρίδα"),
    74: (12, "Εκφράσεις", None),
}

ARTICLE_PARTS = {"ο", "η", "το", "οι", "τα", "ο/η", "η/ο"}
ARTICLE_PATTERN = r"ο/η|η/ο|ο|η|το|οι|τα"
GREEK_RE = re.compile(r"[Α-Ωα-ωΆ-Ώά-ώΐΰϊϋ]+")
GREEK_SUFFIX_RE = re.compile(r"(?:^|[\s,])(-[Α-Ωα-ωΆ-Ώά-ώΐΰϊϋ]+)")


def clean_text(value: str) -> str:
    value = value.replace("\u00b5", "μ")
    value = value.replace("\uf8ff", "")
    value = re.sub(r"\s+", " ", value)
    value = value.strip(" ,")
    return value


def normalize_lookup(value: str) -> str:
    value = clean_text(value).lower()
    replacements = str.maketrans(
        {
            "ά": "α",
            "έ": "ε",
            "ή": "η",
            "ί": "ι",
            "ΐ": "ι",
            "ό": "ο",
            "ύ": "υ",
            "ΰ": "υ",
            "ώ": "ω",
            "ϊ": "ι",
            "ϋ": "υ",
            "ς": "σ",
        }
    )
    return value.translate(replacements)


def strip_html(value: str) -> str:
    value = re.sub(r"<br\s*/?>", " ", value, flags=re.IGNORECASE)
    value = re.sub(r"<[^>]+>", "", value)
    value = html.unescape(value)
    return re.sub(r"\s+", " ", value).strip()


def extract_definition_senses(value: str) -> list[str]:
    items = re.findall(r"<li>(.*?)</li>", value, flags=re.IGNORECASE | re.DOTALL)
    if not items:
        items = re.split(r"\s*;\s*", strip_html(value))
    senses = [strip_html(item) for item in items]
    return [sense for sense in senses if sense]


def split_short_definition(value: str) -> list[str]:
    value = strip_html(value)
    if not value:
        return []
    if ";" in value:
        parts = re.split(r"\s*;\s*", value)
    else:
        parts = re.split(r"\s*,\s*", value)
    return [part for part in parts if part]


def split_english_senses(value: str) -> list[str]:
    value = clean_text(value)
    if not value:
        return []
    parts = re.split(r"\s*(?:;|,)\s*", value)
    return [part for part in parts if part]


def normalize_article(value: str) -> str:
    value = clean_text(value).replace(" ", "")
    if value == "η/ο":
        return "ο/η"
    return value


def combine_articles(articles: list[str]) -> str | None:
    seen = []
    for article in articles:
        normalized = normalize_article(article)
        for part in normalized.split("/"):
            if part and part not in seen:
                seen.append(part)
    if not seen:
        return None
    return "/".join(seen)


def clean_lemma_fragment(value: str) -> str:
    value = re.sub(r"\(\s*(?:ο/η|η/ο|ο|η|το|οι|τα)\s*\)", " ", value)
    value = re.sub(r"\s*/\s*", "/", value)
    return clean_text(value)


def parse_spreadsheet_noun(term: str) -> tuple[str, str | None, bool]:
    articles = re.findall(rf"\(\s*({ARTICLE_PATTERN})\s*\)", term)
    if articles:
        lemma = clean_lemma_fragment(term)
        article = combine_articles(articles)
        if lemma and article:
            return lemma, article, True

    match = re.match(rf"^\s*({ARTICLE_PATTERN})\s+(.+)$", term)
    if match:
        article, lemma = match.groups()
        return clean_lemma_fragment(lemma), normalize_article(article), True

    return term, None, False


def parse_form_suffixes(term: str) -> tuple[str, list[str]]:
    suffixes = GREEK_SUFFIX_RE.findall(term)
    if suffixes:
        first_suffix = re.search(r"(?:[\s,])-", term)
        lemma = clean_text(term[: first_suffix.start()] if first_suffix else term)
        lemma = lemma.rstrip(",")
        return lemma, suffixes

    slash_suffix = re.match(r"^(.+?)/([Α-Ωα-ωΆ-Ώά-ώΐΰϊϋ]{1,4})$", term)
    if slash_suffix:
        lemma, suffix = slash_suffix.groups()
        return clean_text(lemma), [f"/{suffix}"]

    return term, []


def looks_like_verb(lemma: str) -> bool:
    first_word = lemma.split()[0]
    return bool(
        re.search(
            r"(ω|ώ|ομαι|όμαι|αμαι|άμαι|ιέμαι|ούμαι|εύω|ίζω|άζω|αίνω|ώνω)$",
            first_word,
        )
        or "/ώ" in first_word
    )


def classify_spreadsheet_entry(term: str, lemma: str, article: str | None, suffixes: list[str]) -> str:
    if article:
        return "Ουσιαστικά"
    if looks_like_verb(lemma):
        return "Ρήματα"
    if suffixes:
        return "Επίθετα"
    return "Εκφράσεις"


def extract_audio_filename(value: str) -> str | None:
    match = re.search(r"\[sound:([^\]]+)\]", value)
    return match.group(1) if match else None


def greek_forms_from_learnable(value: str) -> list[str]:
    main = value.split("<div", 1)[0]
    visible = re.sub(
        r'<div[^>]*\bhidden\b[^>]*>.*?</div>',
        " ",
        value,
        flags=re.IGNORECASE | re.DOTALL,
    )
    forms = []
    main_text = clean_text(strip_html(main))
    if GREEK_RE.search(main_text):
        forms.append(main_text)

    text = strip_html(visible)
    for part in re.split(r"[|,;/()]", text):
        part = clean_text(part)
        if GREEK_RE.search(part):
            forms.append(part)
    return list(dict.fromkeys(forms))


def load_silentshuffle_records() -> list[dict]:
    if not SILENTSHUFFLE_CSV.exists():
        return []

    records = []
    with SILENTSHUFFLE_CSV.open(encoding="utf-8-sig", newline="") as handle:
        reader = csv.reader(handle)
        for row in reader:
            if len(row) != 9 or row[0].startswith("#"):
                continue
            learnable, definition, audio, part_of_speech, notes, disambiguation, *_ = row
            forms = greek_forms_from_learnable(learnable)
            if not forms:
                continue
            audio_filename = extract_audio_filename(audio)
            records.append(
                {
                    "top5000_rank": len(records) + 1,
                    "top5000_headword": forms[0],
                    "top5000_forms": forms,
                    "top5000_definition": strip_html(definition),
                    "top5000_senses": split_short_definition(definition),
                    "top5000_part_of_speech": strip_html(part_of_speech),
                    "top5000_notes": strip_html(notes),
                    "top5000_disambiguation": strip_html(disambiguation),
                    "audio_filename": audio_filename,
                }
            )
    return records


def load_silentshuffle() -> dict[str, dict]:
    lookup = {}
    for record in load_silentshuffle_records():
        lookup_record = {
            key: value for key, value in record.items() if key != "top5000_forms"
        }
        for form in record["top5000_forms"]:
            normalized = normalize_lookup(form)
            if normalized:
                lookup.setdefault(normalized, lookup_record)
    return lookup


def load_dictionary() -> dict[str, dict]:
    lookup = {}
    with DICTIONARY_PATH.open(encoding="utf-8", newline="") as handle:
        reader = csv.reader(handle, delimiter="\t")
        for row in reader:
            if len(row) < 2:
                continue
            key_blob, definition_html = row[0], row[1]
            variants = [clean_text(part) for part in key_blob.split("|")]
            greek_variants = [variant for variant in variants if GREEK_RE.search(variant)]
            if not greek_variants:
                continue
            headword = greek_variants[0]
            senses = extract_definition_senses(definition_html)
            record = {
                "dictionary_headword": headword,
                "english": "; ".join(senses),
                "english_senses": senses,
            }
            headword_key = normalize_lookup(headword)
            for variant in greek_variants:
                normalized = normalize_lookup(variant)
                if not normalized:
                    continue
                if normalized == headword_key:
                    lookup[normalized] = record
                else:
                    lookup.setdefault(normalized, record)
    return lookup


def lookup_candidates(lemma: str, term: str) -> list[tuple[str, str]]:
    raw_candidates = [
        ("exact", lemma),
        ("exact_term", term),
        ("derived", re.sub(r"\(.*?\)", "", lemma)),
        ("derived", lemma.split("-")[0]),
        ("derived", lemma.split("/")[0]),
    ]
    seen = set()
    candidates = []
    for match_type, candidate in raw_candidates:
        candidate = clean_text(candidate)
        normalized = normalize_lookup(candidate)
        if normalized and normalized not in seen:
            seen.add(normalized)
            candidates.append((match_type, normalized))
    return candidates


def find_lookup_match(entry: dict, lookup: dict[str, dict]) -> tuple[dict | None, str]:
    for candidate_type, candidate in lookup_candidates(entry["lemma"], entry["term"]):
        if candidate in lookup:
            return lookup[candidate], "exact" if candidate_type.startswith("exact") else "derived"
    return None, "unmatched"


def copy_audio(audio_filename: str | None) -> str | None:
    if not audio_filename:
        return None
    source = SILENTSHUFFLE_MEDIA_DIR / audio_filename
    if not source.exists():
        return None

    SITE_AUDIO_DIR.mkdir(parents=True, exist_ok=True)
    target = SITE_AUDIO_DIR / audio_filename
    if not target.exists() or target.stat().st_size != source.stat().st_size:
        shutil.copy2(source, target)
    return f"audio/{audio_filename}"


def cleanup_copied_audio(entries: list[dict]) -> None:
    if not SITE_AUDIO_DIR.exists():
        return
    referenced = {
        Path(entry["audio_path"]).name
        for entry in entries
        if entry.get("audio_path")
    }
    for audio_file in SITE_AUDIO_DIR.glob("*.mp3"):
        if audio_file.name not in referenced:
            audio_file.unlink()


def add_translations(entries: list[dict]) -> None:
    dictionary = load_dictionary()
    top5000 = load_silentshuffle()
    for entry in entries:
        match, match_type = find_lookup_match(entry, dictionary)
        top_match, top_match_type = find_lookup_match(entry, top5000)

        if entry.get("english_source") == "xlsx" and entry.get("english"):
            english = entry["english"]
            english_senses = entry.get("english_senses") or split_english_senses(english)
            dictionary_headword = match["dictionary_headword"] if match else None
            match_type = f"xlsx_{match_type}" if match else "xlsx"
            english_source = "xlsx"
        elif match:
            english = match["english"]
            english_senses = match["english_senses"]
            dictionary_headword = match["dictionary_headword"]
            english_source = "wiktionary"
        elif top_match:
            english = top_match["top5000_definition"]
            english_senses = top_match["top5000_senses"]
            dictionary_headword = None
            match_type = f"top5000_{top_match_type}"
            english_source = "top5000"
        else:
            english = None
            english_senses = []
            dictionary_headword = None
            english_source = None

        entry["english"] = english
        entry["english_senses"] = english_senses
        entry["english_source"] = english_source
        entry["dictionary_headword"] = dictionary_headword
        entry["translation_match"] = match_type
        entry["top5000_headword"] = top_match["top5000_headword"] if top_match else None
        entry["top5000_rank"] = top_match["top5000_rank"] if top_match else None
        entry["top5000_definition"] = top_match["top5000_definition"] if top_match else None
        entry["top5000_senses"] = top_match["top5000_senses"] if top_match else []
        entry["top5000_part_of_speech"] = top_match["top5000_part_of_speech"] if top_match else None
        entry["top5000_notes"] = top_match["top5000_notes"] if top_match else None
        entry["top5000_disambiguation"] = top_match["top5000_disambiguation"] if top_match else None
        entry["top5000_match"] = top_match_type if top_match else "unmatched"
        entry["audio_filename"] = top_match["audio_filename"] if top_match else None
        entry["audio_path"] = copy_audio(entry["audio_filename"])
        entry["audio_available"] = bool(entry["audio_path"])


def is_page_number(line: str, page_number: int) -> bool:
    return re.sub(r"\s+", "", line) == str(page_number)


def is_pdf_heading(line: str) -> bool:
    bad_chars = set("√∂ƒÎÔÁ¤ıÂÛÌﬁ˜‰›·ÙÙÔ˘ÚÏ˘¯ÒıÛÈÎ¿‹ÊÚ")
    if any(char in line for char in bad_chars):
        return True
    return bool(re.match(r"^\d+\.", line))


def parse_noun(term: str, category: str) -> tuple[str, str | None, bool]:
    if category != "Ουσιαστικά" or "," not in term:
        return term, None, False

    pieces = [piece.strip() for piece in term.split(",") if piece.strip()]
    if len(pieces) < 2:
        return term, None, False

    article_pieces = pieces[1:]
    if all(piece in ARTICLE_PARTS for piece in article_pieces):
        return pieces[0], ", ".join(article_pieces), False

    return term, None, False


def extract_entries() -> list[dict]:
    reader = PdfReader(PDF_PATH)
    entries = []
    counters: Counter[tuple[int, str, str | None]] = Counter()

    for page_number, page in enumerate(reader.pages, start=1):
        theme_id, category, subsection = PAGE_STRUCTURE[page_number]
        raw_lines = page.extract_text().splitlines()
        for raw_line in raw_lines:
            line = clean_text(raw_line)
            if not line or is_page_number(line, page_number) or is_pdf_heading(line):
                continue

            lemma, article, _ = parse_noun(line, category)
            counters[(theme_id, category, subsection)] += 1
            entries.append(
                {
                    "id": len(entries) + 1,
                    "theme_id": theme_id,
                    "theme": THEMES[theme_id],
                    "category": category,
                    "subsection": subsection,
                    "term": line,
                    "lemma": lemma,
                    "article": article,
                    "entry_source": "pdf",
                    "frequency_rank": None,
                    "page": page_number,
                    "position_in_group": counters[(theme_id, category, subsection)],
                    "form_suffixes": [],
                }
            )

    return entries


def append_silentshuffle_entries(entries: list[dict]) -> None:
    for record in load_silentshuffle_records():
        rank = record["top5000_rank"]
        entries.append(
            {
                "id": len(entries) + 1,
                "theme_id": 13,
                "theme": THEMES[13],
                "category": "Top 5000",
                "subsection": record["top5000_part_of_speech"] or None,
                "term": record["top5000_headword"],
                "lemma": record["top5000_headword"],
                "article": None,
                "entry_source": "top5000",
                "frequency_rank": rank,
                "page": None,
                "position_in_group": rank,
                "form_suffixes": [],
            }
        )


def read_xlsx_rows(path: Path) -> dict[str, list[tuple[str, str]]]:
    if not path.exists():
        return {}

    ns = {
        "main": "http://schemas.openxmlformats.org/spreadsheetml/2006/main",
        "rel": "http://schemas.openxmlformats.org/officeDocument/2006/relationships",
        "pkgrel": "http://schemas.openxmlformats.org/package/2006/relationships",
    }

    with zipfile.ZipFile(path) as archive:
        shared_strings = []
        if "xl/sharedStrings.xml" in archive.namelist():
            root = ET.fromstring(archive.read("xl/sharedStrings.xml"))
            for item in root.findall("main:si", ns):
                shared_strings.append("".join(text.text or "" for text in item.findall(".//main:t", ns)))

        workbook = ET.fromstring(archive.read("xl/workbook.xml"))
        rels = ET.fromstring(archive.read("xl/_rels/workbook.xml.rels"))
        rel_targets = {
            rel.attrib["Id"]: rel.attrib["Target"]
            for rel in rels.findall("pkgrel:Relationship", ns)
        }

        rows_by_sheet = {}
        for sheet in workbook.findall("main:sheets/main:sheet", ns):
            title = sheet.attrib["name"]
            rel_id = sheet.attrib[f"{{{ns['rel']}}}id"]
            target = rel_targets[rel_id]
            sheet_path = f"xl/{target}" if not target.startswith("/") else target.lstrip("/")
            root = ET.fromstring(archive.read(sheet_path))
            rows = []
            for row in root.findall(".//main:sheetData/main:row", ns):
                values = []
                for cell in row.findall("main:c", ns):
                    cell_type = cell.attrib.get("t")
                    value_el = cell.find("main:v", ns)
                    inline_el = cell.find("main:is/main:t", ns)
                    if cell_type == "s" and value_el is not None:
                        value = shared_strings[int(value_el.text)]
                    elif inline_el is not None:
                        value = inline_el.text or ""
                    elif value_el is not None:
                        value = value_el.text or ""
                    else:
                        value = ""
                    values.append(clean_text(str(value)))
                if len(values) >= 2 and values[0] and values[1]:
                    rows.append((values[0], values[1]))
            rows_by_sheet[title] = rows[1:] if rows and rows[0] == ("Greek", "English") else rows
        return rows_by_sheet


def append_spreadsheet_entries(entries: list[dict]) -> None:
    rows_by_sheet = read_xlsx_rows(EXCEL_VOCAB_PATH)
    for theme_id in range(14, 20):
        title = THEMES[theme_id]
        rows = rows_by_sheet.get(title, [])
        counters: Counter[tuple[int, str, str | None]] = Counter()
        for greek, english in rows:
            term = clean_text(greek)
            lemma, article, is_noun = parse_spreadsheet_noun(term)
            if is_noun:
                term = f"{lemma},{article}"
                suffixes = []
            else:
                lemma, suffixes = parse_form_suffixes(term)
            category = classify_spreadsheet_entry(term, lemma, article, suffixes)
            counters[(theme_id, category, None)] += 1
            entries.append(
                {
                    "id": len(entries) + 1,
                    "theme_id": theme_id,
                    "theme": title,
                    "category": category,
                    "subsection": None,
                    "term": term,
                    "lemma": lemma,
                    "article": article,
                    "entry_source": "xlsx",
                    "frequency_rank": None,
                    "english": clean_text(english),
                    "english_senses": split_english_senses(english),
                    "english_source": "xlsx",
                    "page": None,
                    "position_in_group": counters[(theme_id, category, None)],
                    "form_suffixes": suffixes,
                }
            )


def build_json(entries: list[dict]) -> None:
    translation_counts = Counter(entry["translation_match"] for entry in entries)
    audio_count = sum(1 for entry in entries if entry["audio_available"])
    themes = []
    for theme_id, title in THEMES.items():
        theme_entries = [entry for entry in entries if entry["theme_id"] == theme_id]
        themes.append(
            {
                "id": theme_id,
                "title": title,
                "course": course_for_theme(theme_id),
                "courseId": course_id_for_name(course_for_theme(theme_id)),
                "entry_count": len(theme_entries),
                "categories": dict(Counter(entry["category"] for entry in theme_entries)),
            }
        )

    payload = {
        "source": {
            "dictionary": DICTIONARY_PATH.name,
            "translation_counts": dict(translation_counts),
            "audio_count": audio_count,
            "notes": [
                "English translations were joined from the Greek-English Wiktionary TSV by normalized Greek headword/variant.",
                "Top 5000 data is used as a supplemental translation source and for audio file references.",
                "Audio files are copied into public/audio when the referenced MP3 is present; rerun scripts/build_database.py to backfill later downloads.",
                "Theme and part labels are normalized into Greek from the visible document structure.",
            ],
        },
        "themes": themes,
        "entries": entries,
    }
    (DATA_DIR / "lexilogio.json").write_text(
        json.dumps(payload, ensure_ascii=False, indent=2), encoding="utf-8"
    )
    public_data_dir = ROOT / "public" / "data"
    public_data_dir.mkdir(exist_ok=True)
    shutil.copy2(DATA_DIR / "lexilogio.json", public_data_dir / "lexilogio.json")


def build_csv(entries: list[dict]) -> None:
    with (DATA_DIR / "lexilogio_entries.csv").open("w", encoding="utf-8", newline="") as handle:
        fieldnames = list(entries[0].keys())
        for entry in entries:
            for key in entry:
                if key not in fieldnames:
                    fieldnames.append(key)
        writer = csv.DictWriter(handle, fieldnames=fieldnames)
        writer.writeheader()
        for entry in entries:
            row = {
                key: json.dumps(value, ensure_ascii=False) if isinstance(value, list) else value
                for key, value in entry.items()
            }
            writer.writerow(row)


def build_sqlite(entries: list[dict]) -> None:
    db_path = DATA_DIR / "lexilogio.sqlite"
    if db_path.exists():
        db_path.unlink()

    with sqlite3.connect(db_path) as conn:
        conn.execute(
            """
            CREATE TABLE themes (
                id INTEGER PRIMARY KEY,
                title TEXT NOT NULL
            )
            """
        )
        conn.execute(
            """
            CREATE TABLE entries (
                id INTEGER PRIMARY KEY,
                theme_id INTEGER NOT NULL,
                theme TEXT NOT NULL,
                category TEXT NOT NULL,
                subsection TEXT,
                term TEXT NOT NULL,
                lemma TEXT NOT NULL,
                article TEXT,
                entry_source TEXT NOT NULL,
                frequency_rank INTEGER,
                english TEXT,
                english_senses TEXT NOT NULL,
                english_source TEXT,
                dictionary_headword TEXT,
                translation_match TEXT NOT NULL,
                top5000_headword TEXT,
                top5000_rank INTEGER,
                top5000_definition TEXT,
                top5000_senses TEXT NOT NULL,
                top5000_part_of_speech TEXT,
                top5000_notes TEXT,
                top5000_disambiguation TEXT,
                top5000_match TEXT NOT NULL,
                audio_filename TEXT,
                audio_path TEXT,
                audio_available INTEGER NOT NULL,
                page INTEGER,
                position_in_group INTEGER NOT NULL,
                form_suffixes TEXT NOT NULL,
                FOREIGN KEY(theme_id) REFERENCES themes(id)
            )
            """
        )
        conn.execute("CREATE INDEX idx_entries_theme ON entries(theme_id)")
        conn.execute("CREATE INDEX idx_entries_category ON entries(category)")
        conn.execute("CREATE INDEX idx_entries_term ON entries(term)")
        conn.execute("CREATE INDEX idx_entries_english ON entries(english)")

        conn.executemany(
            "INSERT INTO themes (id, title) VALUES (?, ?)",
            [(theme_id, title) for theme_id, title in THEMES.items()],
        )
        conn.executemany(
            """
            INSERT INTO entries (
                id, theme_id, theme, category, subsection, term, lemma,
                article, entry_source, frequency_rank,
                english, english_senses, english_source,
                dictionary_headword, translation_match,
                top5000_headword, top5000_rank, top5000_definition, top5000_senses,
                top5000_part_of_speech, top5000_notes, top5000_disambiguation,
                top5000_match,
                audio_filename, audio_path, audio_available,
                page, position_in_group, form_suffixes
            )
            VALUES (
                :id, :theme_id, :theme, :category, :subsection, :term, :lemma,
                :article, :entry_source, :frequency_rank,
                :english, :english_senses, :english_source,
                :dictionary_headword, :translation_match,
                :top5000_headword, :top5000_rank, :top5000_definition, :top5000_senses,
                :top5000_part_of_speech, :top5000_notes, :top5000_disambiguation,
                :top5000_match,
                :audio_filename, :audio_path, :audio_available,
                :page, :position_in_group, :form_suffixes
            )
            """,
            [
                {
                    **entry,
                    "english_senses": json.dumps(entry["english_senses"], ensure_ascii=False),
                    "top5000_senses": json.dumps(entry["top5000_senses"], ensure_ascii=False),
                    "audio_available": int(entry["audio_available"]),
                    "form_suffixes": json.dumps(entry.get("form_suffixes", []), ensure_ascii=False),
                }
                for entry in entries
            ],
        )


def main() -> None:
    DATA_DIR.mkdir(exist_ok=True)
    entries = extract_entries()
    append_silentshuffle_entries(entries)
    append_spreadsheet_entries(entries)
    add_translations(entries)
    cleanup_copied_audio(entries)
    build_json(entries)
    build_csv(entries)
    build_sqlite(entries)
    matched = sum(1 for entry in entries if entry["translation_match"] != "unmatched")
    audio_count = sum(1 for entry in entries if entry["audio_available"])
    print(f"Built {len(entries)} entries across {len(THEMES)} themes.")
    print(f"Included {sum(1 for entry in entries if entry['entry_source'] == 'top5000')} Top 5000 entries.")
    print(f"Joined English translations for {matched} entries ({matched / len(entries):.1%}).")
    print(f"Linked local audio for {audio_count} entries.")


if __name__ == "__main__":
    main()
