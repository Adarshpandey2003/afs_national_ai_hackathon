# Understanding the backend architecture

A plain-language walkthrough of the backend: what each route, agent and tool does, how they connect, and **why** it was built this way. Every section links to the code.

> Line numbers are as of writing. If a link lands slightly off, search the file for the function name.

---

## 0. The 30-second version

A customer writes an enquiry ("We want to measure water in petroleum with MIR ATR, reuse our silica cable, can you approve?"). The backend:

1. **Clarifier** reads it and lists what the client *said*, what they *assume*, and what is *missing*. If a person is present, it asks them questions.
2. **Researcher** searches the AFS documents with tools, the way an engineer flips through the brochures, and collects the pages it relies on into an **evidence pack**.
3. **Writer** turns everything into a structured report with a citation on every claim.
4. **Critic** checks the report: some checks in plain Python, some by an LLM acting as a strict reviewer. If something is wrong, the Writer fixes it, up to 2 times.
5. The report is streamed to the browser and can be exported as Markdown.

```
Browser ──HTTP──► api.py ──thread──► pipeline.py (LangGraph)
                     ▲                    │
                     │  SSE events        ├─ clarifier.py   (agent 1)
                     └────────────────────┤─ researcher.py  (agent 2) ──► tools.py ──► retrieval.py ──► kb/
                                          └─ writer_critic.py (agent 3) ──► checks.py
```

---

## 1. The files at a glance

| File | Role in one sentence |
|---|---|
| [backend/api.py](backend/api.py) | The web server: HTTP routes, live event stream, keeps track of running assessments. |
| [backend/afs/pipeline.py](backend/afs/pipeline.py) | The "conductor": wires the agents into a LangGraph graph and assembles the final report. |
| [backend/afs/agents/clarifier.py](backend/afs/agents/clarifier.py) | Agent 1: requirements, premises, unknowns, questions. |
| [backend/afs/agents/researcher.py](backend/afs/agents/researcher.py) | Agent 2: ReAct loop that calls tools to collect evidence. |
| [backend/afs/agents/writer_critic.py](backend/afs/agents/writer_critic.py) | Agent 3: writes the report, then reviews it. |
| [backend/afs/tools.py](backend/afs/tools.py) | The 4 tools the researcher can call, plus the evidence pack. |
| [backend/afs/checks.py](backend/afs/checks.py) | The critic's checks that need no LLM (citations, numbers, completeness). |
| [backend/afs/retrieval.py](backend/afs/retrieval.py) | Loads the knowledge base and runs hybrid search (vector + keyword). |
| [backend/afs/llm.py](backend/afs/llm.py) | Talks to DeepSeek; gets JSON back that matches our schemas. |
| [backend/afs/schemas.py](backend/afs/schemas.py) | The shape of a report (Pydantic models), shared with the frontend. |
| [backend/afs/render.py](backend/afs/render.py) | Turns a report into Markdown. |
| [backend/run_eval.py](backend/run_eval.py) | Runs cases from the command line and saves `outputs/<ID>.json/.md`. |
| [kb/](kb/) | The knowledge base: page texts, chunks, tables, cases, search index. |

---

## 2. The knowledge base (what the agents can know)

Everything the assistant "knows" comes from `kb/`, built once by [kb/build_kb.py](kb/build_kb.py) and [kb/build_index.py](kb/build_index.py).

| File | What's inside | Who uses it |
|---|---|---|
| `pages.jsonl` | 65 pages (S01–S06), each with source, page, **evidence level** and text | `get_page` tool, `/kb/.../pages/...` route, critic |
| `chunks.jsonl` | 243 search chunks, each inside one page | `search_kb` tool |
| `methods.json` | S01 Table 1 + method overview (nominal ranges) | `method_table`, `fiber_check`, writer prompt |
| `fibers.json` | Fiber families with ranges in µm | `fiber_check`, writer prompt |
| `sources.json` | Per source: title, evidence level, **scope note** | Every tool result shows the scope |
| `cases.json` | D01–D08, H01–H06 enquiry texts | `/cases` route, `run_eval.py` |
| `reference/*.md` | Organisers' guidelines + worked D01/D02 answers | Writer prompt |
| `index/` | FAISS vector index (generated) | `search_kb` |

