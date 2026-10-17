"""Research tools. A Toolbox is created per assessment and records every page its tools return:
that record is the evidence pack the writer may cite and the critic checks citations against."""
import os
import re

import httpx
from langchain_core.tools import tool

from .retrieval import KnowledgeBase, HybridRetriever

# Always part of the evidence: S01 Table 1 (method comparison) and S02 p.6 (fiber transmission ranges).
ALWAYS_INCLUDED = [("S01", 6), ("S02", 6)]
SPECTRAL_UNITS = {"nm": 1e-3, "µm": 1.0, "μm": 1.0, "um": 1.0}
OPENALEX_URL = "https://api.openalex.org/works"


def web_search_enabled() -> bool:
    return os.environ.get("WEB_SEARCH", "on").strip().lower() not in ("off", "0", "false", "no")


def normalise_url(url: str) -> str:
    return re.sub(r"^https?://", "", (url or "").strip().lower()).rstrip("/")


def _abstract(inverted: dict | None) -> str:
    """OpenAlex stores abstracts as {word: [positions]}; rebuild the text."""
    words = sorted((pos, word) for word, positions in (inverted or {}).items() for pos in positions)
    return " ".join(word for _, word in words)


def to_um(value: float, unit: str) -> float:
    unit = unit.strip()
    if unit in SPECTRAL_UNITS:
        return value * SPECTRAL_UNITS[unit]
    return 1e4 / value  # wavenumber, cm⁻¹


def parse_range_um(text: str) -> tuple[float, float] | None:
    """'780-2500 nm' -> (0.78, 2.5); '4000-400 cm-1' -> (2.5, 25.0)."""
    m = re.search(r"(\d+(?:\.\d+)?)\s*(?:-|–|to)\s*(\d+(?:\.\d+)?)\s*(nm|µm|μm|um|cm⁻¹|cm-1|cm\^-1|1/cm)", text)
    if not m:
        return None
    lo, hi = sorted(to_um(float(m.group(i)), m.group(3)) for i in (1, 2))
    return round(lo, 4), round(hi, 4)


def _words(text: str) -> set[str]:
    text = text.lower()
    for long, short in (("mid-infrared", "mir"), ("mid infrared", "mir"), ("mid-ir", "mir"),
                        ("near-infrared", "nir"), ("near infrared", "nir"), ("near-ir", "nir")):
        text = text.replace(long, short)
    return set(re.findall(r"[a-z0-9]+", text)) - {"fiber", "fibers", "fibre", "fibres", "cable", "link", "and", "the"}


