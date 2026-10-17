"""Agent 1: requirements and clarification. Extracts what the client actually said and what is missing.
Interactive mode: asks the user (up to MAX_ROUNDS) until no method-changing question is open.
Batch mode: one pass; open questions and working assumptions go into the report."""
import json

from pydantic import BaseModel, Field

from ..llm import ask_json, fast_model
from ..schemas import Question

MAX_ASK_ROUNDS = 1  # interactive: the user is asked once; their answers are then folded into one more intake pass
ASK_LIMIT = 3       # only the most decisive (priority 1) questions are put to the user; the rest stay in the report

SYSTEM = """You are the intake step of an assistant that helps Art Fiber Systems (AFS) experts make a first technical
assessment of a customer's in-line (fiber-optic) spectroscopy enquiry. You do not recommend methods yet.

Rules:
- The enquiry, plus any client answers, contains everything the client has said. Anything not stated is unknown.
  Never add facts, concentrations, materials, conditions or answers the client did not give.
- stated_facts: only what the client actually said, one fact per item, in neutral wording.
- requested_variables: the quantities or decisions the client wants (e.g. a concentration, a classification).
- client_premises: claims, assumptions, proposals or requests in the enquiry that must be checked against the
  technical sources before they can be accepted: a proposed method or justification, reuse of existing equipment or
  calibrations, a requested level of certainty, readiness or approval, a requested final configuration. Quote or
  closely paraphrase the client. Empty list if there are none.
  Requirements, targets and constraints the client sets (ranges, accuracy, update rate, location, process
  conditions, reference method, priorities, what output is enough) are stated_facts, not premises. A premise is a
  claim about what will work or is valid: a proposed method or its justification, reuse of equipment or
  calibrations, a causal explanation, a requested approval, proof or readiness.
- key_unknowns: missing information that matters for method choice, setup, the feasibility plan or acceptance.
- questions: a short diagnostic questionnaire, like a doctor's first questions: at most 5. Ask only what would change
  the method, setup or plan; anything that can reasonably be assumed becomes an assumption instead of a question.
  Cover, where not already known: the process and its problem or bottleneck (what goes wrong: batch variability,
  yield, rejects, safety, delays); the target components or quality variables and their level (trace ppm or major %);
  the current reference method and how often it is sampled; the measurement point and process conditions (phase,
  temperature, pressure, flow, access, fouling); the required response time and accuracy.
  priority 1 = the answer could change the method or the setup; 2 = it shapes the feasibility plan;
  3 = acceptance or practical details. Each with why_it_matters and affects. Do not ask what the client already
  answered.
- assumptions: explicit working assumptions that would let a provisional assessment proceed if questions stay open.
  Phrase them as assumptions, never as facts.
- scope_concerns: reasons the request may ask for more certainty, readiness or scope than a first assessment based
  on general application material can give (e.g. a requested final configuration, approval, proof, clinical or
  safety-critical use). Empty list if none."""


class Intake(BaseModel):
    stated_facts: list[str]
    requested_variables: list[str]
    client_premises: list[str] = Field(description="client claims, proposals or requests that need checking")
    key_unknowns: list[str]
    questions: list[Question]
    assumptions: list[str]
    scope_concerns: list[str]


def _prompt(enquiry: str, answers: list[dict]) -> str:
    text = f"Customer enquiry:\n{enquiry}"
    if answers:
        text += "\n\nClient answers to earlier clarification questions:\n" + "\n".join(
            f"- Q: {a['question']}\n  A: {a['answer']}" for a in answers)
    return text


def run_clarifier(enquiry: str, mode: str, ctx) -> tuple[Intake, list[dict]]:
    """Returns the final intake and the client's answers [{question_id, question, answer}]."""
    answers: list[dict] = []
    for round_no in range(1, MAX_ASK_ROUNDS + 2):
        ctx.emit("agent_start", {"agent": "clarifier", "round": round_no})
        intake = ask_json(SYSTEM, _prompt(enquiry, answers), Intake, model=fast_model())
        intake.questions.sort(key=lambda q: q.priority)
        for i, q in enumerate(intake.questions, 1):
            q.question_id = f"q{i}" if round_no == 1 else f"q{round_no}.{i}"
        ctx.emit("agent_step", {"agent": "clarifier", "step_type": "note", "summary": (
            f"{len(intake.stated_facts)} stated facts, {len(intake.client_premises)} client premise(s) to check, "
            f"{len(intake.key_unknowns)} unknowns, {len(intake.questions)} questions"),
            "result_preview": json.dumps(intake.model_dump(), ensure_ascii=False, indent=1)[:1500]})

        decisive = [q for q in intake.questions if q.priority == 1][:ASK_LIMIT]
        if mode == "batch" or round_no > MAX_ASK_ROUNDS or not decisive:
            break
        reply = ctx.ask({
            "round": round_no, "max_rounds": MAX_ASK_ROUNDS,
            "questions": [q.model_dump() for q in decisive],
            "stated_facts": [{"text": f, "kind": "fact", "citations": []} for f in intake.stated_facts],
            "key_unknowns": intake.key_unknowns, "assumptions": intake.assumptions,
        })
        by_id = {q.question_id: q.text for q in intake.questions}
        new = [{"question_id": a["question_id"], "question": by_id.get(a["question_id"], ""), "answer": a["answer"]}
               for a in reply["answers"] if a["answer"].strip()]
        answers += new
        if reply["proceed_with_assumptions"] or not new:
            break
    return intake, answers
