"""Knowledge base and retrieval regression tests. Run from backend/: python -m pytest tests -q"""
import pytest

from afs.retrieval import INDEX_DIR, get_kb, get_retriever


def test_sources_and_cases_present():
    kb = get_kb()
    assert {"S01", "S02", "S03", "S04", "S05", "S06"} <= set(kb.sources)  # more can be added later
    ids = [c["case_id"] for c in kb.cases["cases"]]
    assert ids == [f"D0{i}" for i in range(1, 9)] + [f"H0{i}" for i in range(1, 7)]


def test_every_image_slide_was_transcribed():
    kb = get_kb()
    for sid in ("S02", "S05"):
        for page in range(1, kb.sources[sid]["pages"] + 1):
            assert kb.get_page(sid, page)["origin"] == "vision_ocr", f"{sid} p.{page}"


def test_table1_uses_clean_transcription():
    page = get_kb().get_page("S01", 6)
    assert page["origin"] == "table_transcription"
    assert "Fluorimetry | fluorimetric probe" in page["text"]


def test_fiber_ranges_in_micrometres():
    fibers = {f["fiber_type"]: f for f in get_kb().fibers["fibers"]}
    silica = fibers["Standard and Al/Cu-coated Vis-NIR silica fibers"]
    assert (silica["min_um"], silica["max_um"]) == (0.35, 2.4)
    mir = next(m for m in get_kb().methods["method_overview"]["rows"] if m["method"].startswith("MIR"))
    assert mir["range_um"] == [2.5, 25.0]


def test_reference_lists_are_not_indexed():
    assert not [c for c in get_kb().chunks if c["source"] == "S03" and c["page"] in (16, 17)]


needs_index = pytest.mark.skipif(not (INDEX_DIR / "meta.json").exists(),
                                 reason="run kb/build_index.py first")


@needs_index
@pytest.mark.parametrize("query, expected", [
    ("can a silica fiber transmit mid-infrared for MIR ATR", "S02 p.6"),
    ("most chemicals do not fluoresce fluorescence selectivity", "S01 p.5"),
    ("fluorescence targets NADH tryptophan riboflavin bioprocess", "S01 p.16"),
    ("water content in petroleum ATR probe", "S02 p.13"),
    ("whey transmission transflection clear liquid turbidity", "S01 p.18"),
    ("LED NIR sensor kidney tumor in vitro samples patients", "S03 p.1"),
    ("NIR and Raman blend potency tablet press feed frame", "S01 p.15"),
])
def test_hybrid_search_finds_key_page(query, expected):
    labels = [hit["label"] for hit in get_retriever().search(query, k=5)]
    assert expected in labels, labels


@needs_index
def test_search_source_filter():
    hits = get_retriever().search("fiber probe", k=5, sources=["S04"])
    assert hits and all(h["source"] == "S04" for h in hits)
