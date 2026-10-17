"""Agent 2: ReAct research agent. Calls the knowledge-base tools until the requested variables and every client
premise are covered, then writes research notes. Every tool call is streamed to the UI."""
import json
import re

from langchain.agents import create_agent
from langchain.agents.middleware import ToolCallLimitMiddleware
from langchain_core.messages import AIMessage, ToolMessage
from langgraph.errors import GraphRecursionError

from ..llm import chat, fast_model
from ..tools import Toolbox

TOOL_CALL_LIMIT = 12  # further calls are refused, so the agent writes its notes instead
STEP_LIMIT = 60  # safety net on graph steps

SYSTEM = """You are the research agent of an assistant that helps Art Fiber Systems (AFS) experts assess a customer's
in-line spectroscopy enquiry. You collect evidence from the AFS knowledge base; you do not write the final answer.

Tools: search_kb (semantic + keyword search over source pages), get_page (full page), method_table (S01 Table 1 and
the method overview), fiber_check (fiber transmission range against a method's spectral range).

Work through:
1. For each requested variable and sample type: which methods and measurement geometries do the sources support,
   and in which application examples (process, laboratory, research)?
2. For EACH client premise: evidence that supports or contradicts it. Search with several phrasings; this is where
   assessments most often go wrong.
3. If fibers, a remote analyzer or a specific spectral range are involved, run fiber_check, and search the sources
   for cable length / remote-link evidence.
4. Limitations: selectivity, interferences, physical sample variation, calibration needs, interface and fouling.
5. Scope of the evidence: laboratory vs process, in vitro vs clinical, vendor overview vs validated performance.
   Read the full page (get_page) before relying on a key page.
6. The route to routine use: multispectral screening, chemometric modelling or data fusion, and simplification to a
   sensor with a few selected wavelengths (optical multisensor systems).
Issue independent tool calls together in the same turn.
You have at most 12 tool calls; plan them. Do not use outside knowledge as if it were sourced.

Finish with research notes in Markdown, citing page labels such as [S01 p.10] taken only from tool results:
## Candidate methods (per method: why, geometry, conditions, evidence)
## Client premises (each: supported / refuted / unverified, with evidence and reasoning)
## Spectral ranges and fiber link
## Limitations and risks
## Evidence gaps (what the sources do not cover)"""


def _preview(text: str, n: int = 400) -> str:
    return text if len(text) <= n else text[:n] + " …"


def run_researcher(enquiry: str, intake, answers: list[dict], toolbox: Toolbox, ctx) -> str:
    ctx.emit("agent_start", {"agent": "researcher"})
    system = SYSTEM
    if any(t.name == "search_papers" for t in toolbox.tools):
        system += ("\n\nsearch_papers (peer-reviewed abstracts) is a fallback: use it at most twice, and only for a point"
                   " the AFS sources do not cover after you have searched them. Note which point each paper supports;"
                   " in the notes, mark it as external literature [EXT: label] and keep AFS evidence first.")
    agent = create_agent(chat(fast_model(), thinking=False), toolbox.tools, system_prompt=system,
                         middleware=[ToolCallLimitMiddleware(run_limit=TOOL_CALL_LIMIT, exit_behavior="continue")])
    task = (f"Customer enquiry:\n{enquiry}\n\nClient answers:\n"
            + ("\n".join(f"- {a['question']} -> {a['answer']}" for a in answers) or "none")
            + f"\n\nIntake:\n{json.dumps(intake.model_dump(exclude={'questions'}), ensure_ascii=False, indent=1)}"
            + "\n\nKnowledge-base sources:\n" + "\n".join(
                f"- {s['source_id']} ({s['evidence_level']}): {s['title']}" for s in toolbox.kb.sources.values()))

    notes = ""
    try:
        for update in agent.stream({"messages": [("user", task)]}, stream_mode="updates",
                                   config={"recursion_limit": STEP_LIMIT}):
            for node in update.values():
                for msg in (node or {}).get("messages", []):
                    if isinstance(msg, AIMessage) and msg.tool_calls:
                        if msg.content:
                            ctx.emit("agent_step", {"agent": "researcher", "step_type": "thought",
                                                    "summary": _preview(msg.content, 300)})
                        for call in msg.tool_calls:
                            args = ", ".join(f"{k}={v!r}" for k, v in call["args"].items())
                            ctx.emit("agent_step", {"agent": "researcher", "step_type": "tool_call",
                                                    "summary": f"{call['name']}({args})", "tool": call["name"],
                                                    "args": call["args"]})
                    elif isinstance(msg, ToolMessage):
                        labels = sorted(set(re.findall(r"\[(S\d+ p\.\d+|EXT: [^\]]+)\]", msg.content)))
                        ctx.emit("agent_step", {"agent": "researcher", "step_type": "tool_result",
                                                "tool": msg.name, "summary": f"{msg.name}: {', '.join(labels) or 'done'}",
                                                "result_preview": _preview(msg.content)})
                    elif isinstance(msg, AIMessage):
                        notes = msg.content
    except GraphRecursionError:
        notes = "Research stopped at the step limit; rely on the evidence pack and mark gaps as unverified."

    notes += _search_gaps(notes, toolbox, ctx)
    ctx.emit("agent_step", {"agent": "researcher", "step_type": "note",
                            "summary": f"Evidence pack: {len(toolbox.evidence)} pages",
                            "result_preview": _preview(notes, 1500)})
    return notes


