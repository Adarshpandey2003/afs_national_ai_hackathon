"""Report -> Markdown (the /report.md export and the committed outputs/*.md)."""
from .schemas import Citation, Claim, Report

STATUS_LABELS = {
    "provisional": "Provisional assessment",
    "insufficient_information": "Insufficient information",
    "outside_supported_scope": "Outside supported scope",
}


def _cites(citations: list[Citation]) -> str:
    return f" [{'; '.join(c.label for c in citations)}]" if citations else ""


def _claims(claims: list[Claim]) -> list[str]:
    return [f"- {c.text} *({c.kind})*{_cites(c.citations)}" for c in claims] or ["- None stated"]


def _bullets(items: list[str]) -> list[str]:
    return [f"- {i}" for i in items] or ["- None stated"]


def render_markdown(r: Report) -> str:
    out = [f"# Assessment{f' {r.case_id}' if r.case_id else ''}",
           f"**Decision status:** {STATUS_LABELS[r.decision_status]}. {r.decision_rationale}",
           f"> {r.enquiry}", r.summary,
           "## Requirements", "**Stated facts**", *_claims(r.requirements.stated_facts),
           "**Key unknowns**", *_bullets(r.requirements.key_unknowns)]
    if r.requirements.client_premises:
        out.append("**Client premises**")
        out += [f"- {p.statement}: **{p.verdict}**. {p.explanation}{_cites(p.citations)}"
                for p in r.requirements.client_premises]

    out.append("## Clarification questions")
    out += [f"{i}. (P{q.priority}, {q.affects}) {q.text} *{q.why_it_matters}*"
            for i, q in enumerate(sorted(r.clarification_questions, key=lambda q: q.priority), 1)]
    if r.user_answers:
        out += ["**Client answers**", *[f"- Q: {a.question or a.question_id} → A: {a.answer}" for a in r.user_answers]]
    out += ["## Assumptions", *_bullets(r.assumptions), "## Recommendation"]
    for m in r.recommendations:
        out.append(f"### {m.method} ({m.technique}): {m.role.replace('_', ' ')}{_cites(m.citations)}")
        out += _claims(m.rationale)
        if m.conditions:
            out.append("Applies if: " + "; ".join(m.conditions))

    mc = r.measurement_concept
    out += ["## Measurement concept", "**Probe geometry**", *_claims(mc.probe_geometry),
            "**Location**", *_claims(mc.location), "**Fiber link**", *_claims(mc.fiber_link),
            "## Spectral range", "| Method | Range | Note | Sources |", "|---|---|---|---|"]
    out += [f"| {s.method} | {s.range_text} | {s.note} | {_cites(s.citations).strip(' []')} |"
            for s in r.spectral_ranges]

    fp = r.feasibility_plan
    out += ["## Risks and uncertainty", *_claims(r.risks),
            "## Feasibility plan", f"**Objective:** {fp.objective}",
            "**Samples**", *_bullets(fp.samples), "**Reference measurements**", *_bullets(fp.reference_measurements),
            *[f"{s.order}. **{s.title}**: {s.description}{_cites(s.citations)}" for s in fp.steps],
            f"**Comparison:** {fp.comparison}", f"**Go / no-go:** {fp.go_no_go}",
            "## Sources", *_bullets([c.label + (f": \"{c.quote}\"" if c.quote else "") + (f" ({c.url})" if c.url else "")
                                     for c in r.sources])]
    if r.verification:
        v = r.verification
        out += ["## Verification", f"Passed: {v.passed}, revisions: {v.revisions}",
                *[f"- {'✓' if c.passed else '✗'} {c.name}: {c.details}" for c in v.checks]]
    if r.meta:
        out.append(f"*Generated {r.meta.generated_at} by {r.meta.model} ({r.meta.mode} mode, {r.meta.duration_s:.0f} s)*")
    return "\n\n".join(out) + "\n"
