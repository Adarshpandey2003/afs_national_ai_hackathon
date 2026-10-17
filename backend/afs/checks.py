"""Deterministic checks run by the critic on every draft (no LLM involved)."""
import re
from functools import lru_cache

from pydantic import BaseModel

from .retrieval import KnowledgeBase
from .schemas import Citation, ReportBody, VerificationCheck
from .tools import normalise_url

UNIT = r"nm|µm|μm|um|cm⁻¹|cm-1|cm\^-1|mm|cm|km|m|°C|K|%|ppm|ppb|mM|µM|μM|nM|mg/L|g/L|dB|ms|s|min|h|Hz|kHz|mW|W|patients|samples"
NUMBER = r"\d{1,3}(?:[  ]\d{3})+|\d+(?:[.,]\d+)?"
QUANTITY = re.compile(rf"(?<![\w.])({NUMBER})(?:\s*(?:-|–|to)\s*({NUMBER}))?\s*({UNIT})(?![\w/])")
SPECTRAL = {"nm": 1e-3, "µm": 1.0, "μm": 1.0, "um": 1.0}
COMBINATION = re.compile(r"\+|\bfusion\b|\bcombin", re.I)  # "NIR + Raman", "data fusion", "combined probe"
METHOD_WORD = re.compile(r"\b(nir|mir|atr|raman|fluorescence|fluorimetry|uv|vis|infrared)\b", re.I)


def _value(raw: str) -> float:
    raw = raw.replace(" ", "").replace(" ", "")
    raw = raw.replace(",", "") if re.fullmatch(r"\d+,\d{3}", raw) else raw.replace(",", ".")
    return float(raw)


def _normalise(v: float, unit: str) -> tuple[float, str] | None:
    """Spectral quantities go to µm so nm, µm and cm⁻¹ compare equal."""
    if unit in SPECTRAL:
        return v * SPECTRAL[unit], "spectral"
    if unit.startswith("cm") and unit != "cm":
        return (1e4 / v, "spectral") if v else None
    return v, unit.replace("μ", "µ")


def quantities(text: str) -> set[tuple[float, str]]:
    """Numbers written directly with a unit (strict; used on the report)."""
    found = set()
    for m in QUANTITY.finditer(text):
        for raw in filter(None, m.group(1, 2)):
            if q := _normalise(_value(raw), m.group(3)):
                found.add((round(q[0], 3), q[1]))
    return found


UNIT_NEAR = re.compile(rf"(?<![A-Za-zµμ])({UNIT})(?![\w/])")  # a unit may follow a digit directly ("19.0%")


def nearby_quantities(text: str, window: int = 60) -> list[tuple[float, str]]:
    """Every number paired with each unit within `window` characters (lenient; used on the sources, where tables
    and figure transcriptions often put the unit in another cell or after a list of values)."""
    found = []
    for m in re.finditer(rf"(?<![\w.])({NUMBER})(?![\w])", text):
        context = text[max(0, m.start() - window):m.end() + window]
        for unit in {u.group(1) for u in UNIT_NEAR.finditer(context)}:
            if q := _normalise(_value(m.group(1)), unit):
                found.append(q)
    return found


def _supported(q: tuple[float, str], allowed: list[tuple[float, str]]) -> bool:
    v, unit = q
    return any(u == unit and abs(a - v) <= 0.01 * max(abs(v), 1e-9) for a, u in allowed)


@lru_cache(maxsize=1)
def _kb_quantities(kb: KnowledgeBase) -> tuple:
    text = "\n".join(p["text"] for p in kb.pages.values())
    text += "\n" + str(kb.methods) + "\n" + str(kb.fibers)
    return tuple(set((round(v, 4), u) for v, u in nearby_quantities(text)))


def _walk(obj):
    """Yield every string and every Citation inside a model."""
    if isinstance(obj, Citation):
        yield obj
    elif isinstance(obj, BaseModel):
        for name in type(obj).model_fields:
            yield from _walk(getattr(obj, name))
    elif isinstance(obj, list):
        for item in obj:
            yield from _walk(item)
    elif isinstance(obj, str):
        yield obj


def citations(report: BaseModel) -> list[Citation]:
    return [x for x in _walk(report) if isinstance(x, Citation)]


