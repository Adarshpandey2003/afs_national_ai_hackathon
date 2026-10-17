"""Agent 3: writer + critic. The writer turns intake, research notes and the evidence pack into the structured
report; the critic runs deterministic checks plus an LLM review against the brief, and the writer revises."""
import json
import re
from functools import lru_cache
from typing import Literal

from pydantic import BaseModel

from ..checks import citations, run_checks, repair_citations
from ..llm import ask_json
from ..retrieval import KnowledgeBase
from ..schemas import ReportBody, VerificationCheck
from ..tools import Toolbox, normalise_url

WRITER_SYSTEM = """You are the writer of an assistant that helps Art Fiber Systems (AFS) experts make a first technical
assessment of a customer's in-line spectroscopy enquiry. You write the structured assessment an expert will review.

Rules:
- Client facts, sourced claims, inferences and assumptions are kept visibly separate. Claim.kind: "fact" = the client
  said it; "sourced" = an evidence page states it (citation required); "inference" = your reasoning from cited
  evidence; "assumption" = not known, assumed for planning.
- Cite only pages that appear in the EVIDENCE section, written as the plain label string: "S01 p.10"; cite
  S01 Table 1 as "S01 Table 1 (p.6)". Leave "sources" as an empty list: it is filled from your citations.
  A citation must support the claim
  at the stated scope: a laboratory study is not proof of process readiness, an in vitro study is not proof of
  clinical use, a vendor example is a reason to test a method, not proof it will work for this client.
- External research abstracts in EVIDENCE (marked EXT) may be cited only for points no AFS page covers, as
  {"source": "EXT", "page": null, "label": "<label after EXT:>", "url": "<its url>", "quote": "<a passage copied
  word for word from that abstract>"}. Say in the claim that it comes from external literature; it is weaker
  evidence than AFS material and never overrides it.
- Never invent spectra, results, accuracy, detection limits, response times, fiber lengths, ratings, product codes,
  prices, or client data. Every number with a unit must come from the evidence or the client.
- client_premises: give EVERY premise from the intake an explicit verdict (supported / refuted / unverified) with the
  reason and citations. Do not accept a premise just because the client states it.
- decision_status, decided in this order:
  1. "outside_supported_scope" if the request itself asks for something the sources cannot give: approval of a
     configuration, proof, guaranteed performance, or clinical / final readiness beyond the evidence's scope;
  2. otherwise "insufficient_information" if the facts cannot yet justify any method choice (e.g. the target
     variable or analyte is undefined): give the deciding questions and a scoping experiment, not a configuration;
  3. otherwise "provisional": a method or a corrected concept is worth testing. A refuted client premise alone does
     not make a case out of scope or insufficient.
  In every case still say what can be done next.
- When a client premise is refuted, add a corrected concept worth testing as a recommendation and say what changes.
- recommendations follow "as simple as possible, as complicated as necessary": the primary recommendation is the
  simplest, least costly method expected to meet the requirement (weigh the S01 Table 1 sensitivity, selectivity and
  cost ratings and the application evidence); other plausible methods are "comparison". Use "combination" (data
  fusion) only where one method is likely insufficient (e.g. overlapping signals, heterogeneous or multicomponent
  samples, several target variables), as a hypothesis to test against the best single method. Use
  "not_recommended" for approaches the client proposed or that seem obvious but the evidence does not support.
- spectral_ranges: correct units; a nominal method range is not the usable range of a specific instrument, fiber or
  probe. For Raman state the excitation wavelength separately from the Raman shift.
- clarification_questions: the open questions, priority 1 first (start from the intake; drop answered ones).
- feasibility_plan steps follow the AFS route from diagnosis to in-line control, scaled to the case:
  1. lab screening of a few representative samples (several candidate methods where useful) to establish the usable
     spectral range, the resolution needed and the concentration level (trace ppm or major %);
  2. a chemometric model (calibration or classification; data fusion if several methods) against a named
     independent reference method (e.g. chromatography, mass spectrometry, titration, laboratory assay, histology);
  3. an in-line / in-situ trial at the real measurement point against timed reference samples, checking robustness
     to the process's physical variation;
  4. outlook: if the model works, the key wavelengths a simpler dedicated multi-wavelength sensor could use.
  No invented sample counts or acceptance numbers; the go / no-go basis is agreed with the client. If the request is
  outside the supported scope, plan only the steps the evidence justifies.
- Be concise. A short, well-founded answer beats a long, assertive one. At most 6 clarification questions,
  4 recommendations, 5 risks and 5 feasibility steps; 1 to 2 sentences per claim; one or two citations per claim.

The answer guidelines and two worked examples from the organisers follow. They are prose; your output is JSON."""

