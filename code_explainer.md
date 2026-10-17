# Code explainer: the backend, block by block

A companion to [understand_arc.md](understand_arc.md). That file explains the architecture; this one walks through the **code itself**, block by block, in plain language.

Sections follow the same order as understand_arc.md:

| § | File | Role |
|---|---|---|
| 4 | [pipeline.py](backend/afs/pipeline.py) | the conductor |
| 5 | [agents/clarifier.py](backend/afs/agents/clarifier.py) | agent 1 |
| 6 | [agents/researcher.py](backend/afs/agents/researcher.py) | agent 2 |
| 7 | [tools.py](backend/afs/tools.py) | the researcher's tools + evidence pack |
| 8 | [retrieval.py](backend/afs/retrieval.py) | knowledge base + hybrid search |
| 9 | [agents/writer_critic.py](backend/afs/agents/writer_critic.py) + [checks.py](backend/afs/checks.py) | agent 3 |
| 10 | [llm.py](backend/afs/llm.py) | talking to DeepSeek |
| 11 | [schemas.py](backend/afs/schemas.py) | the report's shape |

Each block shows the line range, a short code excerpt, **what it does**, and **why** where the reason isn't obvious.

---

## 4. `pipeline.py`: the conductor

### 4.1 Docstring: the contract with the API ([L1–11](backend/afs/pipeline.py#L1-L11))
Describes the two things the pipeline may do with the outside world:
- `ctx.emit(event, data)` sends a progress event to the browser;
- `ctx.ask(payload)` asks the user questions and **waits** for the reply.

**Why:** the pipeline never touches HTTP. Anything that implements these two methods can drive it: the web server's `Run` class, or `run_eval.py`'s `PrintContext`.

### 4.2 Imports and settings ([L12–28](backend/afs/pipeline.py#L12-L28))
```python
from langgraph.graph import END, START, StateGraph
...
MAX_REVISIONS = int(os.environ.get("MAX_REVISIONS", "2"))
```
- Brings in LangGraph (the graph engine), the three agents, the helper `citations()`, the KB loaders and the schemas.
- `MAX_REVISIONS` is how many times the writer may rewrite after a failed review. It's read from `.env`, defaulting to 2.

### 4.3 `RunContext` ([L31–33](backend/afs/pipeline.py#L31-L33))
```python
class RunContext(Protocol):
    def emit(self, event: str, data: dict) -> None: ...
    def ask(self, payload: dict) -> dict: ...
```
A **Protocol** is a type-only description: "any object with these two methods". No inheritance is needed. It documents the contract and lets editors type-check it.

