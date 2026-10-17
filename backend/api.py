"""FastAPI service for the AFS spectroscopy assistant. Contract: frontend.md.

Run (from backend/):  uvicorn api:app --reload
Runs are kept in memory: one worker thread per assessment, so deploy a single instance.
"""
import asyncio
import json
import os
import queue
import sys
import tempfile
import threading
import uuid
from datetime import datetime, timezone
from pathlib import Path
from typing import Literal

import httpx
from dotenv import load_dotenv
from fastapi import Body, Depends, FastAPI, File, Form, Header, HTTPException, Request, UploadFile
from fastapi.exceptions import RequestValidationError
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import JSONResponse, PlainTextResponse
from pydantic import BaseModel, Field
from sse_starlette.sse import EventSourceResponse

from contextlib import asynccontextmanager

load_dotenv()

from afs import history  # noqa: E402
from afs.pipeline import run_assessment  # noqa: E402
from afs.render import render_markdown  # noqa: E402
from afs.checks import _kb_quantities  # noqa: E402
from afs.retrieval import KB_DIR, get_kb, get_retriever, reload_kb  # noqa: E402
from afs.schemas import Question, Report, UserAnswer  # noqa: E402

VERSION = "0.1.0"
OUTPUTS_DIR = Path(os.environ.get("AFS_OUTPUTS_DIR", Path(__file__).resolve().parents[1] / "outputs"))
CLARIFICATION_TIMEOUT_S = 1800


# -----------pre warm---------------------------
@asynccontextmanager
async def lifespan(_: FastAPI):
    """Warm start: load the KB, search index, embedding model and number index before the first request."""
    from afs.checks import _kb_quantities
    from afs.retrieval import get_kb, get_retriever

    get_retriever().search("warm up", k=1)  # warm up the search index and embedding model
    _kb_quantities(get_kb())  # warm up the number index
    yield


    
app = FastAPI(title="AFS In-line Spectroscopy Assistant", version=VERSION, lifespan=lifespan)

app.add_middleware(
    CORSMiddleware,
    allow_origins=[o.strip() for o in os.environ.get("CORS_ORIGINS", "http://localhost:5173").split(",") if o.strip()],
    allow_methods=["*"],
    allow_headers=["*"],
)


# ---------------------------------------------------------------- errors: {"error": {"code", "message"}}

class ApiError(HTTPException):
    def __init__(self, status: int, code: str, message: str):
        super().__init__(status, message)
        self.code = code


@app.exception_handler(ApiError)
async def api_error_handler(_: Request, exc: ApiError):
    return JSONResponse({"error": {"code": exc.code, "message": exc.detail}}, status_code=exc.status_code)


@app.exception_handler(httpx.HTTPError)
async def storage_error_handler(_: Request, exc: httpx.HTTPError):
    """Supabase unreachable or misconfigured (e.g. a missing table): a clear 503 instead of a 500."""
    print(f"history storage error: {exc}", flush=True)
    return JSONResponse({"error": {"code": "history_unavailable", "message": "Chat history storage is unavailable."}},
                        status_code=503)


@app.exception_handler(RequestValidationError)
async def validation_error_handler(_: Request, exc: RequestValidationError):
    message = "; ".join(f"{'.'.join(map(str, e['loc']))}: {e['msg']}" for e in exc.errors())
    return JSONResponse({"error": {"code": "validation_error", "message": message}}, status_code=422)


# ---------------------------------------------------------------- runs

