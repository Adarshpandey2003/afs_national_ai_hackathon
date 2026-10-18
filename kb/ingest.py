"""Add one document to the knowledge base incrementally: new source ID, pages, chunks, and embeddings for the new
chunks only. Works without the other raw files (e.g. on a deployed server). Used by POST /kb/documents.

Usage (from the repo root, with the backend venv):
    python kb/ingest.py notes.md --title "AFS notes: beer fermentation trials" --evidence-level expert_notes
    python kb/ingest.py paper.pdf --title "..." --evidence-level research_lab_note --ocr figures
    python kb/ingest.py --remove S07        # remove a document added earlier (S01-S06 are protected)
"""
import argparse
import json
import re
import shutil
import sys
from pathlib import Path

import yaml

KB_DIR = Path(__file__).resolve().parent
sys.path.insert(0, str(KB_DIR))
sys.path.insert(0, str(KB_DIR.parent / "backend"))

from build_kb import RAW_DIR, SOURCES_FILE, load_sources, source_records  # noqa: E402
from afs.retrieval import INDEX_DIR, add_to_index, remove_from_index  # noqa: E402

SUFFIXES = {".pdf", ".txt", ".md"}
SUPPLIED = {"S01", "S02", "S03", "S04", "S05", "S06"}  # the challenge's AFS materials: never removed
EVIDENCE_LEVELS = ["expert_notes", "vendor_overview", "vendor_slides", "research_lab_note",
                   "research_in_vitro_poc", "business_context"]
DEFAULT_SCOPE = {
    "expert_notes": "Internal AFS expert notes or project experience. Practical knowledge, not peer-reviewed or "
                    "validated performance data for a new customer.",
}


def add_document(path: Path, title: str, evidence_level: str = "expert_notes", scope_note: str = "",
                 ocr: str = "none", description: str = "") -> dict:
    """Ingest one file and return its entry as written to sources.json."""
    path = Path(path)
    if path.suffix.lower() not in SUFFIXES:
        raise ValueError(f"Unsupported file type {path.suffix}; use one of {sorted(SUFFIXES)}")
    if evidence_level not in EVIDENCE_LEVELS:
        raise ValueError(f"evidence_level must be one of {EVIDENCE_LEVELS}")
    if not (INDEX_DIR / "meta.json").exists():
        raise RuntimeError("No search index yet: run kb/build_index.py first")

    sid = _next_source_id()
    src = {"source_id": sid, "file": f"{sid}_{path.name}", "title": title.strip(), "evidence_level": evidence_level,
           "ocr": ocr, "scope_note": scope_note.strip() or DEFAULT_SCOPE.get(
               evidence_level, f"Added document ({evidence_level}); check its scope before relying on it."),
           "description": description.strip()}
    RAW_DIR.mkdir(exist_ok=True)
    shutil.copyfile(path, RAW_DIR / src["file"])

    pages, chunks = source_records(src)
    if not chunks:
        (RAW_DIR / src["file"]).unlink()
        raise ValueError("No text could be extracted from the document")

    with open(SOURCES_FILE, "a", encoding="utf-8") as f:
        f.write("\n" + yaml.safe_dump([{k: v for k, v in src.items() if v}], allow_unicode=True, sort_keys=False))
    for name, records in (("pages.jsonl", pages), ("chunks.jsonl", chunks)):
        with open(KB_DIR / name, "a", encoding="utf-8") as f:
            f.writelines(json.dumps(r, ensure_ascii=False) + "\n" for r in records)
    entry = {**src, "pages": len(pages)}
    sources = json.loads((KB_DIR / "sources.json").read_text(encoding="utf-8")) + [entry]
    (KB_DIR / "sources.json").write_text(json.dumps(sources, ensure_ascii=False, indent=2), encoding="utf-8")

    add_to_index(chunks)
    return entry


def _next_source_id() -> str:
    """Next free ID. sources.yaml keeps a "# removed: S07" line for removed documents, so an ID is never reused and
    an old report's citation can never point at a different document."""
    used = [int(n) for n in re.findall(r"\bS(\d+)\b", SOURCES_FILE.read_text(encoding="utf-8"))]
    return f"S{max(used) + 1:02d}"


def remove_document(source_id: str) -> dict:
    """Remove a document added earlier: its sources.yaml entry, pages, chunks, index vectors, raw file and OCR cache.
    Returns the removed entry. The supplied AFS materials (S01-S06) cannot be removed."""
    sid = source_id.strip().upper()
    if sid in SUPPLIED:
        raise PermissionError(f"{sid} is one of the supplied AFS materials and cannot be removed")
    sources = json.loads((KB_DIR / "sources.json").read_text(encoding="utf-8"))
    entry = next((s for s in sources if s["source_id"] == sid), None)
    if entry is None:
        raise LookupError(f"No source {sid} in the knowledge base")

    # sources.yaml: replace the entry's block with a one-line tombstone, keeping the hand-written comments intact
    text = SOURCES_FILE.read_text(encoding="utf-8")
    text = re.sub(rf"^- source_id: {sid}\n(?:[ \t]+\S.*(?:\n|$))*", f"# removed: {sid} ({entry['title']})\n",
                  text, flags=re.M)
    SOURCES_FILE.write_text(text, encoding="utf-8")

    removed_chunks = set()
    for name in ("pages.jsonl", "chunks.jsonl"):
        path = KB_DIR / name
        kept = []
        for line in path.read_text(encoding="utf-8").splitlines():
            record = json.loads(line) if line.strip() else None
            if record and record["source"] == sid:
                removed_chunks.add(record.get("chunk_id"))
            elif record:
                kept.append(line)
        path.write_text("\n".join(kept) + "\n", encoding="utf-8")
    (KB_DIR / "sources.json").write_text(json.dumps([s for s in sources if s["source_id"] != sid],
                                                    ensure_ascii=False, indent=2), encoding="utf-8")
    remove_from_index(removed_chunks - {None})

    (RAW_DIR / entry["file"]).unlink(missing_ok=True)
    for cached in (KB_DIR / "ocr_cache").glob(f"{sid}_p*"):
        cached.unlink()
    return entry


if __name__ == "__main__":
    sys.stdout.reconfigure(encoding="utf-8")
    parser = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    parser.add_argument("file", type=Path, nargs="?")
    parser.add_argument("--title")
    parser.add_argument("--remove", metavar="SOURCE_ID", help="remove a document added earlier, e.g. S07")
    parser.add_argument("--evidence-level", default="expert_notes", choices=EVIDENCE_LEVELS)
    parser.add_argument("--scope-note", default="")
    parser.add_argument("--ocr", default="none", choices=["none", "figures", "slides"])
    parser.add_argument("--description", default="")
    a = parser.parse_args()
    if a.remove:
        e = remove_document(a.remove)
        print(f"removed {e['source_id']}: {e['title']}")
        sys.exit()
    if not (a.file and a.title):
        parser.error("give a file and --title to add a document, or --remove SOURCE_ID")
    e = add_document(a.file, a.title, a.evidence_level, a.scope_note, a.ocr, a.description)
    print(f"added {e['source_id']} ({e['pages']} page(s)): {e['title']}")