class Toolbox:
    def __init__(self, kb: KnowledgeBase, retriever: HybridRetriever):
        self.kb, self.retriever = kb, retriever
        self.evidence: dict[tuple[str, int], dict] = {}
        for source, page in ALWAYS_INCLUDED:
            self._record_page(source, page)
        # External papers found by search_papers: normalised url -> {label, title, year, url, abstract}
        self.external: dict[str, dict] = {}
        self.tools = [self._search_kb(), self._get_page(), self._method_table(), self._fiber_check()]
        if web_search_enabled():
            self.tools.append(self._search_papers())

    # ------------------------------------------------------------ evidence pack

    def _entry(self, source: str, page: int) -> dict:
        p = self.kb.get_page(source, page)
        return self.evidence.setdefault((source, page), {
            "label": p["label"], "evidence_level": p["evidence_level"], "full_page": False, "chunks": {}})

    def _record_page(self, source: str, page: int) -> None:
        self._entry(source, page)["full_page"] = True

    def record_page(self, source : str, page: int)-> None:
        """Add a whole page to the evidence pack (used when the writer cites a real page the tools didn't return)."""
        self._record_page(source.upper(), page)

    def _record_chunk(self, chunk: dict) -> None:
        self._entry(chunk["source"], chunk["page"])["chunks"][chunk["chunk_id"]] = chunk["text"]

    def evidence_text(self, only: set[str] | None = None) -> str:
        """Evidence pack for prompts: full page text where a page was read, otherwise the retrieved chunks.
        `only`: labels to include ("S01 p.10", "EXT: Gertz 2020"); the always-included pages are always kept."""
        blocks = []
        for (source, page), e in sorted(self.evidence.items()):
            if only is not None and e["label"] not in only and (source, page) not in ALWAYS_INCLUDED:
                continue
            text = self.kb.get_page(source, page)["text"] if e["full_page"] else "\n[...]\n".join(e["chunks"].values())
            scope = self.kb.sources[source]["scope_note"]
            blocks.append(f"=== [{e['label']}] evidence level: {e['evidence_level']} ({scope})\n{text}")
        for e in self.external.values():
            if only is not None and f"EXT: {e['label']}" not in only:
                continue
            blocks.append(f"=== [EXT: {e['label']}] external research abstract, weaker evidence than AFS material\n"
                          f"url: {e['url']}\n{e['title']} ({e['year']})\n{e['abstract']}")
        return "\n\n".join(blocks)

    def external_abstracts(self) -> dict[str, str]:
        """Normalised url -> abstract text, for verifying external quotes."""
        return {url: e["abstract"] for url, e in self.external.items()}

    def evidence_pages(self) -> set[tuple[str, int]]:
        return set(self.evidence)

    # ------------------------------------------------------------ tools

    def _search_kb(self):
        @tool
        def search_kb(query: str, sources: list[str] | None = None) -> str:
            """Hybrid (semantic + keyword) search over the AFS knowledge base. Returns the 5 best page excerpts
            with their citation labels. Optionally restrict to sources, e.g. ["S01", "S02"].
            S01 vendor overview of methods and applications, S02 vendor slides (fibers, probes, applications),
            S03 LED kidney tumour study (in vitro), S04 MIR-ATR + fluorescence combined probe (lab), S05/S06 business,
            plus any later-added sources (S07 onwards, e.g. AFS expert notes) listed in the task."""
            hits = self.retriever.search(query, k=5, sources=sources)
            for h in hits:
                self._record_chunk(h)
            return "\n\n".join(f"[{h['label']}] ({h['evidence_level']})\n{h['text']}" for h in hits) or "No results."
        return search_kb

    def _get_page(self):
        @tool
        def get_page(source: str, page: int) -> str:
            """Read the full text of one source page, e.g. source="S01", page=10, to check context and scope
            before relying on it."""
            p = self.kb.get_page(source, page)
            if not p:
                return f"No page {source} p.{page}."
            self._record_page(p["source"], p["page"])
            scope = self.kb.sources[p["source"]]["scope_note"]
            return f"[{p['label']}] {p['title']}\nEvidence level: {p['evidence_level']}. {scope}\n\n{p['text']}"
        return get_page

    def _method_table(self):
        @tool
        def method_table(method: str = "", sample_type: str = "") -> str:
            """S01 Table 1 (cite as "S01 Table 1 (p.6)"): measurement techniques per method with sample type,
            optical path or depth and qualitative sensitivity, selectivity and cost; plus the method overview
            (nominal ranges, typical samples, main limitations). Filter by method and/or sample type, or leave
            both empty for everything."""
            self._record_page("S01", 6)
            rows = [r for r in self.kb.methods["table1"]["rows"]
                    if method.lower() in r["method"].lower() and sample_type.lower() in r["sample_type"].lower()]
            lines = ["S01 Table 1 (p.6): method | technique | phenomenon | sample | path/depth | sensitivity | selectivity | cost"]
            lines += [" | ".join(r[k] for k in ("method", "measurement_technique", "physical_phenomenon", "sample_type",
                                                "optical_path_or_depth", "sensitivity", "selectivity", "cost"))
                      for r in rows] or ["(no Table 1 rows match)"]
            lines.append("\nMethod overview (compiled from the sources; see the 'read' pages):")
            for m in self.kb.methods["method_overview"]["rows"]:
                if not method or _words(method) & _words(m["method"]):
                    lines.append(f"- {m['method']}: nominal range {m['nominal_range']}; samples/geometry: "
                                 f"{m['typical_samples_and_geometry']}; limitations: {m['main_limitations']}; read {m['read']}")
            return "\n".join(lines)
        return method_table

    def _fiber_check(self):
        @tool
        def fiber_check(fiber: str, method: str = "", spectral_range: str = "") -> str:
            """Check whether a fiber family transmits the spectral range a method needs (S02 p.6 fiber ranges).
            fiber: e.g. "Vis-NIR silica", "UV-Vis silica", "silica", "chalcogenide CIR", "PIR", "hollow waveguide".
            Give either method ("NIR", "MIR") or spectral_range (e.g. "4000-400 cm-1", "780-2500 nm", "2.5-25 um")."""
            self._record_page("S02", 6)
            fibers = self.kb.fibers["fibers"]
            wanted = _words(fiber)
            matched = [f for f in fibers if wanted and all(any(w.startswith(q) for w in _words(f["fiber_type"]))
                                                           for q in wanted)]
            if not matched:
                return "Unknown fiber family. Known families: " + "; ".join(f["fiber_type"] for f in fibers)

            target, origin = parse_range_um(spectral_range), "given range"
            if not target and method:
                rows = [m for m in self.kb.methods["method_overview"]["rows"]
                        if m["range_um"] and _words(method) & _words(m["method"])]
                if rows:
                    target = tuple(rows[0]["range_um"])
                    origin = f"{rows[0]['method']} nominal range {rows[0]['nominal_range']} [read {rows[0]['read']}]"
            if not target:
                return ("No numeric range for this method in the sources (only NIR and MIR have one). "
                        "Pass spectral_range explicitly, e.g. '780-2500 nm'.")

            lo, hi = target
            lines = [f"Target: {lo:g}–{hi:g} µm ({origin}). Fiber ranges are approximate, read from the S02 p.6 figure "
                     "[S02 p.6]; the usable range of a real cable, length and probe must be confirmed by AFS."]
            for f in matched:
                o_lo, o_hi = max(lo, f["min_um"]), min(hi, f["max_um"])
                if o_hi <= o_lo:
                    verdict = "NO OVERLAP: this fiber cannot transmit the target range"
                elif f["min_um"] <= lo and f["max_um"] >= hi:
                    verdict = "covers the full target range"
                else:
                    verdict = f"PARTIAL: covers only {o_lo:g}–{o_hi:g} µm of the target"
                lines.append(f"- {f['fiber_type']} ({f['range_text']}): {verdict}")
            covering = [f["fiber_type"] for f in fibers if f["min_um"] < hi and f["max_um"] > lo]
            lines.append("Fiber families overlapping the target at least partly: " + "; ".join(covering))
            return "\n".join(lines)
        return fiber_check

    def _search_papers(self):
        @tool
        def search_papers(query: str) -> str:
            """Search peer-reviewed research papers (OpenAlex; abstracts only). Use ONLY for points the AFS knowledge
            base does not cover, and at most twice. Results are external evidence, weaker than AFS material; a claim
            based on one must quote a sentence of the abstract verbatim and give the paper's url."""
            try:
                r = httpx.get(OPENALEX_URL, timeout=20, params={
                    "search": query, "per-page": 4, "filter": "has_abstract:true",
                    "select": "id,doi,title,publication_year,abstract_inverted_index,authorships"})
                r.raise_for_status()
            except httpx.HTTPError as exc:
                return f"Paper search unavailable ({exc.__class__.__name__}); continue with the AFS sources."
            results = []
            for w in r.json().get("results", []):
                abstract = _abstract(w.get("abstract_inverted_index"))
                if not abstract:
                    continue
                url = w.get("doi") or w["id"]
                authors = w.get("authorships") or [{}]
                surname = ((authors[0].get("author") or {}).get("display_name") or "Anon").split()[-1]
                label = f"{surname} {w.get('publication_year')}"
                self.external[normalise_url(url)] = {"label": label, "title": w.get("title") or "", "url": url,
                                                     "year": w.get("publication_year"), "abstract": abstract}
                results.append(f"[EXT: {label}] {w.get('title')} ({w.get('publication_year')})\nurl: {url}\n"
                               f"abstract: {abstract}")
            return "\n\n".join(results) or "No papers found."
        return search_papers