def repair_citations(report: BaseModel, kb: KnowledgeBase, record_page) -> list[str]:
    """Fix mechanical citation problems in place, so they don't cost a rewrite:
    - a citation to a real KB page outside the evidence pack: the page is added to the evidence pack
      (the LLM critic still receives its text and judges whether it supports the claim);
    - a citation to a page that does not exist: removed; a 'sourced' claim left without citations becomes 'inference'.
    Returns notes describing what was repaired."""
    notes = []

    def exists(c: Citation) -> bool:
        return c.source.upper() == "EXT" or bool(c.page and kb.get_page(c.source, c.page))

    def fix(obj):
        if isinstance(obj, BaseModel):
            cites = getattr(obj, "citations", None)
            if isinstance(cites, list):
                kept = []
                for c in cites:
                    if not exists(c):
                        notes.append(f"removed {c.label} (no such page)")
                        continue
                    if c.source.upper() != "EXT":
                        record_page(c.source, c.page)
                    kept.append(c)
                obj.citations = kept
                if not kept and getattr(obj, "kind", None) == "sourced":
                    obj.kind = "inference"
            for name in type(obj).model_fields:
                if name != "citations":
                    fix(getattr(obj, name))
        elif isinstance(obj, list):
            for item in obj:
                fix(item)

    fix(report)
    if hasattr(report, "sources"):
        report.sources = [c for c in report.sources if exists(c)]
    return notes


def _plain(text: str) -> str:
    text = text.lower().translate(str.maketrans({"‘": "'", "’": "'", "“": '"', "”": '"', "–": "-", "—": "-"}))
    return re.sub(r"\s+", " ", text).strip(" .\"'")


def quote_found(quote: str, source_text: str) -> bool:
    """True if the quote appears verbatim in the source (case and whitespace aside); an ellipsis may join parts."""
    parts = [_plain(p) for p in re.split(r"\.\.\.|…", quote)]
    return all(p in _plain(source_text) for p in parts if p) and any(parts)


def run_checks(report: ReportBody, kb: KnowledgeBase, evidence_pages: set[tuple[str, int]],
               client_text: str, n_premises: int, external: dict[str, str] | None = None) -> list[VerificationCheck]:
    """`external`: normalised url -> abstract of every paper search_papers returned in this run."""
    checks, external = [], external or {}

    bad = []
    for c in citations(report):
        if c.source.upper() == "EXT":
            abstract = external.get(normalise_url(c.url or ""))
            if not (c.url and c.quote):
                bad.append(f"{c.label} (external citation needs url and quoted passage)")
            elif abstract is None:
                bad.append(f"{c.label} (external source was not retrieved in this run)")
            elif not quote_found(c.quote, abstract):
                bad.append(f"{c.label} (quote not found verbatim in the retrieved abstract)")
        elif not c.page or not kb.get_page(c.source, c.page):
            bad.append(f"{c.label} (no such page)")
        elif (c.source.upper(), c.page) not in evidence_pages:
            bad.append(f"{c.label} (not in the retrieved evidence)")
    checks.append(VerificationCheck(name="citations_valid", passed=not bad,
                                    details="; ".join(sorted(set(bad))) or "All citations point to retrieved evidence pages."))

    texts = "\n".join(x for x in _walk(report) if isinstance(x, str))
    allowed = list(_kb_quantities(kb)) + nearby_quantities(client_text + "\n" + "\n".join(external.values()))
    unsupported = sorted({f"{v:g} {u}" for v, u in quantities(texts) if not _supported((v, u), allowed)})
    checks.append(VerificationCheck(
        name="numbers_supported", passed=not unsupported,
        details=("Numbers not found in the sources or the client's text: " + ", ".join(unsupported))
        if unsupported else "Every number with a unit appears in the sources or the client's text."))

    missing = [name for name, ok in [
        ("clarification_questions", report.clarification_questions),
        ("recommendations", report.recommendations),
        ("risks", report.risks),
        ("feasibility_plan.steps (at least 2)", len(report.feasibility_plan.steps) >= 2),
        ("sources", report.sources),
    ] if not ok]
    checks.append(VerificationCheck(name="sections_complete", passed=not missing,
                                    details=("Missing: " + ", ".join(missing)) if missing else "All sections present."))

    got = len(report.requirements.client_premises)
    checks.append(VerificationCheck(
        name="premises_addressed", passed=got >= n_premises,
        details=f"{got} of {n_premises} client premise(s) given an explicit verdict."))

    # "As simple as possible, as complicated as necessary": a combination is a hypothesis to test against the best
    # single method, not the primary recommendation, unless the client itself asked to evaluate that combination.
    def requested(method: str) -> bool:  # the client named every method in the combination
        words = {w.lower() for w in METHOD_WORD.findall(method)}
        return bool(words) and all(re.search(rf"\b{w}\b", client_text, re.I) for w in words)

    combined = [m.method for m in report.recommendations
                if m.role == "primary" and COMBINATION.search(m.method) and not requested(m.method)]
    checks.append(VerificationCheck(
        name="simplest_first", passed=not combined,
        details=(f"Primary recommendation is a combination ({'; '.join(combined)}): make the best single method "
                 "primary and give the combination the role 'combination'") if combined
        else "Every primary recommendation is a single method."))
    return checks
