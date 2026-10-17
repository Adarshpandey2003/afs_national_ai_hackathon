from afs.checks import quantities, run_checks
from afs.retrieval import get_kb
from afs.schemas import ReportBody

CITE = {"source": "S02", "page": 6, "label": "S02 p.6"}


def report(**overrides) -> ReportBody:
    claim = {"text": "Vis-NIR silica transmits 350–2400 nm.", "kind": "sourced", "citations": [CITE]}
    body = {
        "decision_status": "provisional", "decision_rationale": "r", "summary": "s",
        "requirements": {"stated_facts": [], "key_unknowns": [], "client_premises": [
            {"statement": "p", "verdict": "refuted", "explanation": "e", "citations": [CITE]}]},
        "clarification_questions": [{"question_id": "q1", "text": "?", "priority": 1, "why_it_matters": "w",
                                     "affects": "method"}],
        "assumptions": [], "recommendations": [{"method": "MIR", "technique": "ATR", "role": "primary",
                                                "rationale": [claim]}],
        "measurement_concept": {"probe_geometry": [], "location": [], "fiber_link": []},
        "spectral_ranges": [], "risks": [claim],
        "feasibility_plan": {"objective": "o", "samples": [], "reference_measurements": [], "comparison": "c",
                             "go_no_go": "g", "steps": [{"order": 1, "title": "a", "description": "d"},
                                                        {"order": 2, "title": "b", "description": "d"}]},
        "sources": [CITE],
    }
    body.update(overrides)
    return ReportBody.model_validate(body)


def checks_by_name(r: ReportBody, evidence=frozenset({("S02", 6)}), premises=1, client="", external=None):
    return {c.name: c for c in run_checks(r, get_kb(), set(evidence), client, premises, external)}


def test_quantities_normalise_spectral_units():
    assert (2.5, "spectral") in quantities("4000 cm-1") and (2.5, "spectral") in quantities("2500 nm")
    assert quantities("1,3 µm") == {(1.3, "spectral")}


def test_clean_report_passes():
    assert all(c.passed for c in checks_by_name(report()).values())


def test_citation_outside_evidence_or_missing_page_fails():
    r = report(sources=[CITE, {"source": "S01", "page": 10, "label": "S01 p.10"},
                        {"source": "S01", "page": 99, "label": "S01 p.99"}])
    details = checks_by_name(r)["citations_valid"].details
    assert "S01 p.10 (not in the retrieved evidence)" in details and "S01 p.99 (no such page)" in details


def test_invented_number_fails_but_client_number_passes():
    claim = {"text": "Expect a detection limit of 37 ppm.", "kind": "inference", "citations": []}
    assert not checks_by_name(report(risks=[claim]))["numbers_supported"].passed
    assert checks_by_name(report(risks=[claim]), client="water around 37 ppm")["numbers_supported"].passed


def test_missing_sections_and_premises():
    c = checks_by_name(report(recommendations=[]), premises=3)
    assert not c["sections_complete"].passed and not c["premises_addressed"].passed

from afs.checks import repair_citations


def test_repair_adds_real_pages_and_drops_missing_ones():
    real = {"source": "S01", "page": 17, "label": "S01 p.17"}
    fake = {"source": "S01", "page": 99, "label": "S01 p.99"}
    claim = {"text": "x", "kind": "sourced", "citations": [fake]}
    r = report(risks=[claim], sources=[CITE, real, fake],
               recommendations=[{"method": "NIR", "technique": "t", "role": "primary",
                                 "rationale": [{"text": "y", "kind": "sourced", "citations": [real]}]}])
    evidence = {("S02", 6)}
    notes = repair_citations(r, get_kb(), lambda s, p: evidence.add((s.upper(), p)))

    assert ("S01", 17) in evidence                                   # real page added
    assert r.risks[0].citations == [] and r.risks[0].kind == "inference"  # fake removed, claim downgraded
    assert [c.label for c in r.sources] == ["S02 p.6", "S01 p.17"]
    assert any("S01 p.99" in n for n in notes)
    assert checks_by_name(r, evidence=evidence)["citations_valid"].passed


def test_external_quote_must_be_verbatim_from_a_retrieved_abstract():
    abstract = "Raman spectroscopy combined with chemometrics tracked the oxidation of edible oils during frying at 180 °C."
    fetched = {"doi.org/10.1/x": abstract}

    def with_quote(quote, url="https://doi.org/10.1/x"):
        cite = {"source": "EXT", "page": None, "label": "Liu 2025", "url": url, "quote": quote}
        return report(risks=[{"text": "External literature: Raman tracked oil oxidation.", "kind": "sourced",
                              "citations": [cite]}])

    real = with_quote("Raman spectroscopy combined with chemometrics tracked the oxidation of edible oils")
    assert checks_by_name(real, external=fetched)["citations_valid"].passed
    assert checks_by_name(with_quote("Raman spectroscopy ... the oxidation of edible oils"), external=fetched)["citations_valid"].passed

    invented = checks_by_name(with_quote("Raman detected oxidation at 2 ppm"), external=fetched)["citations_valid"]
    assert not invented.passed and "not found verbatim" in invented.details
    unknown = checks_by_name(with_quote("anything", url="https://doi.org/10.9/other"), external=fetched)["citations_valid"]
    assert not unknown.passed and "not retrieved" in unknown.details

    claim = {"text": "Frying at 180 °C oxidises oil.", "kind": "inference", "citations": []}
    assert checks_by_name(report(risks=[claim]), external=fetched)["numbers_supported"].passed  # number from the abstract


def test_citations_can_be_written_as_labels():
    from afs.schemas import Citation
    assert Citation.model_validate("S01 p.10").model_dump(exclude_none=True) == {"source": "S01", "page": 10, "label": "S01 p.10"}
    assert Citation.model_validate("S01 Table 1 (p.6)").page == 6
    assert Citation.model_validate("S12 p.3").source == "S12"
    ext = {"source": "EXT", "page": None, "label": "Gertz 2020", "url": "https://doi.org/x", "quote": "q"}
    assert Citation.model_validate(ext).url == "https://doi.org/x"
    r = report(risks=[{"text": "t", "kind": "sourced", "citations": ["S02 p.6"]}])
    assert r.risks[0].citations[0].source == "S02" and checks_by_name(r)["citations_valid"].passed


def test_primary_recommendation_must_be_a_single_method():
    def rec(method, role):
        return {"method": method, "technique": "t", "role": role,
                "rationale": [{"text": "y", "kind": "sourced", "citations": [CITE]}]}
    ok = report(recommendations=[rec("NIR", "primary"), rec("NIR + fluorescence", "combination")])
    assert checks_by_name(ok)["simplest_first"].passed
    bad = report(recommendations=[rec("NIR + fluorescence (data fusion)", "primary"), rec("Raman", "comparison")])
    assert not checks_by_name(bad)["simplest_first"].passed


def test_combination_primary_allowed_when_the_client_asked_for_it():
    rec = {"method": "MIR ATR + fluorescence combined probe", "technique": "t", "role": "primary",
           "rationale": [{"text": "y", "kind": "sourced", "citations": [CITE]}]}
    r = report(recommendations=[rec])
    assert checks_by_name(r, client="We want to compare MIR ATR and fluorescence information")["simplest_first"].passed
    assert not checks_by_name(r, client="We want to monitor glucose with our fluorescence spectrometer")["simplest_first"].passed