**Why it's built this way:**
- **Pages, not documents.** Citations must say "S02 p.6", so every piece of text remembers its page.
- **Evidence levels.** S03 is "in vitro proof of concept, 14 samples from 7 patients". Attaching that to every page lets the agents judge on their own that it can't prove surgical readiness. This is general information about the source, not a rule written for one case.
- **Table 1 from the xlsx and the slides via vision OCR.** The PDF text of S01 p.6 is scrambled, and S02 is all images. Without these fixes the most important facts (method table, fiber ranges) would be missing.

How the KB is loaded: [`KnowledgeBase`](backend/afs/retrieval.py#L38) reads all those files into memory; [`get_kb()`](backend/afs/retrieval.py#L123) caches it, so it is loaded only once.

---

## 3. The web server: `api.py`

### 3.1 Startup (warm start)
[`lifespan()`](backend/api.py#L39) runs **once when the server starts**. It loads the KB, the search index and the embedding model, and runs one dummy search.
**Why:** otherwise the first user's run would pay several seconds of loading inside the first tool call.

### 3.2 How a run is tracked: the `Run` class
[`class Run`](backend/api.py#L81) is one assessment. Think of it as a mailbox between the web server and the agent pipeline:

| Method | What it does | Why |
|---|---|---|
| [`emit(event, data)`](backend/api.py#L94) | Appends an event (`agent_step`, `report`, …) to `run.events`. | The SSE stream reads from this list, so a reconnecting browser can replay what it missed. |
| [`ask(payload)`](backend/api.py#L101) | Sets the status to `awaiting_clarification`, emits the questions, then **waits** (blocks) until answers arrive (30-min timeout → proceed with assumptions). | The simplest way to pause an agent mid-run for a human. No LangGraph checkpointing needed. |
| [`reply(answers, proceed)`](backend/api.py#L113) | Puts the user's answers in a queue, which wakes up `ask()`. | Thread-safe hand-over between the HTTP thread and the agent thread. |
| [`execute()`](backend/api.py#L116) | Runs the whole pipeline; emits `report` or `error`, then `done`. | Every failure becomes an event the UI can show, never a silent hang. |

All runs live in the dict [`RUNS`](backend/api.py#L132), in memory.
**Why in memory:** simple and fast for a hackathon. Trade-off: deploy only one server instance, and a restart forgets runs that are in progress.

**Why a thread per run:** the agents make slow, blocking LLM calls (minutes). Each run gets its own `threading.Thread` ([start_assessment](backend/api.py#L192)), so the server stays responsive to other requests and to the event stream.

### 3.3 Routes

| Route | Code | What happens |
|---|---|---|
| `GET /health` | [health](backend/api.py#L172) | Says "ok" and whether a DeepSeek key is configured. The UI polls this to detect a sleeping free-tier server. |
| `GET /cases`, `/cases/{id}` | [list_cases](backend/api.py#L178), [get_case](backend/api.py#L183) | Returns D01–D08 / H01–H06 texts for the preset dropdown. |
| `POST /assessments` | [start_assessment](backend/api.py#L191) | Validates the enquiry (20–4000 chars), creates a `Run`, starts its thread, and returns `thread_id` immediately. |
| `GET /assessments/{id}/events` | [assessment_events](backend/api.py#L199) | **Server-Sent Events.** Loops over `run.events` and sends each one with an `id`; checks every 0.3 s for new ones; stops after `done`. Honours `Last-Event-ID`, so a reconnecting browser gets only the events it missed. Pings every 15 s to keep proxies from closing the connection. |
| `POST /assessments/{id}/answers` | [answer_clarification](backend/api.py#L220) | Only allowed while the run is waiting (otherwise 409). Calls `run.reply(...)`. |
| `GET /assessments/{id}` | [assessment_snapshot](backend/api.py#L229) | The current state in one JSON object (for page reloads). |
| `GET /assessments/{id}/report.md` | [assessment_markdown](backend/api.py#L236) | The report as Markdown via [render_markdown](backend/afs/render.py#L23). |
| `GET /kb/sources` | [kb_sources](backend/api.py#L244) | Source list with evidence levels. |
| `GET /kb/{source}/pages/{page}` | [kb_page](backend/api.py#L250) | The exact page text, opened when a user clicks a citation. |
| `GET /outputs`, `/outputs/{id}` | [list_outputs](backend/api.py#L263), [get_output](backend/api.py#L273) | Precomputed reports from `outputs/`, shown instantly (demo fallback). |

**Errors:** [`ApiError`](backend/api.py#L62) plus two handlers ([1](backend/api.py#L68), [2](backend/api.py#L73)) make every error look like `{"error": {"code", "message"}}`, as promised in `frontend.md`.

**Why SSE and not WebSockets:** traffic only flows server → browser (events). SSE is plain HTTP, reconnects automatically, and is supported natively by `EventSource`. The few client → server messages (start, answers) are ordinary POSTs.

---

## 4. The conductor: `pipeline.py`

[`build_graph(ctx)`](backend/afs/pipeline.py#L49) builds a **LangGraph state graph**. The state ([`State`](backend/afs/pipeline.py#L36)) is a dict that each step reads and adds to: `intake`, `answers`, `toolbox`, `notes`, `draft`, `checks`, `issues`, `revision`.

```
START → clarify → research → write → review ─┬─(errors and revision ≤ 2)─► write
                                             └─(passed, or limit reached)──► END
```

| Node | Code | Calls |
|---|---|---|
| `clarify` | [L50](backend/afs/pipeline.py#L50) | `run_clarifier` |
| `research` | [L54](backend/afs/pipeline.py#L54) | creates a fresh `Toolbox` and calls `run_researcher` |
| `write` | [L58](backend/afs/pipeline.py#L58) | `write_report` (passes the previous draft + issues on revisions) |
| `review` | [L66](backend/afs/pipeline.py#L66) | `critique`; increases `revision` if any error remains |
| decision | [`after_review`](backend/afs/pipeline.py#L73) | back to `write`, or finish |

[`run_assessment()`](backend/afs/pipeline.py#L90) is the only function the API calls. It runs the graph, then:
- rebuilds `sources` from the citations the report actually uses ([L102](backend/afs/pipeline.py#L102)), so the list can't contain unused or invented entries;
- adds an `expert_review` entry summarising the LLM critic ([L106](backend/afs/pipeline.py#L106));
- wraps everything in a `Report` with `enquiry`, `user_answers`, `verification` and `meta` (model, mode, time, duration).

**`ctx` (the [RunContext](backend/afs/pipeline.py#L31)):** the pipeline doesn't know about HTTP. It only calls `ctx.emit()` and `ctx.ask()`. The API passes its `Run` object; `run_eval.py` passes a [PrintContext](backend/run_eval.py) that prints to the console.
**Why:** the same pipeline runs in the web app and in batch mode, and can be tested without a server.

**Why LangGraph:** the flow has a loop (write ⇄ review) and shared state. A graph makes that loop explicit and bounded (`recursion_limit`, `MAX_REVISIONS`) instead of hiding it in nested `while` loops.

---

## 5. Agent 1: Clarifier ([clarifier.py](backend/afs/agents/clarifier.py))

**Job:** understand the enquiry before anyone recommends anything.

**Output** ([`Intake`](backend/afs/agents/clarifier.py#L36)):

| Field | Meaning | H04 example |
|---|---|---|
| `stated_facts` | Only what the client said | "Analyzer in another building" |
| `requested_variables` | What they want measured or decided | "water content" |
| `client_premises` | Claims that **must be checked**, not believed | "Our silica cable can be reused for MIR ATR" |
| `key_unknowns` | Missing information that matters | "link length", "water range" |
| `questions` | ≤ 6, priority 1 = could change the method or setup | "What is the link length?" |
| `assumptions` | Used if questions stay open, labelled as assumptions | "Feasibility study, not a final design" |
| `scope_concerns` | Request asks for more than a first assessment can give | "Asks for approval" |

**How it works** ([`run_clarifier`](backend/afs/agents/clarifier.py#L54)):
1. One JSON call with the `SYSTEM` prompt ([L13](backend/afs/agents/clarifier.py#L13)) via `ask_json(..., model=fast_model())` ([L59](backend/afs/agents/clarifier.py#L59)).
2. Questions are sorted and numbered (`q1`… in round 1, `q2.1`… later).
3. **Batch mode:** stop here.
   **Interactive mode:** if any P1 question is open, call `ctx.ask(...)` ([L70](backend/afs/agents/clarifier.py#L70)). The run pauses and the UI shows the questions.
4. Answers are added to the prompt and the clarifier runs again. It repeats up to [`MAX_ROUNDS = 3`](backend/afs/agents/clarifier.py#L11), or until the user picks "proceed with assumptions" or sends no answers.

**Why:**
- **`client_premises` is the key idea.** The evaluation cases hide false premises ("Raman will keep the old calibration valid", "reuse the silica cable", "quote the study as proof"). Making premise extraction an explicit step means the rest of the pipeline is forced to judge each one. This works for any enquiry, so nothing is hard-coded per case.
- **It never invents answers.** The organisers' rules say unknowns must be asked about or stated as assumptions.
- **Model: `deepseek-flash` with reasoning on.** Fast enough (about 10–30 s), and the reasoning keeps premise extraction careful.

---

## 6. Agent 2: Researcher ([researcher.py](backend/afs/agents/researcher.py))

**Job:** collect evidence for every requested variable and every premise. It does **not** write the answer.

**How it works** ([`run_researcher`](backend/afs/agents/researcher.py#L46)):
- Built with LangChain's [`create_agent`](backend/afs/agents/researcher.py#L48), which is a **ReAct loop**: the model thinks → calls a tool → reads the result → thinks again… until it writes its final notes.
- The `SYSTEM` prompt ([L17](backend/afs/agents/researcher.py#L17)) gives a checklist: methods per variable, evidence for/against each premise, `fiber_check` if fibers are involved, limitations, the scope of the evidence.
- **[`ToolCallLimitMiddleware`](backend/afs/agents/researcher.py#L49) (12 calls):** after 12 tool calls further calls are refused, so the agent writes its notes. `exit_behavior="continue"` means it isn't cut off mid-thought.
- `STEP_LIMIT` plus the [`GraphRecursionError` fallback](backend/afs/agents/researcher.py#L76) is a safety net if something loops.
- Every tool call and result is sent with `ctx.emit("agent_step", ...)`, so the UI timeline shows "search_kb('silica fiber MIR range') → S02 p.6".
- The final notes are Markdown: candidate methods, premise verdicts, spectral ranges, limitations, evidence gaps.

**Why:**
- **ReAct instead of one fixed search:** questions differ per enquiry. A fixed "top-5 search" missed key pages, while an agent that can rephrase, read full pages and run calculations finds them.
- **12-call cap:** without it the agent once made 28 calls (about 4 minutes) for no better result.
- **Model: `deepseek-flash` with reasoning OFF** (`thinking=False`): the loop is many short decisions, and turning reasoning off makes each step about 4× faster. Quality is protected because the tools do the precise work and the writer and critic come after.

---

## 7. The tools ([tools.py](backend/afs/tools.py))

All tools live inside a [`Toolbox`](backend/afs/tools.py#L38) created fresh for every run. Every page a tool returns is **recorded in the evidence pack**: the list of pages the writer is allowed to cite.

| Tool | Code | What it does | Example |
|---|---|---|---|
| `search_kb(query, sources?)` | [L77](backend/afs/tools.py#L77) | Hybrid search, returns the 5 best chunks with labels and evidence levels. Records the chunks. | "water content petroleum ATR" → S02 p.13 |
| `get_page(source, page)` | [L90](backend/afs/tools.py#L90) | Full text of one page plus its scope note. Records the whole page. | `get_page("S03", 1)` → abstract + "in vitro PoC" |
| `method_table(method?, sample_type?)` | [L103](backend/afs/tools.py#L103) | Rows of S01 Table 1 + the method overview (ranges, limitations). | method="fluor" → sensitivity high, selectivity low |
| `fiber_check(fiber, method? / spectral_range?)` | [L125](backend/afs/tools.py#L125) | **Calculation, not search.** Converts everything to µm and compares the fiber's range with the method's range: full / partial / **no overlap**. | Vis-NIR silica (0.35–2.4 µm) vs MIR (2.5–25 µm) → NO OVERLAP |

**Evidence pack helpers:**
- [`ALWAYS_INCLUDED`](backend/afs/tools.py#L10): S01 p.6 (Table 1) and S02 p.6 (fiber ranges) are always in the pack. They are the two most-needed reference pages, so retrieval can never miss them.
- [`record_page`](backend/afs/tools.py#L56): lets the critic's repair step add a real page the writer cited.
- [`evidence_text()`](backend/afs/tools.py#L63): formats the pack for the writer: full page text if the page was read, otherwise only the retrieved chunks, each with its evidence level.

**Why `fiber_check` is code, not LLM:** LLMs are unreliable at unit conversions (nm ↔ µm ↔ cm⁻¹) and range overlaps. A 20-line deterministic function gives the same correct answer every time and cites S02 p.6. The H04 trap then becomes general arithmetic, not a special rule.

**Why an evidence pack:** "Cite only what you actually looked at" is how a careful engineer works, and it lets the critic verify citations mechanically.

---

## 8. Search: `retrieval.py`

[`HybridRetriever.search()`](backend/afs/retrieval.py#L98) runs two searches and merges them:

```
query ─┬─► embed (bge-small, local) ─► FAISS cosine ─► top 30 by meaning  ─┐
       └─► tokenize ─► BM25 ─────────────────────────► top 30 by keywords ─┴─► RRF ─► top k
```

- **Dense (meaning):** [`_Embedder`](backend/afs/retrieval.py#L57) turns text into vectors with a small local model. FAISS finds the closest chunks.
- **BM25 (keywords):** built in memory at startup ([L87](backend/afs/retrieval.py#L87)).
- **Fusion (RRF):** each chunk gets `1/(60 + rank)` from each list ([L114](backend/afs/retrieval.py#L114)). Chunks ranked well by both lists win.

**Why both:**
- **Meaning-based search** finds paraphrases: "can silica carry mid-IR" matches the "Transmission for Different Fibers" slide.
- **Keyword search** finds exact technical terms such as `NADH`, `ZrO2` or `785 nm`. In tests, S01 p.5 ("most chemicals do not fluoresce") was only #6 by meaning but #1 by keywords; fusion brought it to the top.

**Why local, not a hosted vector DB:** 243 chunks fit in memory easily. It's free, works offline and needs no extra service to deploy.

---

## 9. Agent 3: Writer + Critic ([writer_critic.py](backend/afs/agents/writer_critic.py))

### 9.1 Writer: [`write_report`](backend/afs/agents/writer_critic.py#L73)

**Input:** enquiry, client answers, intake, research notes, the reference tables and the **evidence pack**.
**System prompt:** [`WRITER_SYSTEM`](backend/afs/agents/writer_critic.py#L14), plus the organisers' guidelines and the worked D01/D02 examples.
**Output:** a [`ReportBody`](backend/afs/schemas.py#L106), validated by Pydantic.

Key rules in the prompt, and why:

| Rule | Why |
|---|---|
| Every claim has a `kind`: fact / sourced / inference / assumption | The organisers asked to keep these "visibly separate"; the UI colour-codes them. |
| Cite only pages in EVIDENCE | Makes citations checkable. |
| Every premise gets supported / refuted / unverified | Forces the trap cases to be judged explicitly. |
| `decision_status` has 3 clear definitions | "Insufficient information" or "outside scope" can be the right answer. |
| `role: not_recommended` exists | Lets the report say clearly "your proposed approach is not supported". |
| No invented numbers, specs or client facts | The organisers' most important "do not invent" list. |

**On a revision**, the previous draft and the critic's issues are added, and the writer returns a corrected full report.

**Model:** `deepseek-v4-pro` with reasoning ON. This is the step where quality matters most, so it gets the strongest settings, even though it is the slowest step (about 60–160 s).

### 9.2 Critic: [`critique`](backend/afs/agents/writer_critic.py#L92)

Runs in this order:

1. **Repair** ([`repair_citations`](backend/afs/checks.py#L86), called at [L98](backend/afs/agents/writer_critic.py#L98)):
   - cited a real page that isn't in the pack → add the page to the pack;
   - cited a page that doesn't exist → remove the citation and downgrade "sourced" to "inference".

   *Why:* these are mechanical problems. Fixing them in code saves a whole rewrite (about 100 s) without weakening anything, because the LLM critic still reads the added page.

2. **Deterministic checks** ([`run_checks`](backend/afs/checks.py#L125)), no LLM:

   | Check | What it verifies |
   |---|---|
   | `citations_valid` | Every citation points to an evidence page; external sources need a URL and a quote. |
   | `numbers_supported` | Every number with a unit appears in the sources or in the client's text. |
   | `sections_complete` | Questions, recommendations, risks, at least 2 plan steps and sources are present. |
   | `premises_addressed` | At least as many premise verdicts as the clarifier found premises. |

3. **LLM review** ([L116](backend/afs/agents/writer_critic.py#L116)) with [`CRITIC_SYSTEM`](backend/afs/agents/writer_critic.py#L46). It receives the draft, the automated check results and the **full text of every cited page**. It judges citation scope, invented facts, premise verdicts, decision status, question quality and the practicality of the plan. Each issue is marked "error" or "warning".

4. If any **error** remains, the pipeline loops back to the writer (up to `MAX_REVISIONS`).

**Why two kinds of checks:**
- **Code checks** are perfect at mechanical rules (a page exists, a number appears in the sources), but can't judge meaning.
- **The LLM review** judges meaning ("this lab study is cited as proof of process readiness"), but can miss details.
- Together they cover each other's blind spots.

**Model:** `deepseek-v4-pro` with reasoning OFF. Review is a comparison task and the code checks are the backstop, so this is about 4× faster.

### 9.3 The number check in detail ([checks.py](backend/afs/checks.py))
This is the strongest guard against invented specifications.
- [`quantities()`](backend/afs/checks.py#L31) finds "number + unit" in the **report** (strict).
- [`nearby_quantities()`](backend/afs/checks.py#L44) finds numbers in the **sources**, with any unit within 60 characters (lenient). OCR tables often put the unit in another cell, as in `| 3750 | cm⁻¹ |`.
- [`_normalise()`](backend/afs/checks.py#L22) converts nm, µm and cm⁻¹ all to µm, so "2500 nm", "2.5 µm" and "4000 cm⁻¹" count as the same number.
- [`_supported()`](backend/afs/checks.py#L56) allows 1 % tolerance for rounding.

Result: "37 ppm detection limit" (invented) is flagged; "350–2400 nm" (from S02 p.6) passes.

---

## 10. Talking to the LLM: `llm.py`

- [`chat()`](backend/afs/llm.py#L22): creates a DeepSeek client through the OpenAI-compatible API.
  - **`max_tokens=16000`.** DeepSeek models "think" before answering, and the thinking counts against the token limit. With a small limit, the answer came back **empty** (we hit this during OCR).
  - **`thinking=False`** sends `{"thinking": {"type": "disabled"}}` to skip the thinking phase. Measured: 2 s instead of 9 s for the same task.
- [`ask_json()`](backend/afs/llm.py#L39): asks for a JSON object, appending the Pydantic schema to the system prompt, then **validates** the reply. If validation fails, the error is sent back ("That JSON is invalid: …") and the model fixes it, up to 2 retries.
  **Why:** DeepSeek's JSON mode guarantees valid JSON, but not *our* structure. Validate-and-repair makes every agent output safe to use downstream.

| Where | Model | Thinking | Reason |
|---|---|---|---|
| Clarifier | flash | on | Careful premise extraction, still fast |
| Researcher | flash | off | Many small tool decisions; speed |
| Writer | v4-pro | on | Answer quality lives here |
| Critic | v4-pro | off | Comparison task + code backstop |
| OCR (KB build) | flash | on | The only model that accepts images |

---

## 11. The data model: `schemas.py`

[`Report`](backend/afs/schemas.py#L122) extends [`ReportBody`](backend/afs/schemas.py#L106):
- `ReportBody` is what the **writer** produces;
- `Report` adds what the **pipeline** knows: `enquiry`, `user_answers`, `verification`, `meta`, `case_id`.

**Why split it:** the LLM shouldn't waste tokens (or make mistakes) copying the enquiry or inventing timestamps.

The same structure is written out in `frontend.md` §3 and `frontend/src/api/types.ts`. **One contract** means the frontend can render any report without special cases.

---

## 12. One request, start to finish (H04)

```
 0 s   POST /assessments {"enquiry": "...silica cable...MIR ATR...approve?", "mode": "batch"}
       → Run created, thread started, browser opens GET /events
 0 s   clarifier: 6 facts, 4 premises ("silica cable reusable", "concept approvable", ...)
15 s   researcher: method_table(MIR) · fiber_check(silica, MIR) → NO OVERLAP · get_page(S02, 13)
       → water-in-petroleum slide · search_kb("remote analyzer long cable") → S02 p.7 ...
       evidence pack: 15 pages
39 s   writer (v4-pro, thinking): premises → "silica reuse: REFUTED [S02 p.6]",
       "approval: REFUTED"; MIR ATR with a MIR-capable fiber as the option to test;
       status outside_supported_scope
162 s  critic: repair (nothing to fix) · 4 code checks pass · LLM review: no errors
168 s  report event → UI renders it; done
```

---

## 13. Design decisions, summarised

| Decision | Why | Trade-off |
|---|---|---|
| 3 agents (clarify / research / write + critique) | Mirrors how an expert works; each step is visible in the UI | More LLM calls than one big prompt |
| Explicit `client_premises` | Catches false premises generally, with no per-case rules | Relies on the clarifier spotting them |
| Evidence pack + "cite only evidence" | Citations become verifiable | The writer can't cite pages the researcher didn't open (mitigated by repair) |
| `fiber_check` in code | Exact unit maths, same answer every time | Only covers ranges the sources give (NIR, MIR, fibers) |
| Code checks + LLM critic | Mechanical rules and meaning both covered | Adds about 10 s per review |
| Auto-repair before review | Avoids rewrites for mechanical issues | — |
| Local hybrid search | Free, offline, accurate on technical terms | Index must be rebuilt when the KB changes |
| Reasoning only where it matters | About 2× faster overall | Researcher and critic are slightly less careful (backed by tools and code checks) |
| Thread per run + blocking `ask()` | Easiest way to pause for a human | Single instance only; in-memory state |
| SSE events with replay | Live, reconnect-safe progress | Server keeps all events of a run in memory |
| `ReportBody` vs `Report` | The LLM writes only what it can know | Two classes to keep in sync |

---

## 14. Where to change things

| You want to… | Change |
|---|---|
| Use other models | `.env`: `LLM_MODEL`, `FAST_LLM_MODEL` |
| Allow more or fewer rewrites | `.env`: `MAX_REVISIONS` |
| Change how many questions are asked | `MAX_ROUNDS` in [clarifier.py](backend/afs/agents/clarifier.py#L11) and the "at most 6" in its `SYSTEM` prompt |
| Give the researcher more or fewer tool calls | `TOOL_CALL_LIMIT` in [researcher.py](backend/afs/agents/researcher.py#L14) |
| Add a tool | A new `_xxx()` method in [`Toolbox`](backend/afs/tools.py#L38) returning a `@tool`; add it to `self.tools` |
| Add a critic check | Append a `VerificationCheck` in [`run_checks`](backend/afs/checks.py#L125) |
| Change the report structure | [schemas.py](backend/afs/schemas.py), then `frontend.md` §3 and `frontend/src/api/types.ts` |
| Add documents | UI *Knowledge base → Add a document*, `POST /kb/documents`, or `python kb/ingest.py <file> --title ...` (incremental; the new source gets the next ID, e.g. S07). The source list lives in [kb/sources.yaml](kb/sources.yaml) |