CRITIC_SYSTEM = """You review a draft first technical assessment of a customer's in-line spectroscopy enquiry, written
for an Art Fiber Systems expert. Judge it like the challenge jury:
technical quality (reasonable for the case), grounding in the supplied AFS sources, a practical first feasibility plan,
good clarification questions and honest uncertainty, and traceable reasoning.

Check in particular:
1. Each cited page actually supports its claim at the stated scope (cited page texts are provided).
2. No invented specifications, performance figures, client facts or answers.
3. Every client premise has a correct verdict; nothing the client proposed is accepted without evidence.
4. decision_status fits the facts, in this order: outside_supported_scope only if the request itself (approval,
   proof, guaranteed performance, clinical / final readiness) cannot be given; else insufficient_information if no
   method choice is justified yet; else provisional. A refuted premise alone is not a reason for either.
5. Questions are prioritised, specific and would change the method, setup or plan.
6. The feasibility plan is practical and staged: lab screening of a few samples, a chemometric model against a named
   independent reference method, an in-line / in-situ trial where applicable, and a go / no-go basis.
7. The primary recommendation is the simplest adequate method; a combination is justified, not added by default;
   a refuted client premise comes with a corrected concept.
Use severity "error" only for problems that make the assessment wrong, ungrounded or unsafe to send to the expert;
use "warning" for improvements. Report at most 6 issues, most important first, one sentence each.
passed = true when there is no error."""


class CriticIssue(BaseModel):
    check: str
    severity: Literal["error", "warning"]
    message: str


class Critique(BaseModel):
    passed: bool
    issues: list[CriticIssue]


def write_report(enquiry: str, intake, answers: list[dict], notes: str, toolbox: Toolbox,
                 previous: ReportBody | None = None, issues: list[dict] | None = None,
                 model: str | None = None) -> ReportBody:
    kb = toolbox.kb
    system = f"{WRITER_SYSTEM}\n\n# Answer guidelines\n{kb.reference_doc('guidelines')}"
    if previous is None:  # a revision only fixes issues; the worked examples are not needed again
        system += f"\n\n# Worked examples\n{kb.reference_doc('worked_examples')}"

    # Only the evidence the research notes rely on (plus anything the previous draft cited): a smaller input
    # means less reasoning. Without usable labels in the notes, the whole evidence pack is sent.
    relied_on = _labels_in(notes) | ({c.label for c in citations(previous)} if previous else set())
    evidence = toolbox.evidence_text(relied_on if len(relied_on) >= 3 else None)

    user = (f"# ENQUIRY\n{enquiry}\n\n# CLIENT ANSWERS\n"
            + ("\n".join(f"- {a['question']} -> {a['answer']}" for a in answers) or "none")
            + f"\n\n# INTAKE\n{json.dumps(intake.model_dump(), ensure_ascii=False, indent=1)}"
            + f"\n\n# RESEARCH NOTES\n{notes}"
            + f"\n\n# REFERENCE TABLES\nMethod overview: {json.dumps(kb.methods['method_overview'], ensure_ascii=False)}"
            + f"\nFiber families [S02 p.6]: {json.dumps(kb.fibers['fibers'], ensure_ascii=False)}"
            + f"\n\n# EVIDENCE (the only pages you may cite)\n{evidence}")
    if previous is not None:
        user += (f"\n\n# YOUR PREVIOUS DRAFT\n{previous.model_dump_json(exclude={'sources'})}\n\n# REVIEW ISSUES TO FIX\n"
                 + "\n".join(f"- [{i['severity']}] {i['check']}: {i['message']}" for i in issues or [])
                 + "\nReturn the complete revised assessment.")
    return ask_json(system, user, ReportBody, model=model, json_schema=_writer_schema())


