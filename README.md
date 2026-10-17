# AFS In-line Spectroscopy Assistant

**National AI Hackathon 2026 by SchubKI · Challenge by Art Fiber Systems (AFS):
*AI Assistant for In-line Spectroscopy Solution Design***

Industrial customers know *what* they want to monitor (a concentration, contamination, moisture, product quality) but not *which* spectroscopy method, spectral range, fiber probe or setup to test first. This assistant helps an AFS expert make a **first technical assessment** of a new enquiry. For each enquiry it:

1. extracts the requirements and constraints, keeping client facts separate from unknowns;
2. asks prioritised clarification questions, interactively if a user is present;
3. checks the client's own premises against the sources, for example "reuse this cable" or "Raman alone is enough";
4. recommends methods or combinations worth testing, and says what is *not* recommended;
5. proposes a probe / measurement concept and the spectral range, in correct units;
6. states the risks and uncertainty, and gives a **decision status**: provisional / insufficient information / outside supported scope;
7. proposes a practical first feasibility experiment;
8. cites the AFS source page behind every important claim, and verifies those citations before answering.

The assistant does not replace the expert. Its output is built to be reviewed: every claim is typed as client fact, sourced, inference or assumption, and every citation opens the exact page text it relies on.

---

## Contents

- [Architecture](#architecture)
- [How the AFS materials are used](#how-the-afs-materials-are-used)
- [Repository layout](#repository-layout)
- [Setup](#setup)
- [Running](#running)
- [Generating the H01–H06 answers](#generating-the-h01h06-answers)
- [API](#api)
- [Testing](#testing)
- [Deployment](#deployment)
- [Design decisions and limitations](#design-decisions-and-limitations)

---

## Architecture

```
                       ┌──────────────────────── LangGraph state graph ─────────────────────────┐
 enquiry ──► Clarifier ─┬─► Researcher (ReAct) ──► Writer ──► Critic ──┬──► Report (JSON + Markdown)
             (agent 1)  │   (agent 2)              (agent 3)            │
                 ▲      │    tools:                    ▲  errors, ≤2    │
                 │      │    search_kb  (hybrid)       └── revisions ───┘
   interactive:  │      │    get_page
   questions ────┘      │    method_table
   ↔ user answers       │    fiber_check
   (≤ 3 rounds)         │         │
                        │         ▼
                        │   evidence pack: every page the tools returned
                        │   (the only pages the writer may cite)
```

| Agent | Model | What it does |
|---|---|---|
| **1. Clarifier** | `deepseek-flash` | Extracts stated facts, requested variables, **client premises to check**, key unknowns, prioritised questions (P1 = could change method or setup), working assumptions and scope concerns. **Interactive mode:** pauses and asks the user, up to 3 rounds, until no P1 question is open, or the user clicks *Proceed with assumptions*. **Batch mode:** one pass; open questions and assumptions go into the report. It never invents answers. |
| **2. Researcher** | `deepseek-flash`, reasoning off, ReAct (`langchain.agents.create_agent`) | Calls the knowledge-base tools to cover every requested variable and every client premise, with at most 12 tool calls (`ToolCallLimitMiddleware`). It ends with research notes: candidate methods, premise verdicts, spectral ranges and fiber link, limitations, evidence gaps. Every tool call is streamed to the UI. |
| **3a. Writer** | `deepseek-v4-pro`, reasoning on | Writes the structured report (`ReportBody` Pydantic schema) from the intake, the research notes and the evidence pack. Its prompt includes the organisers' answer guidelines and the worked D01/D02 examples. |
| **3b. Critic** | code checks + `deepseek-v4-pro`, reasoning off | **Deterministic checks:** every citation points to a page in the evidence pack; every number with a unit appears in the sources or the client's text; all sections are present; every client premise has a verdict. **LLM review against the jury criteria:** citation scope, invented facts, premise verdicts, decision status, question quality, plan practicality. If any *error* remains, the writer revises, up to `MAX_REVISIONS` (default 2). |

**Stack:** Python 3.11 · LangChain 1.x + LangGraph · DeepSeek (OpenAI-compatible API) · FAISS + BM25 · fastembed (local embeddings) · FastAPI + SSE · React 19 + Vite + TypeScript + Tailwind.

**Typical run time:** 2.5–4 minutes per enquiry. The writer step dominates (about 60–110 s per draft). Progress streams live, so the UI is never silent.

---

## How the AFS materials are used

The supplied materials are the main knowledge source. No external sources are used.

### Knowledge base build (`kb/build_kb.py`)

| Material | How it is processed |
|---|---|
| `S01_Multispectral_Laboratory.pdf` (main technical source) | Text extracted page by page with PyMuPDF. **Page 6 (Table 1)** is replaced by the clean transcription from `AFS_method_comparison_table.xlsx`, because the PDF text of that page is scrambled. **9 pages with figures** get an extra vision transcription of the figure content, for example Fig. 7, which shows which method reaches which bioprocess variable. |
| `S02_AFS_Process_Control_Slides.pdf` | Image-based slides: **all 20 slides are transcribed with a vision model** (`deepseek-flash`), keeping text, numeric values with units, and factual chart descriptions. Key pages: fiber ranges p.6, long silica cables p.7, water in petroleum p.13, extrusion p.14, combi-probes p.15–16. |
| `S03` (LED kidney study), `S04` (MIR-ATR + fluorescence probe) | Page text. **Reference lists are excluded** from search so they don't pollute retrieval. |
| `S05` flyer, `S06` link | Indexed, but tagged as *business context*. |
| `AFS_method_comparison_table.xlsx` | `methods.json`: S01 Table 1 as structured rows. |
| `AFS_Examples_and_Reference.docx` | Development cases D01–D08 → `cases.json`; answer guidelines and worked D01/D02 answers → `reference/` (used in the writer prompt); method overview and **fiber families with ranges converted to µm** → `methods.json`, `fibers.json`. |
| `customer_scenarios_for_final_evaluation.txt` | H01–H06 → `cases.json`. These are the enquiry texts only; nothing case-specific is hard-coded anywhere. |

Every source carries an **evidence level and scope note**. For example, S03 is an *in vitro proof of concept, 14 samples from 7 patients, not evidence of clinical readiness*. The agents see this with every retrieved page, so they can judge how far a citation can stretch.

The vision transcriptions are cached in `kb/ocr_cache/` and committed. A rebuild doesn't call the model again, and a reviewer can read exactly what the model saw.

### Retrieval (`backend/afs/retrieval.py`)

- **Chunks** stay within a single page, so every hit maps to an exact citation such as `S02 p.6`.
- **Dense:** `BAAI/bge-small-en-v1.5` via fastembed, run locally on CPU. Vectors are stored in a FAISS index in `kb/index/`; no embeddings API and no vector DB server are needed.
- **Sparse:** BM25 (`rank-bm25`), built in memory at startup.
- **Fusion:** reciprocal rank fusion of both rankings. Dense retrieval catches paraphrase ("can silica carry mid-IR"); BM25 catches exact terms (`NADH`, `ZrO2`, `785 nm`). Each hit reports both ranks, for transparency.

### Citation rules (from the organisers' reference document)

- Cite as `S01 p.10` (1-based PDF page) or `S01 Table 1 (p.6)`.
- The cited page must support the claim **at the stated scope**: a lab study is not proof of process readiness, and a vendor example is a reason to test a method, not proof that it will work.
- Never invent spectra, accuracies, detection limits, fiber lengths, product codes or client data. The critic enforces this with a number-provenance check.

---

## Repository layout

```
├── backend/
│   ├── api.py                 FastAPI app: routes, SSE stream, in-memory run manager
│   ├── run_eval.py            batch-run cases → outputs/<ID>.json + .md
│   ├── check_llm.py           smoke test: DeepSeek chat, tool calling, JSON mode
│   ├── afs/
│   │   ├── pipeline.py        LangGraph graph: clarify → research → write ⇄ review
│   │   ├── agents/
│   │   │   ├── clarifier.py   agent 1 (interactive / batch)
│   │   │   ├── researcher.py  agent 2 (ReAct, streamed tool calls)
│   │   │   └── writer_critic.py  agent 3 (writer + LLM critic)
│   │   ├── tools.py           search_kb, get_page, method_table, fiber_check + evidence pack
│   │   ├── checks.py          deterministic critic checks
│   │   ├── retrieval.py       knowledge base access + hybrid retriever
│   │   ├── schemas.py         Report data model (shared with the frontend)
│   │   ├── render.py          Report → Markdown
│   │   └── llm.py             DeepSeek client, JSON-mode helper with schema validation
│   ├── tests/                 pytest: KB, retrieval, tools, checks
│   └── requirements.txt
├── kb/
│   ├── build_kb.py            materials → pages / chunks / tables / cases
│   ├── build_index.py         chunks → FAISS index (kb/index/, generated)
│   ├── ocr.py                 vision transcription with cache
│   ├── ocr_cache/             committed vision transcriptions (31 pages)
│   ├── pages.jsonl  chunks.jsonl  sources.json  methods.json  fibers.json  cases.json
│   ├── reference/             challenge brief, answer guidelines, worked examples
│   └── raw/                   supplied materials (git-ignored, see Setup)
├── frontend/                  React + Vite UI (see frontend/README.md)
├── outputs/                   generated reports (H01–H06 etc.), never edited by hand
├── frontend.md                API contract between backend and frontend
└── plan.md                    project plan
```

---

## Setup

**Requirements:** Python 3.11, Node.js 20+, a DeepSeek API key.

### 1. Backend

```powershell
cd backend
py -3.11 -m venv .venv
.\.venv\Scripts\Activate.ps1          # bash: source .venv/Scripts/activate
pip install -r requirements.txt
copy .env.example .env                 # then set DEEPSEEK_API_KEY
python check_llm.py                    # expects: 1) OK  2) a fiber_range tool call  3) {"status": "ok"}
```

| Variable | Default | Purpose |
|---|---|---|
| `DEEPSEEK_API_KEY` | (required) | DeepSeek API key |
| `LLM_BASE_URL` | `https://api.deepseek.com` | OpenAI-compatible endpoint |
| `LLM_MODEL` | `deepseek-v4-pro` | Writer and critic |
| `FAST_LLM_MODEL` | `deepseek-flash` | Clarifier, researcher, vision OCR |
| `INTERACTIVE_WRITER_MODEL` | `deepseek-flash` | Writer model for interactive (live UI) runs. It writes about 2.5× faster than `v4-pro`, with slightly less disciplined method selection. Batch runs (the H01–H06 outputs) use `LLM_MODEL`. |
| `MAX_REVISIONS` | `2` | Writer rewrites after a failed review |
| `CORS_ORIGINS` | `http://localhost:5173` | Comma-separated frontend origins |
| `WEB_SEARCH` | `on` | Fallback search of peer-reviewed abstracts (OpenAlex) for points the AFS materials don't cover. External quotes are verified word for word against the fetched abstract. Set `off` for an AFS-only assistant. |

### 2. Knowledge base

The generated knowledge base (`kb/*.jsonl`, `kb/*.json`, `kb/ocr_cache/`) is committed, so normally you only build the search index:

```powershell
# from the repo root
backend\.venv\Scripts\python kb\build_index.py --query "silica fiber mid infrared"
```

The first run downloads the embedding model (about 70 MB). To rebuild the knowledge base from the original materials, unzip `materials.zip` into `kb/raw/` (git-ignored; the materials are copyrighted), then:

```powershell
backend\.venv\Scripts\python kb\build_kb.py     # uses cached OCR; new pages call deepseek-flash
backend\.venv\Scripts\python kb\build_index.py
```

**Adding knowledge later** (new papers, application notes, AFS project experience). PDF, TXT and MD files are added *incrementally*: the file gets the next source ID (S07, S08, …) and only its chunks are embedded. Other raw files aren't needed, so this also works on a deployed server. There are three ways:
- UI: *Knowledge base → Add a document*;
- API: `POST /kb/documents` (multipart: `file`, `title`, `evidence_level`, optional `scope_note`, `ocr`);
- CLI: `backend\.venv\Scripts\python kb\ingest.py notes.md --title "AFS notes: …" --evidence-level expert_notes`.

The source list (title, evidence level, scope note, OCR mode) lives in [kb/sources.yaml](kb/sources.yaml).

### 3. Frontend

```powershell
cd frontend
npm install
copy .env.example .env.local           # VITE_API_BASE_URL=http://localhost:8000
```

---

## Running

```powershell
# terminal 1: backend
cd backend
.\.venv\Scripts\Activate.ps1
uvicorn api:app --port 8000            # API docs: http://localhost:8000/docs

# terminal 2: frontend
cd frontend
npm run dev                            # http://localhost:5173
```

In the UI:
- pick a preset (D01–D08 development, H01–H06 evaluation) or type a new enquiry;
- choose **Interactive** to answer clarification questions, or **Batch** for a single pass;
- follow the agents live in the timeline;
- click any citation to open the exact source page text.

Example enquiry not in the supplied cases:

> We produce a vegetable oil and want to monitor its oxidation level and residual water in-line after the refining step. The line runs at about 60 °C. A colleague says Raman alone will be enough because it is "very specific". The analyzer can sit next to the line. What should we test first?

---

## Generating the H01–H06 answers

The final answers are produced by the assistant itself, in batch mode, with no manual edits and no case-specific code:

```powershell
cd backend
python run_eval.py H01 H02 H03 H04 H05 H06     # or no arguments for all D01–D08 + H01–H06
```

Each case writes `outputs/<ID>.json` (the full structured `Report`) and `outputs/<ID>.md` (a readable version). The JSON includes:
- `verification`: the critic's checks and the number of revisions;
- `meta`: model, mode, timestamp and duration.

The UI's *Reports* page and `GET /outputs/{id}` serve these files.

After a batch, [`outputs/EVAL.md`](outputs/EVAL.md) summarises grounding and verification across all reports, per case and in total: claims by kind, the share of claims with a citation, AFS and external citations, citation validity, unsupported numbers, premises judged, and revisions. Rebuild it from the saved reports with `python run_eval.py --summary`.

---

## API

Full contract: [`frontend.md`](frontend.md). Interactive docs: `http://localhost:8000/docs`.

| Method | Path | Purpose |
|---|---|---|
| GET | `/health` | Liveness, LLM configured |
| GET | `/cases`, `/cases/{id}` | D01–D08 and H01–H06 enquiries |
| POST | `/assessments` | Start a run: `{enquiry, mode: "interactive"\|"batch", case_id?}` |
| GET | `/assessments/{id}/events` | **SSE stream**: `status`, `agent_start`, `agent_step`, `clarification_needed`, `draft_ready`, `critic_result`, `report`, `error`, `done` |
| POST | `/assessments/{id}/answers` | `{answers: [{question_id, answer}], proceed_with_assumptions}` |
| GET | `/assessments/{id}` | Snapshot (reload / reconnect) |
| GET | `/assessments/{id}/report.md` | Markdown export |
| GET | `/kb/sources`, `/kb/{source}/pages/{page}` | Sources and page text behind citations |
| GET | `/outputs`, `/outputs/{id}` | Precomputed batch reports |

Errors are always `{"error": {"code", "message"}}`. Each run executes in a worker thread. Interactive clarification blocks that thread until `/answers` arrives (30-minute timeout, after which the run proceeds with assumptions).

---

## Testing

```powershell
cd backend
python -m pytest tests -q
```

| Test file | What it checks |
|---|---|
| `test_kb.py` | All sources and cases parsed; every image slide transcribed; Table 1 uses the clean transcription; fiber ranges in µm; reference lists not indexed; hybrid search finds the key page for typical queries (for example *silica + mid-IR* → S02 p.6). |
| `test_tools.py` | `fiber_check`: Vis-NIR silica vs MIR → no overlap; CIR/PIR partial; unit conversion; the evidence pack records tool results. |
| `test_checks.py` | Citation validation; invented numbers flagged while client-provided ones pass; nm / µm / cm⁻¹ treated as equal; missing sections or premises detected. |

Frontend: `npm run typecheck` and `npm run build` in `frontend/`.

---

## Deployment

- **Backend:** any host that runs a long-lived Python process, such as Render, Hugging Face Spaces (Docker) or Azure App Service. Runs take minutes and stream over SSE, so serverless functions are not suitable. Build steps: `pip install -r requirements.txt`, then `python ../kb/build_index.py`. Start command: `uvicorn api:app --host 0.0.0.0 --port $PORT`. Set the variables from the table above, with `CORS_ORIGINS` = the frontend URL. Run state is in memory, so deploy **one instance**.
- **Frontend:** Vercel with project root `frontend`, build `npm run build`, output `dist`, and `VITE_API_BASE_URL` = the backend URL. `vercel.json` contains the SPA rewrite.
- Free tiers cold-start in about 30–60 s. The UI shows "waking up" and retries `/health` for up to 90 s.

---

## Design decisions and limitations

**Decisions**
- **Generic reasoning, no case-specific rules.** The trap patterns in the evaluation cases are handled by general mechanisms, not code per case:
  - every client premise must get an explicit verdict;
  - fiber/method compatibility is computed from source ranges;
  - each source's evidence level travels with every retrieved page.
- **Number provenance:** every number with a unit in a report must appear in the sources or the client's own text. Spectral units are normalised, so 2500 nm = 2.5 µm = 4000 cm⁻¹.
- **Speed vs. care:** DeepSeek models reason before answering. Reasoning is kept on for the writer, where quality matters most, and turned off for the researcher's tool loop and the critic's review. That makes them about 4× faster, and the deterministic checks act as a backstop.
- **Local retrieval:** with about 240 chunks, an in-process FAISS + BM25 index is faster, free and reproducible compared with a hosted vector DB.

**Limitations**
- Every recommendation is a *first assessment to test*, not a validated configuration. The sources contain no measured performance for new customers, and the assistant says so.
- LLM output varies between runs. The same case can receive a different but defensible decision status, for example *insufficient information* vs *outside supported scope*.
- Vision transcriptions of the image-based slides may contain reading errors. They are committed in `kb/ocr_cache/` for review.
- Run state lives in memory, so a backend restart loses runs that are in progress. Committed `outputs/` are not affected.