class Run:
    """One assessment. The pipeline runs in a worker thread and talks to the API through emit() and ask()."""

    def __init__(self, enquiry: str, mode: str, case_id: str | None, user_id: str | None = None):
        self.thread_id = uuid.uuid4().hex
        self.enquiry, self.mode, self.case_id, self.user_id = enquiry, mode, case_id, user_id
        self.status = "running"
        self.events: list[dict] = []
        self.report: Report | None = None
        self.error: dict | None = None
        self.clarification: dict | None = None
        self._replies: queue.Queue = queue.Queue()

    def emit(self, event: str, data: dict) -> None:
        self.events.append({"event": event, "data": data})

    def _set_status(self, status: str) -> None:
        self.status = status
        self.emit("status", {"status": status})
        self._persist()

    def _persist(self) -> None:
        """Save to the logged-in user's history (Supabase). A failed save never breaks the assessment."""
        if not (self.user_id and history.enabled()):
            return
        record = {"thread_id": self.thread_id, "user_id": self.user_id, "enquiry": self.enquiry, "mode": self.mode,
                  "case_id": self.case_id, "status": self.status, "events": self.events,
                  "report": self.report.model_dump(mode="json") if self.report else None,
                  "updated_at": datetime.now(timezone.utc).isoformat()}
        try:
            history.save(record)
        except Exception as exc:
            print(f"history save failed for {self.thread_id}: {exc}", flush=True)

    def ask(self, payload: dict) -> dict:
        self.clarification = {k: payload[k] for k in ("round", "max_rounds", "questions")}
        self._set_status("awaiting_clarification")
        self.emit("clarification_needed", payload)
        try:
            reply = self._replies.get(timeout=CLARIFICATION_TIMEOUT_S)
        except queue.Empty:
            reply = {"answers": [], "proceed_with_assumptions": True}
        self.clarification = None
        self._set_status("running")
        return reply

    def reply(self, answers: list[dict], proceed: bool) -> None:
        self._replies.put({"answers": answers, "proceed_with_assumptions": proceed})

    def execute(self) -> None:
        self._set_status("running")
        try:
            report = run_assessment(self.enquiry, self.mode, self)
            report.case_id = report.case_id or self.case_id
            self.report = report
            self.emit("report", {"report": report.model_dump(mode="json")})
            self.status = "completed"
        except Exception as exc:  # surfaced to the client as an error event
            code = "not_implemented" if isinstance(exc, NotImplementedError) else "llm_error"
            self.error = {"code": code, "message": str(exc)}
            self.emit("error", self.error)
            self.status = "failed"
        self.emit("done", {"status": self.status})
        self._persist()


RUNS: dict[str, Run] = {}


def get_run(thread_id: str) -> Run:
    if thread_id not in RUNS:
        raise ApiError(404, "not_found", f"Unknown assessment {thread_id}")
    return RUNS[thread_id]


# ---------------------------------------------------------------- request bodies

class AssessmentRequest(BaseModel):
    enquiry: str = Field(min_length=20, max_length=4000)
    mode: Literal["interactive", "batch"] = "interactive"
    case_id: str | None = None


class AnswersRequest(BaseModel):
    answers: list[UserAnswer] = []
    proceed_with_assumptions: bool = False


class Clarification(BaseModel):
    round: int
    max_rounds: int
    questions: list[Question]


class AssessmentSnapshot(BaseModel):
    thread_id: str
    status: Literal["running", "awaiting_clarification", "completed", "failed"]
    enquiry: str
    mode: Literal["interactive", "batch"]
    clarification: Clarification | None = None
    report: Report | None = None
    error: dict | None = None


# ---------------------------------------------------------------- routes

@app.get("/health")
def health():
    llm_ready = bool(os.environ.get("DEEPSEEK_API_KEY") and os.environ.get("LLM_MODEL"))
    return {"status": "ok", "version": VERSION, "llm_ready": llm_ready, "mock_mode": False,
            "auth_required": history.enabled()}  # the UI shows its sign-in screen when true


@app.get("/cases")
def list_cases():
    return [{k: c[k] for k in ("case_id", "set", "title", "text")} for c in get_kb().cases["cases"]]


@app.get("/cases/{case_id}")
def get_case(case_id: str):
    case = next((c for c in list_cases() if c["case_id"].lower() == case_id.lower()), None)
    if not case:
        raise ApiError(404, "not_found", f"Unknown case {case_id}")
    return case


# ---------------------------------------------------------------- login and history (Supabase)

def optional_user(authorization: str | None = Header(None)) -> dict | None:
    """The logged-in user from `Authorization: Bearer <token>`, or None without a token."""
    if not authorization:
        return None
    if not history.enabled():
        raise ApiError(503, "auth_unavailable", "Login is not configured on this server")
    try:
        return history.user_from_token(authorization.removeprefix("Bearer ").strip())
    except history.AuthError as exc:
        raise ApiError(401, "unauthorized", str(exc))