def _labels_in(notes: str) -> set[str]:
    """Page labels mentioned in the research notes; "S01 p.14–15" counts as both pages."""
    labels = {f"EXT: {m.strip()}" for m in re.findall(r"EXT: ([^\],\n]+)", notes)}
    for source, first, last in re.findall(r"(S\d+) p\.(\d+)(?:\s*[–-]\s*(\d+))?", notes):
        labels |= {f"{source} p.{p}" for p in range(int(first), int(last or first) + 1)}
    return labels


@lru_cache(maxsize=1)
def _writer_schema() -> dict:
    """ReportBody's schema with AFS citations as plain label strings, which cost far fewer output tokens than
    citation objects; Citation expands them when the reply is validated. EXT citations keep the full object."""
    schema = ReportBody.model_json_schema()
    schema["$defs"]["Citation"] = {"anyOf": [
        {"type": "string", "description": 'AFS page label, e.g. "S01 p.10" or "S01 Table 1 (p.6)"'},
        schema["$defs"]["Citation"]]}
    return schema


def critique(enquiry: str, intake, answers: list[dict], draft: ReportBody,
             toolbox: Toolbox) -> tuple[list[VerificationCheck], list[dict]]:
    """Returns the deterministic checks and all issues (failed checks as errors + LLM review issues)."""
    kb: KnowledgeBase = toolbox.kb
    client_text = enquiry + "\n" + "\n".join(a["answer"] for a in answers)
    before = toolbox.evidence_pages()
    repairs = repair_citations(draft, kb, toolbox.record_page)
    added = sorted(toolbox.evidence_pages() - before)
    repairs += [f"added {kb.get_page(s, p)['label']} to the evidence pack" for s, p in added]
    draft.sources = []  # rebuilt from what the report actually cites
    draft.sources = list({c.label: c for c in citations(draft)}.values())

    checks = run_checks(draft, kb, toolbox.evidence_pages(), client_text, len(intake.client_premises),
                        toolbox.external_abstracts())
    if repairs:  # transparent in the report's verification list, never a failure
        checks.append(VerificationCheck(name="citation_repairs", passed=True, details="; ".join(repairs)))

    cited = sorted({(c.source.upper(), c.page) for c in citations(draft) if c.page and kb.get_page(c.source, c.page)})
    pages = "\n\n".join(f"=== [{kb.get_page(s, p)['label']}] ({kb.get_page(s, p)['evidence_level']})\n"
                        f"{kb.get_page(s, p)['text']}" for s, p in cited)
    cited_ext = {normalise_url(c.url or "") for c in citations(draft) if c.source.upper() == "EXT"}
    pages += "".join(f"\n\n=== [EXT: {e['label']}] external research abstract ({e['url']})\n{e['abstract']}"
                     for url, e in toolbox.external.items() if url in cited_ext)
    user = (f"# ENQUIRY\n{enquiry}\n\n# CLIENT ANSWERS\n"
            + ("\n".join(f"- {a['question']} -> {a['answer']}" for a in answers) or "none")
            + f"\n\n# CLIENT PREMISES FROM INTAKE\n{json.dumps(intake.client_premises, ensure_ascii=False)}"
            + f"\n\n# AUTOMATED CHECKS\n" + "\n".join(f"- {c.name}: {'pass' if c.passed else 'FAIL'} ({c.details})"
                                                      for c in checks)
            + f"\n\n# DRAFT\n{draft.model_dump_json(indent=1)}\n\n# CITED PAGES\n{pages}")
    try:
        review_issues = [i.model_dump() for i in ask_json(CRITIC_SYSTEM, user, Critique, thinking=False).issues]
    except Exception as exc:  # the run must still finish; the deterministic checks above remain in force
        review_issues = [{"check": "expert_review", "severity": "warning",
                          "message": f"LLM review unavailable ({exc.__class__.__name__}); automated checks only."}]

    issues = [{"check": c.name, "severity": "error", "message": c.details} for c in checks if not c.passed]
    issues += review_issues
    return checks, issues