### 4.4 `State` ([L36–46](backend/afs/pipeline.py#L36-L46))
```python
class State(TypedDict, total=False):
    enquiry, mode, intake, answers, toolbox, notes, draft, checks, issues, revision
```
The **shared notebook** passed between graph steps. Each step reads what it needs and returns only the keys it adds or changes; LangGraph merges them in. `total=False` means keys can be missing at the start (for example, `draft` doesn't exist until the writer has run).

| Key | Filled by | Contains |
|---|---|---|
| `enquiry`, `mode` | start | the customer text; `"interactive"` or `"batch"` |
| `intake`, `answers` | clarify | the `Intake` object; the user's answers |
| `toolbox`, `notes` | research | tools + evidence pack; the research notes |
| `draft` | write | the current `ReportBody` |
| `checks`, `issues`, `revision` | review | check results; all problems; how many rewrites so far |

### 4.5 `build_graph(ctx)`: the four steps ([L49–75](backend/afs/pipeline.py#L49-L75))
Each step is a small inner function that receives the state and returns a dict of updates. They are defined *inside* `build_graph` so they can use `ctx` without passing it around.

- **`clarify`** ([L50–52](backend/afs/pipeline.py#L50-L52)): calls `run_clarifier` and stores `intake` and `answers`.
- **`research`** ([L54–56](backend/afs/pipeline.py#L54-L56)): creates a **fresh `Toolbox`** (so every run has its own evidence pack), runs the researcher, and stores the toolbox and the notes.
- **`write`** ([L58–64](backend/afs/pipeline.py#L58-L64)):
  ```python
  draft = write_report(..., previous=s.get("draft") if revision else None, issues=s.get("issues"))
  ```
  On the first pass (`revision == 0`), the writer starts fresh. On later passes it receives its previous draft and the critic's issues, so it fixes instead of starting over. It emits `agent_start` and `draft_ready` for the UI timeline.
- **`review`** ([L66–71](backend/afs/pipeline.py#L66-L71)): calls `critique`, which returns the checks and all issues. `passed` is true if no issue has severity `"error"`. If it failed, `revision` goes up by 1. Emits `critic_result`.
- **`after_review`** ([L73–75](backend/afs/pipeline.py#L73-L75)): the **decision point**.
  ```python
  return "write" if failed and s["revision"] <= MAX_REVISIONS else END
  ```
  Errors remain and the limit isn't reached → go back to `write`. Otherwise → finish.
  *Counting:* first review fails → revision 1 → rewrite; fails again → 2 → rewrite; fails a third time → 3 > 2 → stop. So at most **2 rewrites**.

### 4.6 Wiring the graph ([L77–87](backend/afs/pipeline.py#L77-L87))
```python
graph.add_edge(START, "clarify"); graph.add_edge("clarify", "research")
graph.add_edge("research", "write"); graph.add_edge("write", "review")
graph.add_conditional_edges("review", after_review)
return graph.compile()
```
- **Fixed arrows** for the straight path.
- **One conditional arrow** after `review`, which asks `after_review` where to go next.
- `compile()` turns the description into a runnable object.

### 4.7 `run_assessment()`: run it and package the result ([L90–116](backend/afs/pipeline.py#L90-L116))
1. **Run the graph** ([L91–94](backend/afs/pipeline.py#L91-L94)) with `recursion_limit: 25`, a safety cap on total steps. Takes the final `draft` and `issues` out of the state.
2. **Rebuild the source list** ([L96–102](backend/afs/pipeline.py#L96-L102)): walks every citation in the draft and keeps each label once.
   *Why:* the writer's own `sources` list could include pages it never actually cited, or miss some. Rebuilding makes it exactly match the citations used.
3. **Add an `expert_review` check** ([L104–108](backend/afs/pipeline.py#L104-L108)): summarises the LLM critic's issues. The filter `i["check"] not in {c.name ...}` skips issues that are just copies of failed code checks, so nothing is listed twice.
4. **Build the final `Report`** ([L109–116](backend/afs/pipeline.py#L109-L116)):
   - `**draft.model_dump()` copies every writer field;
   - adds `enquiry`;
   - adds `user_answers`, converted to `UserAnswer` objects;
   - adds `verification`: `passed` only if every check passed, and `revisions` capped at `MAX_REVISIONS`, the number of rewrites actually done;
   - adds `meta`: model name, mode, a UTC timestamp and the duration in seconds.

---

## 5. `agents/clarifier.py`: agent 1

### 5.1 Docstring and imports ([L1–11](backend/afs/agents/clarifier.py#L1-L11))
Explains the two modes. Imports `ask_json` (one validated JSON call to the LLM) and `fast_model` (flash). `MAX_ROUNDS = 3` caps how many times the user can be asked.

### 5.2 `SYSTEM` prompt ([L13–33](backend/afs/agents/clarifier.py#L13-L33))
The instructions the LLM receives. Line by line:
- *"You do not recommend methods yet"* keeps this step focused.
- *"Anything not stated is unknown. Never add facts…"* is the organisers' main rule against inventing client data.
- One rule per output field. **`client_premises`** lists *what kinds of things* count: a proposed method or justification, reuse of equipment or calibrations, a requested certainty, readiness or approval. These categories are general, so they work for any enquiry, not just H01–H06.
- Question priorities: 1 = could change the method or setup; 2 = shapes the plan; 3 = acceptance details.
- `assumptions` must be phrased as assumptions, never as facts.

### 5.3 `Intake` model ([L36–43](backend/afs/agents/clarifier.py#L36-L43))
```python
class Intake(BaseModel):
    stated_facts: list[str]; requested_variables: list[str]; client_premises: list[str]
    key_unknowns: list[str]; questions: list[Question]; assumptions: list[str]; scope_concerns: list[str]
```
The exact shape the LLM must return. `ask_json` sends this schema to the model and rejects replies that don't match. `Question` is reused from `schemas.py`, so the frontend can render the questions directly.

### 5.4 `_prompt()` ([L46–51](backend/afs/agents/clarifier.py#L46-L51))
Builds the user message: the enquiry, plus, from round 2 on, every earlier question and answer as `Q:` / `A:` pairs. The model therefore always sees the full conversation and won't ask the same thing twice.

### 5.5 `run_clarifier()`: the loop ([L54–82](backend/afs/agents/clarifier.py#L54-L82))
- **[L57]** `for round_no in range(1, MAX_ROUNDS + 1)`: at most 3 rounds.
- **[L58]** Tells the UI "clarifier, round N started".
- **[L59]** One LLM call, returning a validated `Intake`.
- **[L60–62]** Sorts the questions by priority (P1 first), then numbers them: `q1, q2…` in round 1, `q2.1, q2.2…` in round 2. **Why:** IDs stay unique across rounds, so answers can't get mixed up.
- **[L63–66]** Sends a short summary to the UI ("6 stated facts, 4 premises…") plus the full intake as a collapsible preview.
- **[L68–69]** **Stop conditions:** batch mode, the last round reached, or no P1 question left (nothing that could change the method is open).
- **[L70–75]** `ctx.ask(...)` **pauses here** until the user replies. The payload matches `clarification_needed` in `frontend.md`. Stated facts are wrapped as `Claim` objects with `kind: "fact"` so the UI can show them.
- **[L76–79]** Matches each answer to its question text by ID, keeps only non-empty answers, and adds them to `answers`.
- **[L80–81]** Stops if the user clicked "proceed with assumptions" or gave no answers.
- **[L82]** Returns the **last** intake (built with all the answers) and the answers.

---

## 6. `agents/researcher.py`: agent 2

### 6.1 Imports and limits ([L1–15](backend/afs/agents/researcher.py#L1-L15))
- `create_agent` is LangChain's ready-made ReAct agent, built on LangGraph.
- `ToolCallLimitMiddleware` is a plug-in that counts tool calls.
- `AIMessage` and `ToolMessage` are the message types we inspect to stream progress.
- `TOOL_CALL_LIMIT = 12` is the tool budget. `STEP_LIMIT = 60` is a safety cap on internal graph steps.

### 6.2 `SYSTEM` prompt ([L17–39](backend/afs/agents/researcher.py#L17-L39))
- **Role:** collect evidence, don't write the answer.
- **The 4 tools,** with one line each.
- **A 5-point checklist:** methods per variable; evidence for or against **each premise** ("search with several phrasings"); `fiber_check` when fibers are involved; limitations; scope of the evidence.
- *"At most 12 tool calls; plan them"*, so the model knows its budget up front.
- **A fixed note format** with 5 headings, so the writer always gets the same structure.

### 6.3 `_preview()` ([L42–43](backend/afs/agents/researcher.py#L42-L43))
Shortens long text for the UI (default 400 characters plus "…"). This keeps the event stream light.

### 6.4 `run_researcher()` ([L46–82](backend/afs/agents/researcher.py#L46-L82))
- **[L48–49] Build the agent:**
  ```python
  create_agent(chat(fast_model(), thinking=False), toolbox.tools, system_prompt=SYSTEM,
               middleware=[ToolCallLimitMiddleware(run_limit=TOOL_CALL_LIMIT, exit_behavior="continue")])
  ```
  It uses the flash model with reasoning off (fast loop) and this run's 4 tools. `exit_behavior="continue"` means that once the budget is spent, further tool calls are *refused* and the agent writes its notes, instead of crashing or stopping silently.
- **[L50–52] The task message:** enquiry, client answers, and the intake as JSON **without the questions** (`exclude={'questions'}`). The researcher needs facts and premises, not the question list.
- **[L56–57]** `agent.stream(..., stream_mode="updates")` yields every new message as the agent works, so we can show progress live instead of waiting for the end.
- **[L58–75] Sorting the messages:**
  - **AI message with tool calls** → the model decided to use tools. Any text alongside becomes a `thought` event; each call becomes a `tool_call` event, e.g. `search_kb(query='...')`.
  - **ToolMessage** → a tool's result. The regex `\[(S0\d p\.\d+)\]` pulls page labels out of it, so the UI shows `search_kb: S01 p.17, S02 p.13`.
  - **AI message without tool calls** → the final answer, i.e. the research notes.
- **[L76–77]** If the safety cap is ever hit, it continues with a short note instead of failing. The evidence pack is still usable.
- **[L79–82]** Emits a final note ("Evidence pack: 15 pages" + notes preview) and returns the notes.

---

## 7. `tools.py`: the researcher's tools and the evidence pack

### 7.1 Constants ([L9–11](backend/afs/tools.py#L9-L11))
- `ALWAYS_INCLUDED = [("S01", 6), ("S02", 6)]`: Table 1 and the fiber-range slide are in every evidence pack.
- `SPECTRAL_UNITS`: conversion factors to µm (nm = 0.001; µm and its spelling variants = 1).

### 7.2 Unit helpers ([L14–27](backend/afs/tools.py#L14-L27))
- **`to_um(value, unit)`:** nm and µm are multiplied by the factor. Anything else is treated as a wavenumber in cm⁻¹ and converted with **µm = 10 000 / cm⁻¹** (4000 cm⁻¹ → 2.5 µm).
- **`parse_range_um(text)`:** a regex finds "number – number unit" (accepting `-`, `–` or `to`), converts both ends and sorts them, so `"4000-400 cm-1"` becomes `(2.5, 25.0)` even though the numbers go downward.

### 7.3 `_words()` ([L30–35](backend/afs/tools.py#L30-L35))
Turns a name into a set of lowercase words for fuzzy matching:
- maps synonyms first ("mid-infrared" → "mir", "near infrared" → "nir");
- drops filler words ("fiber", "cable", "the", …).

So `"Vis-NIR silica fiber"` → `{"vis", "nir", "silica"}`.

### 7.4 `Toolbox.__init__` ([L38–44](backend/afs/tools.py#L38-L44))
Stores the KB and the retriever, creates an empty `evidence` dict, adds the two always-included pages, then builds the 4 tools. Each `_xxx()` method returns a tool function that can see `self`, i.e. this run's evidence pack.

### 7.5 Evidence pack methods ([L48–73](backend/afs/tools.py#L48-L73))
- **`_entry(source, page)`:** gets or creates the record for a page: `{label, evidence_level, full_page: False, chunks: {}}`. `setdefault` means "create only if missing".
- **`_record_page`:** marks the page as read in full.
- **`record_page`:** public version used by the critic's repair step; upper-cases the source.
- **`_record_chunk`:** stores a single search excerpt under its chunk ID, so duplicates are ignored.
- **`evidence_text()`:** formats the whole pack for the writer, one block per page:
  ```
  === [S02 p.6] evidence level: vendor_slides (scope note…)
  <full page text, or the retrieved excerpts joined with [...]>
  ```
  Full text if the page was read, otherwise only the excerpts. The scope note travels with every page.
- **`evidence_pages()`:** the set of `(source, page)` pairs, used by the critic to validate citations.

### 7.6 Tool `search_kb` ([L77–88](backend/afs/tools.py#L77-L88))
The `@tool` decorator turns the function into an LLM tool. The **docstring is what the LLM reads** to decide when to use it, which is why it lists what each source contains. It runs the hybrid search (top 5, optional source filter), records each hit as a chunk, and returns the hits as `[S02 p.13] (vendor_slides)` followed by the text.

### 7.7 Tool `get_page` ([L90–101](backend/afs/tools.py#L90-L101))
Looks up the page. If it doesn't exist, it says so politely; the agent can recover. Otherwise it records the full page and returns label, title, evidence level, scope note and the full text.

### 7.8 Tool `method_table` ([L103–123](backend/afs/tools.py#L103-L123))
- Records S01 p.6 in the evidence.
- Filters Table 1 rows by method and sample type using a simple "contains" test; empty filters return everything.
- Formats the rows as a pipe-separated table with a header.
- Adds matching rows from the **method overview** (nominal ranges, limitations, "read" pages), matched with `_words` overlap, so "MIR ATR" matches "MIR (ATR)".

### 7.9 Tool `fiber_check` ([L125–165](backend/afs/tools.py#L125-L165))
Step by step:
1. **[L131]** Records S02 p.6, the source of the fiber ranges.
2. **[L132–137] Find the fiber family:** every word the user gave must be the *start* of a word in the fiber name. So `"hollow waveguide"` matches "Hollow glass **waveguides**", and `"silica"` matches *both* silica families. If nothing matches, it lists the known families.
3. **[L139–148] Find the target range:** from `spectral_range` if given; otherwise from the method's nominal range in the overview (only NIR and MIR have numbers). If neither is available, it asks for an explicit range.
4. **[L150–161] Compare** each matched fiber with the target:
   - overlap = `max(lows) … min(highs)`;
   - nothing in between → **NO OVERLAP**;
   - the fiber covers both ends → **covers the full range**;
   - otherwise → **PARTIAL**, with the covered part.
5. **[L162–163]** Lists every fiber family that overlaps the target at least partly, so the agent immediately sees the alternatives.
6. **[L151–152]** The first line always repeats that the ranges are approximate and must be confirmed by AFS. This is honest uncertainty, built into the tool.

---

## 8. `retrieval.py`: knowledge base and hybrid search

### 8.1 Paths and helpers ([L16–35](backend/afs/retrieval.py#L16-L35))
- `KB_DIR` defaults to `<repo>/kb` and can be overridden with `AFS_KB_DIR` (useful in Docker).
- `EMBED_MODEL` is the small local embedding model.
- `_read_jsonl` / `_read_json` are file readers.
- **`tokenize`** lowercases text and splits it into letters, digits and µ. These tokens are what BM25 matches.
- **`embedding_text`** prefixes a chunk with its label (`"S02 p.6: …"`), so the page identity is part of what gets searched.

### 8.2 `KnowledgeBase` ([L38–54](backend/afs/retrieval.py#L38-L54))
Loads every KB file into memory:
- `sources`, keyed by ID;
- `pages`, keyed by `(source, page)` for instant lookup;
- `chunks`, `methods`, `fibers`, `cases`.

`get_page` is case-insensitive and accepts the page as a string or int. `reference_doc(name)` reads `kb/reference/<name>.md` (the guidelines and worked examples).

### 8.3 `_Embedder` ([L57–71](backend/afs/retrieval.py#L57-L71))
Wraps fastembed:
- `passages()` embeds many documents;
- `query()` embeds one search query. The bge model uses a slightly different input for queries than for documents, which `query_embed` handles.

Both normalise the vectors to length 1, so a dot product equals cosine similarity. The import sits inside `__init__` so that merely importing the module doesn't load the model.

### 8.4 `build_index()` ([L74–83](backend/afs/retrieval.py#L74-L83))
Used by `kb/build_index.py`:
- embeds every chunk and stores the vectors in `IndexFlatIP`, an exact inner-product search;
- writes `chunks.faiss` and `meta.json` (the model name plus the chunk order). Row *i* of the index is `chunk_ids[i]`.

### 8.5 `HybridRetriever.__init__` ([L86–96](backend/afs/retrieval.py#L86-L96))
- Checks that the index matches `chunks.jsonl` (same IDs, same count). If not, it stops with "run kb/build_index.py". **Why:** a stale index would silently return the wrong text.
- Reorders the chunks to match the index rows, loads FAISS and the embedder, and builds BM25 over the tokenized chunks.

### 8.6 `search()` ([L98–120](backend/afs/retrieval.py#L98-L120))
1. **[L103–104] Dense:** embed the query; FAISS returns the indices of the 30 closest chunks.
2. **[L105–106] BM25:** score every chunk; keep the 30 best with a score above 0.
3. **[L108–115] Fuse (RRF):** for each list, each chunk gains `1/(60 + rank)`. Its rank in each list is remembered, and the source filter is applied here.
4. **[L117–120]** Sorts by fused score, keeps the top `k`, and returns each chunk with `score`, `dense_rank` and `bm25_rank`.

### 8.7 Cached accessors ([L123–130](backend/afs/retrieval.py#L123-L130))
`@lru_cache(maxsize=1)` makes `get_kb()` and `get_retriever()` build their object **once** and return the same one afterwards. Every run shares the loaded KB and index, and the warm start in `api.py` fills this cache at startup.

---

## 9. `agents/writer_critic.py` + `checks.py`: agent 3

### 9.1 `WRITER_SYSTEM` ([writer_critic.py L14–44](backend/afs/agents/writer_critic.py#L14-L44))
The writer's rulebook; each rule maps to a judging criterion:
- **claim kinds:** fact / sourced / inference / assumption, kept separate;
- **citation format,** with Table 1 cited as `S01 Table 1 (p.6)`, and the **scope rule** (lab ≠ process, in vitro ≠ clinical, vendor example ≠ proof);
- **"never invent"**, including every number with a unit;
- **every premise gets a verdict;**
- **the three decision statuses defined,** with "in every case still say what can be done next";
- **`not_recommended`** for unsupported approaches; combinations are hypotheses;
- **spectral units:** nominal range ≠ usable range; Raman excitation separate from Raman shift;
- **questions:** P1 first, answered ones dropped;
- **the plan:** representative samples, independent reference, comparison, go/no-go;
- **"Be concise."**

### 9.2 `CRITIC_SYSTEM` ([L46–59](backend/afs/agents/writer_critic.py#L46-L59))
Tells the reviewer to judge like the jury (the 5 criteria) and gives 6 concrete checks. The key rule is **"error" only if the assessment is wrong, ungrounded or unsafe; otherwise "warning"**. This stops the critic from triggering rewrites for matters of taste.

### 9.3 `CriticIssue` / `Critique` ([L62–70](backend/afs/agents/writer_critic.py#L62-L70))
The shape of the critic's answer: `passed` plus a list of `{check, severity, message}`.

### 9.4 `write_report()` ([L73–89](backend/afs/agents/writer_critic.py#L73-L89))
- **[L76–77] System message:** rules + organisers' guidelines + worked D01/D02 examples. These parts are identical every run.
- **[L78–84] User message,** in labelled sections: `# ENQUIRY`, `# CLIENT ANSWERS`, `# INTAKE`, `# RESEARCH NOTES`, `# REFERENCE TABLES` (method overview + fibers), `# EVIDENCE (the only pages you may cite)`.
- **[L85–88] On a revision,** it appends `# YOUR PREVIOUS DRAFT` and `# REVIEW ISSUES TO FIX` and asks for the complete revised assessment.
- **[L89]** `ask_json(..., ReportBody)` with the main model and reasoning **on**.

### 9.5 `critique()` ([L92–120](backend/afs/agents/writer_critic.py#L92-L120))
1. **[L96]** `client_text` = enquiry + answers. Numbers found here count as supported.
2. **[L97–100] Repair:** remembers the evidence pages, runs `repair_citations`, then works out which pages were *added* and writes a note for each.
3. **[L102]** Runs the 4 code checks.
4. **[L103–104]** If anything was repaired, adds a `citation_repairs` entry that always passes. It's there for transparency, never as a failure.
5. **[L107–109]** Collects every page the draft cites and puts its **full text** in the prompt, so the reviewer can verify each claim against the real page.
6. **[L110–115]** Builds the review prompt: enquiry, answers, the intake's premises, the automated check results, the draft, and the cited pages.
7. **[L116]** LLM review with reasoning **off** (fast).
8. **[L118–120]** Issues = failed code checks (always errors) + the LLM's issues. Returns the checks and the issues.

### 9.6 `checks.py`: patterns ([L10–13](backend/afs/checks.py#L10-L13))
- `UNIT` is the list of units we look for.
- `NUMBER` matches `2500`, `2.5`, `1,3` and `10 000` (space-separated thousands).
- `QUANTITY` matches a number, an optional `– second number` for ranges, then a unit. The `(?<![\w.])` and `(?![\w/])` guards prevent matching inside words or codes.

### 9.7 Number helpers ([L16–65](backend/afs/checks.py#L16-L65))
- **`_value`:** turns text into a float. `"10 000"` → 10000; `"1,234"` → 1234 (thousands); `"1,3"` → 1.3 (European decimal).
- **`_normalise`:** nm, µm and cm⁻¹ all become **µm** with the tag `"spectral"`; other units keep their own tag.
- **`quantities`** (strict, for the report): only numbers written *directly* with a unit.
- **`nearby_quantities`** (lenient, for the sources): pairs every number with any unit found within 60 characters. This handles OCR tables like `| 3750 | cm⁻¹ |`.
- **`_supported`:** same unit tag and value within **1 %**, which absorbs rounding (2.667 µm vs 3750 cm⁻¹).
- **`_kb_quantities`:** runs `nearby_quantities` over **all pages + tables** once (`lru_cache`) and keeps the result.

### 9.8 `_walk()` and `citations()` ([L68–83](backend/afs/checks.py#L68-L83))
`_walk` visits every part of a report recursively (models → fields → lists → items) and yields every **string** and every **Citation**. `citations()` keeps only the citations. Because it walks generically, the checks never need updating when a new report field is added.

### 9.9 `repair_citations()` ([L86–122](backend/afs/checks.py#L86-L122))
- `exists(c)`: external citations are allowed; otherwise the page must exist in the KB.
- `fix(obj)` walks the report. Wherever an object has a `citations` list:
  - drops citations to nonexistent pages, with a note;
  - **records each real page** into the evidence pack through the `record_page` callback;
  - if a claim marked `"sourced"` loses all its citations, downgrades it to `"inference"`. The label stays honest.
- Finally cleans the report's `sources` list the same way, and returns the notes.

### 9.10 `run_checks()` ([L125–163](backend/afs/checks.py#L125-L163))
Four checks, each producing a `VerificationCheck(name, passed, details)`:
1. **`citations_valid`** ([L129–139](backend/afs/checks.py#L129-L139)): external citations need a URL and a quote; others must exist **and** be in the evidence pack.
2. **`numbers_supported`** ([L141–147](backend/afs/checks.py#L141-L147)): joins every string in the report, extracts the strict quantities, and lists those with no match in the KB or the client text.
3. **`sections_complete`** ([L149–157](backend/afs/checks.py#L149-L157)): questions, recommendations, risks, at least 2 plan steps and sources must be non-empty.
4. **`premises_addressed`** ([L159–162](backend/afs/checks.py#L159-L162)): the number of premise verdicts must be at least the number of premises the clarifier found.

---

## 10. `llm.py`: talking to DeepSeek

### 10.1 Model names ([L13–19](backend/afs/llm.py#L13-L19))
`main_model()` and `fast_model()` read `.env` **each time they're called**, not at import. **Why:** `.env` is loaded by `api.py` or `run_eval.py` after some imports have already happened; reading late always picks up the right value.

### 10.2 `chat()` ([L22–36](backend/afs/llm.py#L22-L36))
Creates a LangChain `ChatOpenAI` pointed at DeepSeek's OpenAI-compatible URL.

| Parameter | Value | Why |
|---|---|---|
| `temperature` | 0.2 | Mostly consistent answers |
| `max_tokens` | 16000 | DeepSeek's hidden reasoning counts against this; a small limit returned **empty** answers (seen during OCR) |
| `timeout` | 600 s | Long writer calls must not be cut off |
| `max_retries` | 2 | Rides out short network or API hiccups |
| `extra_body` | `{"thinking": {"type": "disabled"}}` when `thinking=False` | Skips the reasoning phase: about 4× faster |

### 10.3 `ask_json()` ([L39–57](backend/afs/llm.py#L39-L57))
1. **[L42]** Enables JSON mode, so the model must return valid JSON.
2. **[L43–47]** The system message = the agent's instructions + **the Pydantic schema as JSON Schema**, so the model sees exactly which fields and types are expected.
3. **[L48–50]** Calls the model and strips any ```` ```json ```` fences.
4. **[L51–52]** `schema.model_validate_json(text)` parses and validates in one step. On success it returns a typed Python object.
5. **[L53–57]** On failure (wrong fields, wrong values, empty reply), it adds the model's reply and the **exact validation error** to the conversation and asks again, up to 2 retries. The model usually fixes it on the first retry because it sees precisely what was wrong.

---

## 11. `schemas.py`: the report's shape

### 11.1 `DecisionStatus` ([L6](backend/afs/schemas.py#L6))
A `Literal` type: only `"provisional"`, `"insufficient_information"` or `"outside_supported_scope"` are accepted. Anything else fails validation, and the model is asked to fix it.

### 11.2 Building blocks ([L9–96](backend/afs/schemas.py#L9-L96))

| Model | Fields | Used for |
|---|---|---|
| `Citation` | `source`, `page`, `label`, `quote?`, `url?` | One reference, e.g. `S02 p.6` |
| `Claim` | `text`, `kind` (fact / sourced / assumption / inference), `citations` | Any statement in the report |
| `Premise` | `statement`, `verdict` (supported / refuted / unverified), `explanation`, `citations` | A client claim and the judgement on it |
| `Question` | `question_id`, `text`, `priority` (1–3), `why_it_matters`, `affects` | Clarification questions (also used by the clarifier) |
| `MethodRecommendation` | `method`, `technique`, `role` (primary / comparison / combination / not_recommended), `rationale: Claim[]`, `conditions`, `citations` | One method option |
| `SpectralRange` | `method`, `range_text`, `note`, `citations` | Range with units and caveats |
| `PlanStep` / `FeasibilityPlan` | `objective`, `samples`, `reference_measurements`, `steps`, `comparison`, `go_no_go` | The first experiment |
| `Requirements` | `stated_facts: Claim[]`, `key_unknowns`, `client_premises: Premise[]` | What is known and what is claimed |
| `MeasurementConcept` | `probe_geometry`, `location`, `fiber_link` (each `Claim[]`) | Probe and setup |
| `UserAnswer` | `question_id`, `answer` | Interactive answers |
| `VerificationCheck` / `Verification` | `name`, `passed`, `details`; overall `passed`, `revisions`, `checks` | The critic's results |
| `ReportMeta` | `model`, `mode`, `generated_at`, `duration_s` | Run information |

`Literal` fields act as **guard rails**: the LLM can't invent a fourth claim kind or a new role, because validation rejects it and asks for a fix.

### 11.3 `ReportBody` ([L106–119](backend/afs/schemas.py#L106-L119))
The fields the **writer** produces: decision status and rationale, summary, requirements, questions, assumptions, recommendations, measurement concept, spectral ranges, risks, feasibility plan and sources. This is the schema passed to `ask_json` in `write_report`.

### 11.4 `Report` ([L122–127](backend/afs/schemas.py#L122-L127))
```python
class Report(ReportBody):
    case_id, enquiry, user_answers, verification, meta
```
**Inherits** everything from `ReportBody` and adds what only the pipeline knows. **Why the split:** the model shouldn't spend tokens copying the enquiry or inventing timestamps and check results, and it can't fake its own verification.

This one class is also:
- what the API returns (`/outputs/{id}`, the `report` event);
- what `run_eval.py` saves to `outputs/*.json`;
- what the frontend's `types.ts` mirrors.

One definition, used everywhere.
