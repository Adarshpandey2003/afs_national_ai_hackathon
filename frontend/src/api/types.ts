// Types copied from frontend.md §3 (the backend contract). Keep snake_case as is.

export type SourceId = "S01" | "S02" | "S03" | "S04" | "S05" | "S06" | "TABLE" | "REF" | "EXT";
export type EvidenceLevel =
  | "vendor_overview"
  | "vendor_slides"
  | "research_in_vitro_poc"
  | "research_lab_note"
  | "business_context"
  | "expert_notes"
  | "reference_doc"
  | "external";

export interface Case { case_id: string; set: "dev" | "eval"; title: string; text: string; }

export interface Citation {
  source: SourceId; page: number | null;   // null for TABLE
  label: string;                           // "S01 p.10", "S01 Table 1 (p.6)"
  quote?: string;                          // short supporting excerpt
  url?: string;                            // only for EXT (external) — quote is then mandatory
}

export interface Claim {
  text: string;
  kind: "fact" | "sourced" | "assumption" | "inference";
  citations: Citation[];
}

export interface Premise {                 // something the client asserted / assumed
  statement: string;
  verdict: "supported" | "refuted" | "unverified";
  explanation: string;
  citations: Citation[];
}

export interface Question {
  question_id: string;                     // "q1"
  text: string;
  priority: 1 | 2 | 3;                     // 1 = could change method/setup
  why_it_matters: string;
  affects: "method" | "setup" | "plan" | "acceptance";
}

export interface MethodRecommendation {
  method: string;                          // "NIR", "Raman", "MIR ATR", "NIR + Raman"
  technique: string;                       // "diffuse reflection probe"
  role: "primary" | "comparison" | "combination" | "not_recommended";
  rationale: Claim[];
  conditions: string[];                    // when this applies
  citations: Citation[];
}

export interface SpectralRange {
  method: string;
  range_text: string;                      // "780–2500 nm (nominal method range)"
  note: string;                            // e.g. "usable range depends on instrument/fiber"
  citations: Citation[];
}

export interface PlanStep { order: number; title: string; description: string; citations: Citation[]; }

export interface FeasibilityPlan {
  objective: string;
  samples: string[];                       // representative samples / process states
  reference_measurements: string[];
  steps: PlanStep[];
  comparison: string;                      // what is compared
  go_no_go: string;                        // decision basis (no invented numbers)
}

export interface CriticIssue { check: string; severity: "error" | "warning"; message: string; }

export type DecisionStatus = "provisional" | "insufficient_information" | "outside_supported_scope";

export interface Report {
  case_id?: string;
  enquiry: string;
  decision_status: DecisionStatus;
  decision_rationale: string;
  summary: string;                         // 2–3 sentence executive summary
  requirements: { stated_facts: Claim[]; key_unknowns: string[]; client_premises: Premise[]; };
  clarification_questions: Question[];
  assumptions: string[];
  user_answers: { question_id: string; answer: string }[];   // interactive mode only
  recommendations: MethodRecommendation[];
  measurement_concept: { probe_geometry: Claim[]; location: Claim[]; fiber_link: Claim[]; };
  spectral_ranges: SpectralRange[];
  risks: Claim[];
  feasibility_plan: FeasibilityPlan;
  sources: Citation[];                     // de-duplicated list of everything cited
  verification: { passed: boolean; revisions: number; checks: { name: string; passed: boolean; details: string }[]; };
  meta: { model: string; mode: "interactive" | "batch"; generated_at: string; duration_s: number; };
}

export type AgentName = "clarifier" | "researcher" | "writer" | "critic";
export type RunStatus = "running" | "awaiting_clarification" | "completed" | "failed";
export type Mode = "interactive" | "batch";

export interface AssessmentSnapshot {
  thread_id: string; status: RunStatus; enquiry: string; mode: Mode;
  clarification?: { round: number; max_rounds: number; questions: Question[] };
  report?: Report; error?: { code: string; message: string };
}

export interface SourceInfo { source_id: SourceId; title: string; file: string; pages: number; evidence_level: EvidenceLevel; description: string; }
export interface KbPage { source_id: SourceId; page: number; title: string; evidence_level: EvidenceLevel; text: string; }

export interface Health { status: "ok"; version: string; llm_ready: boolean; mock_mode: boolean; }
export interface OutputSummary { case_id: string; generated_at: string; decision_status: DecisionStatus; }
export interface Answer { question_id: string; answer: string; }

// SSE payloads (frontend.md §2)
export interface AgentStep {
  agent: AgentName;
  step_type: "thought" | "tool_call" | "tool_result" | "note";
  summary: string;
  tool?: string;
  args?: Record<string, unknown>;
  result_preview?: string;
  citations?: Citation[];
}
export interface ClarificationNeeded {
  round: number; max_rounds: number; questions: Question[];
  stated_facts: Claim[]; key_unknowns: string[]; assumptions: string[];
}

export type RunEvent =
  | { type: "status"; data: { status: RunStatus; agent?: AgentName } }
  | { type: "agent_start"; data: { agent: AgentName; round?: number; revision?: number } }
  | { type: "agent_step"; data: AgentStep }
  | { type: "clarification_needed"; data: ClarificationNeeded }
  | { type: "draft_ready"; data: { revision: number } }
  | { type: "critic_result"; data: { revision: number; passed: boolean; issues: CriticIssue[] } }
  | { type: "report"; data: { report: Report } }
  | { type: "error"; data: { code: string; message: string } }
  | { type: "done"; data: { status: "completed" | "failed" } };

export const EVENT_TYPES: RunEvent["type"][] = [
  "status", "agent_start", "agent_step", "clarification_needed", "draft_ready",
  "critic_result", "report", "error", "done",
];