def required_user(user: dict | None = Depends(optional_user)) -> dict:
    if user is None:
        raise ApiError(401, "unauthorized", "Log in to see your history")
    return user


class LoginRequest(BaseModel):
    username: str = Field(min_length=1)
    password: str = Field(min_length=1)


@app.post("/auth/login")
def auth_login(body: LoginRequest):
    """Returns {access_token, expires_in, user}. Send the token as `Authorization: Bearer <token>`."""
    if not history.enabled():
        raise ApiError(503, "auth_unavailable", "Login is not configured on this server")
    try:
        return history.login(body.username, body.password)
    except history.AuthError as exc:
        raise ApiError(401, "invalid_credentials", str(exc))


@app.get("/auth/me")
def auth_me(user: dict = Depends(required_user)):
    return user


@app.get("/history")
def list_history(user: dict = Depends(required_user)):
    """The user's past assessments, newest first."""
    return history.list_for(user["id"])


@app.get("/history/{thread_id}")
def get_history(thread_id: str, user: dict = Depends(required_user)):
    """One past assessment with its report and agent timeline (`events`), to reopen it later."""
    record = history.get(thread_id, user["id"])
    if not record:
        raise ApiError(404, "not_found", f"No assessment {thread_id} in your history")
    return record


@app.get("/chats")
def list_chats(user: dict = Depends(required_user)):
    """The user's chats as the UI saved them ({id, at, turns}), newest first, so Recent works on any device."""
    return history.list_chats(user["id"])


@app.put("/chats/{chat_id}", status_code=204)
def save_chat(chat_id: str, chat: dict = Body(...), user: dict = Depends(required_user)):
    if chat.get("id") != chat_id or not isinstance(chat.get("turns"), list):
        raise ApiError(422, "validation_error", "Body must be the chat object {id, at, turns} with the same id")
    history.save_chat(user["id"], chat_id, chat)


@app.delete("/chats/{chat_id}", status_code=204)
def delete_chat(chat_id: str, user: dict = Depends(required_user)):
    """Delete one of the user's chats and the saved runs it contains (idempotent)."""
    history.delete_chat(user["id"], chat_id)


@app.post("/assessments", status_code=201)
def start_assessment(body: AssessmentRequest, user: dict | None = Depends(optional_user)):
    """Logged in: the assessment is saved to the user's history. Without a token it still runs, unsaved."""
    run = Run(body.enquiry.strip(), body.mode, body.case_id, user["id"] if user else None)
    RUNS[run.thread_id] = run
    threading.Thread(target=run.execute, daemon=True).start()
    return {"thread_id": run.thread_id, "status": "running"}


@app.get("/assessments/{thread_id}/events")
async def assessment_events(thread_id: str, request: Request):
    run = get_run(thread_id)
    start = int(request.headers.get("last-event-id", -1)) + 1

    async def stream():
        i = start
        while True:
            while i < len(run.events):
                ev = run.events[i]
                yield {"id": str(i), "event": ev["event"], "data": json.dumps(ev["data"], ensure_ascii=False)}
                i += 1
                if ev["event"] == "done":
                    return
            if await request.is_disconnected():
                return
            await asyncio.sleep(0.3)

    return EventSourceResponse(stream(), ping=15)


@app.post("/assessments/{thread_id}/answers", status_code=202)
def answer_clarification(thread_id: str, body: AnswersRequest):
    run = get_run(thread_id)
    if run.status != "awaiting_clarification":
        raise ApiError(409, "invalid_state", f"Assessment is {run.status}, not awaiting clarification")
    run.reply([a.model_dump() for a in body.answers], body.proceed_with_assumptions)
    return {"thread_id": thread_id, "status": "running"}


