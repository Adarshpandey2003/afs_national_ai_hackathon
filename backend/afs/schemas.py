"""Report data model: the contract shared by the writer agent, the API and the frontend (frontend.md §3)."""
import re
from typing import Literal

from pydantic import BaseModel, Field, model_validator

DecisionStatus = Literal["provisional", "insufficient_information", "outside_supported_scope"]


class Citation(BaseModel):
    source: str = Field(description="S01..S06, TABLE (S01 Table 1) or EXT (external)")
    page: int | None = None
    label: str = Field(description='e.g. "S01 p.10" or "S01 Table 1 (p.6)"')
    quote: str | None = Field(None, description="short supporting excerpt; mandatory for EXT")
    url: str | None = None

    @model_validator(mode="before")
    @classmethod
    def _from_label(cls, value):
        """The writer may give an AFS citation as its label ("S01 p.10", "S01 Table 1 (p.6)"), which needs far
        fewer output tokens than the object; expand it here. Unparseable labels keep page=None and are removed by
        the citation repair."""
        if not isinstance(value, str):
            return value
        m = re.match(r"\s*(S\d+)\b.*?p\.?\s*(\d+)", value)
        return {"source": m.group(1), "page": int(m.group(2)), "label": value.strip()} if m else \
            {"source": value.split()[0] if value.split() else "?", "page": None, "label": value.strip()}


class Claim(BaseModel):
    text: str
    kind: Literal["fact", "sourced", "assumption", "inference"]
    citations: list[Citation] = []


class Premise(BaseModel):
    statement: str
    verdict: Literal["supported", "refuted", "unverified"]
    explanation: str
    citations: list[Citation] = []


class Question(BaseModel):
    question_id: str
    text: str
    priority: Literal[1, 2, 3]
    why_it_matters: str
    affects: Literal["method", "setup", "plan", "acceptance"]


class MethodRecommendation(BaseModel):
    method: str
    technique: str
    role: Literal["primary", "comparison", "combination", "not_recommended"]
    rationale: list[Claim]
    conditions: list[str] = []
    citations: list[Citation] = []


class SpectralRange(BaseModel):
    method: str
    range_text: str
    note: str
    citations: list[Citation] = []


class PlanStep(BaseModel):
    order: int
    title: str
    description: str
    citations: list[Citation] = []


class FeasibilityPlan(BaseModel):
    objective: str
    samples: list[str]
    reference_measurements: list[str]
    steps: list[PlanStep]
    comparison: str
    go_no_go: str


class Requirements(BaseModel):
    stated_facts: list[Claim]
    key_unknowns: list[str]
    client_premises: list[Premise] = []


class MeasurementConcept(BaseModel):
    probe_geometry: list[Claim]
    location: list[Claim]
    fiber_link: list[Claim]


class UserAnswer(BaseModel):
    question_id: str
    question: str = ""  # the question as the client saw it (empty in reports saved before this field existed)
    answer: str


class VerificationCheck(BaseModel):
    name: str
    passed: bool
    details: str


class Verification(BaseModel):
    passed: bool
    revisions: int
    checks: list[VerificationCheck] = []


class ReportMeta(BaseModel):
    model: str
    mode: Literal["interactive", "batch"]
    generated_at: str
    duration_s: float


class ReportBody(BaseModel):
    """The part of the report the writer agent produces."""
    decision_status: DecisionStatus
    decision_rationale: str
    summary: str
    requirements: Requirements
    clarification_questions: list[Question]
    assumptions: list[str]
    recommendations: list[MethodRecommendation]
    measurement_concept: MeasurementConcept
    spectral_ranges: list[SpectralRange]
    risks: list[Claim]
    feasibility_plan: FeasibilityPlan
    sources: list[Citation]


class Report(ReportBody):
    case_id: str | None = None
    enquiry: str
    user_answers: list[UserAnswer] = []
    verification: Verification | None = None
    meta: ReportMeta | None = None