def _evidence_gaps(notes: str) -> list[str]:
    """Bullet points under the notes' "Evidence gaps" heading, without Markdown and citation labels."""
    section = re.split(r"^#+\s*Evidence gaps.*$", notes, maxsplit=1, flags=re.M | re.I)
    if len(section) < 2:
        return []
    body = re.split(r"^#+\s", section[1], maxsplit=1, flags=re.M)[0]
    gaps = [re.sub(r"\[[^\]]*\]|[*_`]", "", line).strip(" -•\t") for line in body.splitlines()
            if re.match(r"\s*([-*•]|\d+[.)])\s+", line)]
    return [g for g in gaps if len(g) > 15]


def _search_gaps(notes: str, toolbox: Toolbox, ctx, max_gaps: int = 2) -> str:
    """Fallback literature search: for the first evidence gaps the AFS sources leave open, query peer-reviewed
    abstracts. Deterministic, so the fallback does not depend on the agent remembering to use it."""
    search = next((t for t in toolbox.tools if t.name == "search_papers"), None)
    if search is None:
        return ""
    found = []
    for gap in _evidence_gaps(notes)[:max_gaps]:
        query = _gap_query(gap)
        ctx.emit("agent_step", {"agent": "researcher", "step_type": "tool_call", "tool": "search_papers",
                                "summary": f"search_papers(query={query!r})  [evidence gap]", "args": {"query": query}})
        result = search.invoke({"query": query})
        labels = sorted(set(re.findall(r"\[(EXT: [^\]]+)\]", result)))
        ctx.emit("agent_step", {"agent": "researcher", "step_type": "tool_result", "tool": "search_papers",
                                "summary": f"search_papers: {', '.join(labels) or 'no papers'}",
                                "result_preview": _preview(result)})
        if labels:
            found.append(f"- Gap: {gap} -> external literature: {', '.join(labels)}")
    return ("\n\n## External literature for evidence gaps (weaker than AFS material; cite only with a verbatim quote)\n"
            + "\n".join(found)) if found else ""


_FILLER = re.compile(
    r"\b(no|not|none|afs|sources?|materials?|evidence|pages?|covers?|covered|gives?|provides?|mentions?|states?|"
    r"supplied|does|do|is|are|any|the|a|an|of|for|in|on|to|and|or|by|with|which|what|whether|kind|data|example|"
    r"examples|specific|quantitative|performance|comparison|vs|e\.g|eg|etc|this|that|these|those|client|customer)\b",
    re.I)
_METHOD = re.compile(r"spectro|raman|nir\b|infrared|\bmir\b|ftir|fluoresc|uv|atr\b|optical|chemometric", re.I)


def _gap_query(gap: str, max_words: int = 10) -> str:
    """Turn an evidence-gap sentence into a focused literature query: drop source references, punctuation and
    filler words, keep the first content words, and anchor it to spectroscopy if no method is named."""
    text = re.sub(r"\bS\d+\b(\s*p\.?\s*\d+)?|\(.*?\)|[^\w\s]", " ", gap)
    words = list(dict.fromkeys(w.lower() for w in _FILLER.sub(" ", text).split() if len(w) > 1))[:max_words]
    query = " ".join(words)
    return query if _METHOD.search(query) else f"{query} spectroscopy"
