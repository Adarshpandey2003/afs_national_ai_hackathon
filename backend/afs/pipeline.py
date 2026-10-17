"""Entry point the API calls for one assessment: a LangGraph state graph
    clarifier -> researcher -> writer -> critic -> (writer again while errors remain, up to MAX_REVISIONS) -> report

Contract with the API run manager (`ctx`):
    ctx.emit(event, data)  push an SSE event: agent_start, agent_step, draft_ready, critic_result
                           (see frontend.md §2; the API itself emits status, report, error and done)
    ctx.ask(payload)       interactive mode only: payload is the `clarification_needed` data
                           {round, max_rounds, questions, stated_facts, key_unknowns, assumptions}.
                           Blocks until the user replies and returns
                           {"answers": [{"question_id", "answer"}], "proceed_with_assumptions": bool}.
"""
import os
import time
from datetime import datetime, timezone
from typing import Any, Literal, Protocol, TypedDict

from langgraph.graph import END, START, StateGraph

from .agents.clarifier import run_clarifier
from .agents.researcher import run_researcher
from .agents.writer_critic import critique, write_report
from .checks import citations
from .llm import writer_model
from .retrieval import get_kb, get_retriever
from .schemas import Report, UserAnswer, Verification, VerificationCheck
from .tools import Toolbox

MAX_REVISIONS = int(os.environ.get("MAX_REVISIONS", "2"))


class RunContext(Protocol):
    def emit(self, event: str, data: dict) -> None: ...
    def ask(self, payload: dict) -> dict: ...


class State(TypedDict, total=False):
    enquiry: str
    mode: str
    intake: Any
    answers: list[dict]
    toolbox: Toolbox
    notes: str
    draft: Any
    checks: list[VerificationCheck]
    issues: list[dict]
    revision: int


def build_graph(ctx: RunContext):
    def clarify(s: State) -> State:
        intake, answers = run_clarifier(s["enquiry"], s["mode"], ctx)
        return {"intake": intake, "answers": answers}

    def research(s: State) -> State:
        toolbox = Toolbox(get_kb(), get_retriever())
        return {"toolbox": toolbox, "notes": run_researcher(s["enquiry"], s["intake"], s["answers"], toolbox, ctx)}

    def write(s: State) -> State:
        revision = s.get("revision", 0)
        ctx.emit("agent_start", {"agent": "writer", "revision": revision})
        draft = write_report(s["enquiry"], s["intake"], s["answers"], s["notes"], s["toolbox"],
                             previous=s.get("draft") if revision else None, issues=s.get("issues"),
                             model=writer_model(s["mode"]))
        ctx.emit("draft_ready", {"revision": revision})
        return {"draft": draft}

    def review(s: State) -> State:
        ctx.emit("agent_start", {"agent": "critic", "revision": s.get("revision", 0)})
        checks, issues = critique(s["enquiry"], s["intake"], s["answers"], s["draft"], s["toolbox"])
        passed = not any(i["severity"] == "error" for i in issues)
        ctx.emit("critic_result", {"revision": s.get("revision", 0), "passed": passed, "issues": issues})
        return {"checks": checks, "issues": issues, "revision": s.get("revision", 0) + (0 if passed else 1)}

    def after_review(s: State) -> Literal["write", "__end__"]:
        failed = any(i["severity"] == "error" for i in s["issues"])
        return "write" if failed and s["revision"] <= MAX_REVISIONS else END

    graph = StateGraph(State)
    graph.add_node("clarify", clarify)
    graph.add_node("research", research)
    graph.add_node("write", write)
    graph.add_node("review", review)
    graph.add_edge(START, "clarify")
    graph.add_edge("clarify", "research")
    graph.add_edge("research", "write")
    graph.add_edge("write", "review")
    graph.add_conditional_edges("review", after_review)
    return graph.compile()


def renumber_open_questions(questions: list) -> None:
    """The report's open questions, sorted by priority and numbered open-1, open-2, … in place. Distinct from the
    IDs of questions the client already answered (q1, q2.1, …), so an answer is never shown under another question."""
    questions.sort(key=lambda q: q.priority)
    for i, q in enumerate(questions, 1):
        q.question_id = f"open-{i}"


def run_assessment(enquiry: str, mode: Literal["interactive", "batch"], ctx: RunContext) -> Report:
    started = time.time()
    s = build_graph(ctx).invoke({"enquiry": enquiry, "mode": mode, "revision": 0},
                                config={"recursion_limit": 25})
    draft, issues = s["draft"], s["issues"]

    # the source list is rebuilt from what the report actually cites
    seen, sources = set(), []
    for c in citations(draft):
        if c.label not in seen:
            seen.add(c.label)
            sources.append(c)
    draft.sources = sources
    renumber_open_questions(draft.clarification_questions)

    review_errors = [i for i in issues if i["severity"] == "error"]
    checks = s["checks"] + [VerificationCheck(
        name="expert_review", passed=not review_errors,
        details="; ".join(f"[{i['severity']}] {i['message']}" for i in issues if i["check"] not in
                          {c.name for c in s["checks"]}) or "No issues raised.")]
    return Report(
        **draft.model_dump(), enquiry=enquiry,
        user_answers=[UserAnswer(question_id=a["question_id"], question=a.get("question", ""), answer=a["answer"])
                      for a in s["answers"]],
        verification=Verification(passed=all(c.passed for c in checks),
                                  revisions=min(s["revision"], MAX_REVISIONS), checks=checks),
        meta={"model": writer_model(mode), "mode": mode, "generated_at": datetime.now(timezone.utc).isoformat(timespec="seconds"),
              "duration_s": round(time.time() - started, 1)},
    )
