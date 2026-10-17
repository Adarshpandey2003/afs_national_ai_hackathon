import pytest

from afs.retrieval import INDEX_DIR, get_kb, get_retriever
from afs.tools import Toolbox, parse_range_um

pytestmark = pytest.mark.skipif(not (INDEX_DIR / "meta.json").exists(), reason="run kb/build_index.py first")


@pytest.fixture
def tb():
    return Toolbox(get_kb(), get_retriever())


def call(tb, name, **args):
    return next(t for t in tb.tools if t.name == name).invoke(args)


def test_parse_range_units():
    assert parse_range_um("780-2500 nm") == (0.78, 2.5)
    assert parse_range_um("4000–400 cm-1") == (2.5, 25.0)
    assert parse_range_um("3 to 17 µm") == (3.0, 17.0)


def test_silica_cannot_carry_mir(tb):
    out = call(tb, "fiber_check", fiber="Vis-NIR silica", method="MIR ATR")
    assert "NO OVERLAP" in out and "2.5–25 µm" in out


def test_mir_fibers(tb):
    assert "PARTIAL" in call(tb, "fiber_check", fiber="chalcogenide CIR", method="MIR")
    assert "Polycrystalline" in call(tb, "fiber_check", fiber="hollow waveguide", spectral_range="4000-400 cm-1")


def test_silica_matches_both_families_and_explicit_range(tb):
    out = call(tb, "fiber_check", fiber="silica", spectral_range="400-1000 nm")
    assert out.count("covers the full target range") == 2


def test_unknown_fiber_and_rangeless_method(tb):
    assert "Unknown fiber family" in call(tb, "fiber_check", fiber="unobtainium", method="NIR")
    assert "No numeric range" in call(tb, "fiber_check", fiber="silica", method="Raman")


def test_evidence_pack_records_tool_results(tb):
    assert tb.evidence_pages() == {("S01", 6), ("S02", 6)}
    call(tb, "search_kb", query="water content in petroleum ATR probe")
    call(tb, "get_page", source="S01", page=17)
    assert ("S02", 13) in tb.evidence_pages() and ("S01", 17) in tb.evidence_pages()
    assert "[S01 p.17]" in tb.evidence_text()
    assert "Fluorimetry" in call(tb, "method_table", method="fluor")
