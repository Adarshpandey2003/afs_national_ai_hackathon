# Frontend handoff spec — AFS In-line Spectroscopy Assistant

Audience: the teammate building the React frontend. The backend is built in parallel, so this is the contract. The backend also serves the live OpenAPI schema at `/openapi.json` and Swagger UI at `/docs`.

## 0. Setup & conventions
- Stack: **React + Vite + TypeScript**, Tailwind (suggested), deployed on **Vercel** (SPA rewrite in `vercel.json`).
- Env: `VITE_API_BASE_URL` (e.g. `https://afs-backend.onrender.com`). There are no auth headers.
- Backend CORS allows origins listed in its `CORS_ORIGINS` env. Send the Vercel URL(s) to the backend owner.
- All JSON fields are **snake_case**. Keep them as is in TS types (don't convert).
- Generate TS types: `npx openapi-typescript $VITE_API_BASE_URL/openapi.json -o src/api/schema.ts` (or copy the types in §3).
- **Mock mode for parallel work:**
  - Backend env `MOCK_MODE=1` replays a recorded run (same routes, same SSE events, ~20 s) with no LLM calls.
  - Static fixtures are in `docs/mock/`: `report_H04.json`, `report_D01.json`, `events_interactive.ndjson`, `cases.json`.
- Runs take **1–3 minutes**. Free-tier backends **cold-start in ~30–60 s**, so the UI must show this clearly instead of looking broken.

## 1. API routes

| Method | Path | Purpose | Response |
|---|---|---|---|
| GET | `/health` | Liveness + config check (poll on app load) | `{status:"ok", version, llm_ready:bool, mock_mode:bool}` |
| GET | `/cases` | Preset enquiries | `Case[]` |
| GET | `/cases/{case_id}` | One preset | `Case` |
| POST | `/assessments` | Start a run | `201 {thread_id, status:"running"}` |
| GET | `/assessments/{thread_id}/events` | **SSE stream** of agent progress (use `EventSource`) | `text/event-stream` (§2) |
| POST | `/assessments/{thread_id}/answers` | Answer clarification questions or skip them | `202 {thread_id, status:"running"}` |
| GET | `/assessments/{thread_id}` | Full snapshot (for reload or reconnect) | `AssessmentSnapshot` |
| GET | `/assessments/{thread_id}/report.md` | Markdown export | `text/markdown` |
| GET | `/kb/sources` | Source list for the "Sources" page | `SourceInfo[]` |
| GET | `/kb/{source_id}/pages/{page}` | Page text for the citation viewer | `KbPage` |
| GET | `/outputs` | Precomputed batch reports committed in the repo (D01–D08, H01–H06) | `{case_id, generated_at, decision_status}[]` |
| GET | `/outputs/{case_id}` | One precomputed report (instant, no LLM call; **demo fallback**) | `Report` |

**POST `/assessments` body**
```json
{ "enquiry": "We want to investigate water content…", "mode": "interactive", "case_id": "H04" }
```
- `mode`: `"interactive"` lets the clarifier pause and ask the user. `"batch"` means the clarifier never pauses and records assumptions instead.
- `case_id` is optional and only used as a label.
- Validation: `enquiry` must be 20–4000 chars, else `422`.

**POST `/assessments/{id}/answers` body**
```json
{ "answers": [ {"question_id": "q1", "answer": "Crude oil, 40–60 °C"} ],
  "proceed_with_assumptions": false }
```
- Unanswered questions can be omitted.
- `proceed_with_assumptions: true` (with `answers: []`) makes the backend stop asking and continue.
- `409` if the thread is not in `awaiting_clarification`.

**Errors:** `{ "error": { "code": "string", "message": "string" } }` with HTTP 4xx/5xx. Codes: `not_found`, `invalid_state`, `validation_error`, `llm_error`, `timeout`.

## 2. SSE event stream (`GET /assessments/{id}/events`)
- Each message has `event: <type>` and `data: <JSON>`, plus an `id:` so `EventSource` reconnects with `Last-Event-ID`. The server replays missed events.
- A heartbeat comment (`: ping`) is sent every 15 s.
- The stream closes after `done`.
- On reconnect after `done`, fetch the snapshot instead.

| event | data | UI action |
|---|---|---|
| `status` | `{status: RunStatus, agent?: AgentName}` | Update the global status indicator |
| `agent_start` | `{agent, round?: number, revision?: number}` | Add a timeline section ("Clarifier – round 1") |
| `agent_step` | `{agent, step_type: "thought"\|"tool_call"\|"tool_result"\|"note", summary: string, tool?: string, args?: object, result_preview?: string, citations?: Citation[]}` | Append a timeline row. Show `tool_call` as a chip (`search_kb("silica fiber MIR range")`). Make `result_preview` collapsible. |
| `clarification_needed` | `{round, max_rounds, questions: Question[], stated_facts: Claim[], key_unknowns: string[], assumptions: string[]}` | Open the **ClarificationPanel**. Status becomes `awaiting_clarification`. The stream stays open and idle. |
| `draft_ready` | `{revision}` | Timeline note |
| `critic_result` | `{revision, passed: bool, issues: CriticIssue[]}` | Timeline row with pass/fail and issue list |
| `report` | `{report: Report}` | Render the **ReportView** |
| `error` | `{code, message}` | Error banner + "Retry" (re-POST the same enquiry) |
| `done` | `{status: "completed"\|"failed"}` | Stop the spinner and close the EventSource |

`AgentName` = `"clarifier" | "researcher" | "writer" | "critic"`
`RunStatus` = `"running" | "awaiting_clarification" | "completed" | "failed"`

## 3. Data types (TypeScript)
```ts
type SourceId = "S01"|"S02"|"S03"|"S04"|"S05"|"S06"|"TABLE"|"REF"|"EXT";
type EvidenceLevel = "vendor_overview"|"vendor_slides"|"research_in_vitro_poc"|"research_lab_note"|"business_context"|"reference_doc"|"external";

interface Case { case_id: string; set: "dev"|"eval"; title: string; text: string; }

interface Citation {
  source: SourceId; page: number | null;   // null for TABLE
  label: string;                           // "S01 p.10", "S01 Table 1 (p.6)"
  quote?: string;                          // short supporting excerpt
  url?: string;                            // only for EXT (external) — quote is then mandatory
}

interface Claim {
  text: string;
  kind: "fact" | "sourced" | "assumption" | "inference";
  citations: Citation[];
}

interface Premise {                        // something the client asserted / assumed
  statement: string;
  verdict: "supported" | "refuted" | "unverified";
  explanation: string;
  citations: Citation[];
}

interface Question {
  question_id: string;                     // "q1"
  text: string;
  priority: 1 | 2 | 3;                     // 1 = could change method/setup
  why_it_matters: string;
  affects: "method" | "setup" | "plan" | "acceptance";
}

interface MethodRecommendation {
  method: string;                          // "NIR", "Raman", "MIR ATR", "NIR + Raman"
  technique: string;                       // "diffuse reflection probe"
  role: "primary" | "comparison" | "combination" | "not_recommended";
  rationale: Claim[];
  conditions: string[];                    // when this applies
  citations: Citation[];
}

interface SpectralRange {
  method: string;
  range_text: string;                      // "780–2500 nm (nominal method range)"
  note: string;                            // e.g. "usable range depends on instrument/fiber"
  citations: Citation[];
}

interface PlanStep { order: number; title: string; description: string; citations: Citation[]; }

interface FeasibilityPlan {
  objective: string;
  samples: string[];                       // representative samples / process states
  reference_measurements: string[];
  steps: PlanStep[];
  comparison: string;                      // what is compared
  go_no_go: string;                        // decision basis (no invented numbers)
}

interface CriticIssue { check: string; severity: "error"|"warning"; message: string; }

interface Report {
  case_id?: string;
  enquiry: string;
  decision_status: "provisional" | "insufficient_information" | "outside_supported_scope";
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
  meta: { model: string; mode: "interactive"|"batch"; generated_at: string; duration_s: number; };
}

interface AssessmentSnapshot {
  thread_id: string; status: RunStatus; enquiry: string; mode: "interactive"|"batch";
  clarification?: { round: number; max_rounds: number; questions: Question[] };
  report?: Report; error?: { code: string; message: string };
}

interface SourceInfo { source_id: SourceId; title: string; file: string; pages: number; evidence_level: EvidenceLevel; description: string; }
interface KbPage { source_id: SourceId; page: number; title: string; evidence_level: EvidenceLevel; text: string; }
```

## 4. Screens & components

**Routes:** `/` (Assistant), `/reports` (precomputed D/H reports), `/reports/:caseId`, `/sources` (KB overview).

**Layout:** header with AFS title, nav and a backend health dot (green = ok; amber = "waking up server…" while `/health` is retried every 5 s for up to 90 s; red = down).

**Assistant page (`/`)**, desktop has 3 columns that stack on mobile:
1. **EnquiryPanel** (left)
   - Preset dropdown grouped "Development (D01–D08)" / "Final evaluation (H01–H06)". Selecting one fills the textarea from `/cases`.
   - Textarea (20–4000 chars, counter).
   - Mode toggle: Interactive (default) / Batch.
   - **Run** button, disabled while running.
   - "Load precomputed answer" link when a preset is selected (→ `/outputs/{case_id}`; instant demo fallback).
2. **AgentTimeline** (middle)
   - Vertical timeline grouped by agent: Clarifier, Researcher, Writer, Critic, each with its own colour/icon.
   - Rows from `agent_step`. Tool calls shown as monospace chips. Results collapsible. A spinner on the active agent.
   - Critic rows show ✓/✗ with an issue list.
   - Elapsed-time counter.
   - This panel is key for the *Explainability* criterion, so it should be readable, not a raw log.
3. **ReportView** (right/main, appears on `report`)
   - **DecisionStatusBadge**: green "Provisional assessment" / amber "Insufficient information" / red "Outside supported scope", with `decision_rationale` below.
   - **Summary**.
   - **Requirements**: stated facts (kind=fact), key unknowns, and **PremiseCards** (✓ supported / ✗ refuted / ? unverified). Refuted premises should stand out, since they show the trap cases (H01, H03, H04, H06) were caught.
   - **Clarification questions**: ordered by priority, P1 highlighted, with an `affects` tag and "why it matters" on expand.
   - **Assumptions** list.
   - **RecommendationCards**: one per method with a role badge (primary / comparison / combination / **not recommended** in muted red), technique, rationale claims, conditions and citations.
   - **MeasurementConcept**: 3 sub-blocks (probe geometry / location / fiber link).
   - **SpectralRanges** table: method | range | note | sources.
   - **Risks** list.
   - **FeasibilityPlan**: objective, samples, reference measurements, numbered stepper, comparison, go/no-go box.
   - **Sources**: deduped citation list with evidence-level tags.
   - **VerificationPanel** (collapsible): critic checks, revisions count.
   - **Export**: "Download Markdown" (`/report.md`), "Copy JSON".

**Shared components**
- **ClaimItem**: text + a small `kind` chip. Colours: fact = blue, sourced = green, assumption = amber, inference = grey. Add a legend once at the top of the report.
- **CitationChip**: shows `label`. Hover shows the `quote`. Click opens the **SourceDrawer** (right slide-over) that loads `GET /kb/{source}/pages/{page}`. It shows title, evidence-level tag and page text, and highlights the `quote` if present. EXT citations open the `url` in a new tab and show the quote.
- **EvidenceLevelTag**: e.g. "In vitro proof of concept" in amber for S03, "Business context" in grey for S05/S06.
- **ClarificationPanel** (modal or inline card when `clarification_needed` arrives):
  - "Round {round}/{max_rounds}" header.
  - Shows stated facts + unknowns (collapsed).
  - One textarea per question (P1 first, P1 marked "recommended").
  - Buttons: **Submit answers** (POST answers, `proceed_with_assumptions:false`) and **Proceed with assumptions** (POST `answers:[]`, `proceed_with_assumptions:true`), with the assumptions listed beside the button.
  - After POST, the panel closes and the timeline continues on the same SSE stream.

**Reports page (`/reports`):** grid of cards for D01–D08 and H01–H06 from `/outputs` (case id, title, status badge). Click to open the ReportView. These are the committed, unedited generated answers the jury can inspect.

**Sources page (`/sources`):** table from `/kb/sources`. Click a source to browse its pages using the same SourceDrawer.

## 5. Client state machine
```
idle ──Run──► starting (POST /assessments) ──► running (SSE open)
running ──clarification_needed──► awaiting_clarification ──Submit/Proceed (POST answers)──► running
running ──report──► running (report shown, still streaming) ──done(completed)──► completed
any ──error / done(failed) / POST fails──► failed ──Retry──► starting
```
- Keep `thread_id` in the URL (`/?thread=…`). On page reload, call `GET /assessments/{id}` to restore, and reopen SSE if `status` is `running` or `awaiting_clarification`.
- If the SSE connection drops, `EventSource` auto-reconnects. After 3 failures, fall back to polling the snapshot every 5 s.
- Client-side soft timeout at 5 min: show "taking longer than expected" but keep listening.

## 6. Acceptance checklist (frontend)
- [ ] Health indicator handles cold start gracefully.
- [ ] Presets load from `/cases`. Free text works.
- [ ] Interactive run: timeline streams → clarification panel → answer → report.
- [ ] "Proceed with assumptions" path works.
- [ ] Batch run goes straight to the report.
- [ ] All report sections render from `Report`, including empty arrays (show "None stated").
- [ ] Every CitationChip opens the correct page text. External citations show quote + link.
- [ ] Decision status badge and refuted premises are visible at a glance.
- [ ] `/reports` shows all 14 precomputed reports.
- [ ] Markdown download works.
- [ ] Works on the Vercel URL against the hosted backend (CORS ok).
- [ ] Works fully against `MOCK_MODE=1` and the fixtures in `docs/mock/`.

## 7. Backend-owner commitments for the frontend
- Deliver `docs/mock/*` fixtures + `MOCK_MODE` **first, on the morning of Oct 17**, so frontend work isn't blocked.
- Keep §1–§3 stable. Any change goes to `frontend.md` + a changelog line at the top.
