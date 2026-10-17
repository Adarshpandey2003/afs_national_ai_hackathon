"""Batch-run cases through the full pipeline and write outputs/<ID>.json and .md (generated, never edited).

Usage (from backend/):  python run_eval.py            # all D01-D08 and H01-H06, then outputs/EVAL.md
                        python run_eval.py H04 D01    # selected cases
                        python run_eval.py --summary  # only rewrite outputs/EVAL.md from the saved reports
"""
import argparse
import sys
import time
from concurrent.futures import ThreadPoolExecutor
from pathlib import Path

from dotenv import load_dotenv

load_dotenv()

from afs.pipeline import run_assessment  # noqa: E402
from afs.checks import citations  # noqa: E402
from afs.render import render_markdown  # noqa: E402
from afs.retrieval import get_kb, get_retriever  # noqa: E402
from afs.schemas import Claim, Report  # noqa: E402

OUTPUTS = Path(__file__).resolve().parents[1] / "outputs"


class PrintContext:
    def __init__(self, case_id: str):
        self.case_id, self.started = case_id, time.time()

    def emit(self, event: str, data: dict) -> None:
        if event == "agent_start":
            print(f"  [{self.case_id}] {time.time() - self.started:5.0f}s start {data['agent']}", flush=True)
        elif event == "agent_step" and data["step_type"] in ("tool_call", "note"):
            print(f"  [{self.case_id}] {data['agent']}: {data['summary'][:140]}", flush=True)
        elif event == "critic_result":
            errors = [i for i in data["issues"] if i["severity"] == "error"]
            print(f"  [{self.case_id}] critic rev {data['revision']}: {'pass' if data['passed'] else 'FAIL'}"
                  + "".join(f"\n      - {i['check']}: {i['message'][:160]}" for i in errors), flush=True)

    def ask(self, payload: dict) -> dict:  # batch mode never asks
        return {"answers": [], "proceed_with_assumptions": True}


def run_case(case: dict) -> str:
    started = time.time()
    report = run_assessment(case["text"], "batch", PrintContext(case["case_id"]))
    report.case_id = case["case_id"]
    (OUTPUTS / f"{case['case_id']}.json").write_text(report.model_dump_json(indent=2), encoding="utf-8")
    (OUTPUTS / f"{case['case_id']}.md").write_text(render_markdown(report), encoding="utf-8")
    return (f"{case['case_id']}: {report.decision_status}, verification "
            f"{'passed' if report.verification.passed else 'FAILED'}, {report.verification.revisions} revision(s), "
            f"{time.time() - started:.0f}s")


def main() -> None:
    sys.stdout.reconfigure(encoding="utf-8")
    parser = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    parser.add_argument("cases", nargs="*", help="case ids (default: all)")
    parser.add_argument("--workers", type=int, default=3)
    parser.add_argument("--summary", action="store_true", help="only rewrite outputs/EVAL.md")
    args = parser.parse_args()
    if args.summary:
        print(f"wrote {write_summary()}")
        return

    OUTPUTS.mkdir(exist_ok=True)
    wanted = {c.upper() for c in args.cases}
    cases = [c for c in get_kb().cases["cases"] if not wanted or c["case_id"] in wanted]
    get_retriever()  # load the index once before the worker threads start
    with ThreadPoolExecutor(max_workers=args.workers) as pool:
        for line in pool.map(_safe_run_case, cases):
            print(line, flush=True)
    print(f"wrote {write_summary()}")


def _safe_run_case(case: dict) -> str:
    """One failing case (e.g. a network error) must not abort the rest; rerun it afterwards by id."""
    try:
        return run_case(case)
    except Exception as exc:
        return f"{case['case_id']}: FAILED ({exc.__class__.__name__}: {str(exc)[:120]}); rerun with: python run_eval.py {case['case_id']}"



def _claims(obj) -> list[Claim]:
    if isinstance(obj, Claim):
        return [obj]
    if isinstance(obj, list):
        return [c for item in obj for c in _claims(item)]
    if hasattr(type(obj), "model_fields"):
        return [c for name in type(obj).model_fields for c in _claims(getattr(obj, name))]
    return []


def write_summary() -> Path:
    """outputs/EVAL.md: grounding and verification figures across all saved reports (the "proof" table)."""
    rows, totals = [], {"claims": 0, "cited": 0, "afs": 0, "ext": 0, "premises": 0, "passed": 0, "revisions": 0}
    for path in sorted(OUTPUTS.glob("*.json")):
        r = Report.model_validate_json(path.read_text(encoding="utf-8"))
        claims = _claims(r)
        cited = [c for c in claims if c.citations]
        kinds = {k: sum(c.kind == k for c in claims) for k in ("fact", "sourced", "inference", "assumption")}
        cites = citations(r.model_copy(update={"sources": []}))
        checks = {c.name: c for c in r.verification.checks}
        ext = sum(c.source == "EXT" for c in cites)
        rows.append(f"| {r.case_id} | {r.decision_status} | {len(claims)} | {kinds['fact']} / {kinds['sourced']} / "
                    f"{kinds['inference']} / {kinds['assumption']} | {len(cited) / max(len(claims), 1):.0%} | "
                    f"{len(cites) - ext} / {ext} | {'yes' if checks['citations_valid'].passed else 'NO'} | "
                    f"{'0' if checks['numbers_supported'].passed else 'FOUND'} | {len(r.requirements.client_premises)} | "
                    f"{'pass' if r.verification.passed else 'FAIL'} | {r.verification.revisions} | "
                    f"{r.meta.duration_s:.0f} s |")
        totals["claims"] += len(claims)
        totals["cited"] += len(cited)
        totals["afs"] += len(cites) - ext
        totals["ext"] += ext
        totals["premises"] += len(r.requirements.client_premises)
        totals["passed"] += r.verification.passed
        totals["revisions"] += r.verification.revisions
    n = len(rows)
    text = "\n".join([
        "# Evaluation summary (generated by `python run_eval.py --summary`; not edited)", "",
        f"{n} reports in this folder. Every report was produced by the assistant in batch mode and checked by the "
        "critic: citations must point to pages actually retrieved in that run, external quotes must appear verbatim in "
        "the fetched abstract, and every number with a unit must appear in the sources or the client's text.", "",
        "| Case | Status | Claims | fact / sourced / inference / assumption | Claims with citation | Citations AFS / external "
        "| Citations valid | Unsupported numbers | Premises judged | Verification | Revisions | Time |",
        "|---|---|---|---|---|---|---|---|---|---|---|---|", *rows, "",
        "## Totals", "",
        f"- Reports passing all checks: **{totals['passed']} / {n}**",
        f"- Claims: {totals['claims']}, of which {totals['cited'] / max(totals['claims'], 1):.0%} carry a citation "
        "(the rest are client facts, inferences or labelled assumptions)",
        f"- Citations: {totals['afs']} to AFS pages, {totals['ext']} to external papers (quote-verified)",
        f"- Client premises given an explicit verdict: {totals['premises']}",
        f"- Writer revisions needed: {totals['revisions']}", ""])
    out = OUTPUTS / "EVAL.md"
    out.write_text(text, encoding="utf-8")
    return out


if __name__ == "__main__":
    main()