@app.get("/assessments/{thread_id}", response_model=AssessmentSnapshot)
def assessment_snapshot(thread_id: str):
    if thread_id not in RUNS and history.enabled():  # e.g. after a server restart: rebuild from saved history
        record = history.get(thread_id)
        if record:
            status = record["status"] if record["status"] in ("completed", "failed") else "failed"
            return AssessmentSnapshot(thread_id=thread_id, status=status, enquiry=record["enquiry"],
                                      mode=record["mode"], report=record["report"],
                                      error=None if record["report"] else {"code": "interrupted",
                                                                           "message": "The run did not finish."})
    run = get_run(thread_id)
    return AssessmentSnapshot(thread_id=run.thread_id, status=run.status, enquiry=run.enquiry, mode=run.mode,
                              clarification=run.clarification, report=run.report, error=run.error)


@app.get("/assessments/{thread_id}/report.md", response_class=PlainTextResponse)
def assessment_markdown(thread_id: str):
    run = get_run(thread_id)
    if not run.report:
        raise ApiError(409, "invalid_state", "The report is not ready yet")
    return PlainTextResponse(render_markdown(run.report), media_type="text/markdown")


@app.get("/kb/sources")
def kb_sources():
    return [_source_info(s) for s in get_kb().sources.values()]


def _source_info(s: dict) -> dict:
    keys = ("source_id", "title", "file", "pages", "evidence_level", "description", "scope_note")
    return {k: s.get(k, "") for k in keys}


@app.get("/kb/{source_id}/pages/{page}")
def kb_page(source_id: str, page: int):
    p = get_kb().get_page(source_id, page)
    if not p:
        raise ApiError(404, "not_found", f"No page {source_id} p.{page}")
    return {"source_id": p["source"], "page": p["page"], "label": p["label"], "title": p["title"],
            "evidence_level": p["evidence_level"], "origin": p["origin"], "text": p["text"]}


sys.path.append(str(KB_DIR))  # kb/ingest.py
INGEST_LOCK = threading.Lock()


@app.post("/kb/documents", status_code=201)
def add_kb_document(file: UploadFile = File(...), title: str = Form(..., min_length=3),
                    evidence_level: str = Form("expert_notes"), scope_note: str = Form(""),
                    ocr: Literal["none", "figures", "slides"] = Form("none")):
    """Add a PDF, TXT or MD document to the knowledge base. The next assessment can search and cite it."""
    from ingest import add_document

    with INGEST_LOCK, tempfile.TemporaryDirectory() as tmp:
        path = Path(tmp) / Path(file.filename or "document.txt").name
        path.write_bytes(file.file.read())
        try:
            entry = add_document(path, title, evidence_level, scope_note, ocr)
        except (ValueError, RuntimeError) as exc:
            raise ApiError(422, "validation_error", str(exc))
        reload_kb()  # running assessments keep their loaded KB; new ones see the document
        _kb_quantities.cache_clear()
        get_retriever()
    return _source_info(entry)


@app.delete("/kb/sources/{source_id}")
def remove_kb_document(source_id: str):
    """Remove a document added earlier (S07 onwards). The supplied AFS materials S01-S06 are protected."""
    from ingest import remove_document

    with INGEST_LOCK:
        try:
            entry = remove_document(source_id)
        except PermissionError as exc:
            raise ApiError(403, "protected_source", str(exc))
        except LookupError as exc:
            raise ApiError(404, "not_found", str(exc))
        reload_kb()  # running assessments keep their loaded KB; new ones no longer see the document
        _kb_quantities.cache_clear()
        get_retriever()
    return {"removed": _source_info(entry)}


def _load_output(path: Path) -> Report:
    return Report.model_validate_json(path.read_text(encoding="utf-8"))


@app.get("/outputs")
def list_outputs():
    items = []
    for path in sorted(OUTPUTS_DIR.glob("*.json")):
        r = _load_output(path)
        items.append({"case_id": r.case_id or path.stem, "decision_status": r.decision_status,
                      "generated_at": r.meta.generated_at if r.meta else None})
    return items


@app.get("/outputs/{case_id}", response_model=Report)
def get_output(case_id: str):
    path = OUTPUTS_DIR / f"{case_id.upper()}.json"
    if not path.exists():
        raise ApiError(404, "not_found", f"No precomputed report for {case_id}")
    return _load_output(path)

