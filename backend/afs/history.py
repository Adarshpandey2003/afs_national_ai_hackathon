"""Login and per-user assessment history, stored in Supabase (Auth + table public.assessments).

Talks to Supabase's HTTP APIs directly (no SDK). Optional: without SUPABASE_URL / keys in .env the assistant works
as before, just without login and history.

Users log in with a username; Supabase Auth needs an email, so "admin" maps to "admin@<USER_EMAIL_DOMAIN>".
"""
import os
import time

import httpx

USER_EMAIL_DOMAIN = os.environ.get("USER_EMAIL_DOMAIN", "afs.local")
_TOKEN_CACHE: dict[str, tuple[float, dict]] = {}  # access token -> (expiry, user); avoids a lookup per request
_TOKEN_TTL_S = 300


class AuthError(Exception):
    pass


def enabled() -> bool:
    return all(os.environ.get(k) for k in ("SUPABASE_URL", "SUPABASE_PUBLISHABLE_KEY", "SUPABASE_SECRET_KEY"))


def _url(path: str) -> str:
    return os.environ["SUPABASE_URL"].rstrip("/") + path


def _db_headers(**extra) -> dict:
    return {"apikey": os.environ["SUPABASE_SECRET_KEY"], "Content-Type": "application/json", **extra}


def login(username: str, password: str) -> dict:
    """Returns {access_token, expires_in, user: {id, username}}; raises AuthError on bad credentials."""
    email = username if "@" in username else f"{username.strip().lower()}@{USER_EMAIL_DOMAIN}"
    r = httpx.post(_url("/auth/v1/token?grant_type=password"), headers={"apikey": os.environ["SUPABASE_PUBLISHABLE_KEY"]},
                   json={"email": email, "password": password}, timeout=20)
    if r.status_code != 200:
        raise AuthError("Invalid username or password")
    data = r.json()
    meta = data["user"].get("user_metadata") or {}
    user = {"id": data["user"]["id"], "username": username.strip(),
            "name": meta.get("name") or meta.get("username") or username.strip()}
    _TOKEN_CACHE[data["access_token"]] = (time.time() + _TOKEN_TTL_S, user)
    return {"access_token": data["access_token"], "token_type": "bearer", "expires_in": data.get("expires_in"),
            "user": user}


def user_from_token(token: str) -> dict:
    """Verifies an access token with Supabase Auth; returns {id, username}."""
    cached = _TOKEN_CACHE.get(token)
    if cached and cached[0] > time.time():
        return cached[1]
    r = httpx.get(_url("/auth/v1/user"), timeout=20,
                  headers={"apikey": os.environ["SUPABASE_PUBLISHABLE_KEY"], "Authorization": f"Bearer {token}"})
    if r.status_code != 200:
        raise AuthError("Session expired or invalid; log in again")
    data = r.json()
    meta = data.get("user_metadata") or {}
    username = meta.get("username") or data.get("email", "").split("@")[0]
    user = {"id": data["id"], "username": username, "name": meta.get("name") or username}
    _TOKEN_CACHE[token] = (time.time() + _TOKEN_TTL_S, user)
    return user


def save(record: dict) -> None:
    """Insert or update one assessment (keyed by thread_id). Errors are swallowed by the caller's choice."""
    r = httpx.post(_url("/rest/v1/assessments"), params={"on_conflict": "thread_id"}, json=record, timeout=20,
                   headers=_db_headers(Prefer="resolution=merge-duplicates,return=minimal"))
    r.raise_for_status()


def list_for(user_id: str, limit: int = 50) -> list[dict]:
    select = "thread_id,enquiry,mode,case_id,status,created_at,updated_at,decision_status:report->>decision_status"
    r = httpx.get(_url("/rest/v1/assessments"), headers=_db_headers(), timeout=20, params={
        "select": select, "user_id": f"eq.{user_id}", "order": "created_at.desc", "limit": limit})
    r.raise_for_status()
    return r.json()


def get(thread_id: str, user_id: str | None = None) -> dict | None:
    params = {"select": "*", "thread_id": f"eq.{thread_id}"}
    if user_id:
        params["user_id"] = f"eq.{user_id}"
    r = httpx.get(_url("/rest/v1/assessments"), headers=_db_headers(), params=params, timeout=20)
    r.raise_for_status()
    rows = r.json()
    return rows[0] if rows else None


# ---------------------------------------------------------------- chats (the UI's conversations, stored as-is)

def save_chat(user_id: str, chat_id: str, data: dict) -> None:
    """Upsert one chat (the frontend's {id, at, turns} object) for this user."""
    turns = data.get("turns") or [{}]
    title = (turns[0].get("message") or turns[0].get("enquiry") or "")[:200]
    r = httpx.post(_url("/rest/v1/chats"), params={"on_conflict": "user_id,id"}, timeout=20,
                   headers=_db_headers(Prefer="resolution=merge-duplicates,return=minimal"),
                   json={"id": chat_id, "user_id": user_id, "title": title, "data": data,
                         "updated_at": time.strftime("%Y-%m-%dT%H:%M:%SZ", time.gmtime())})
    r.raise_for_status()


def list_chats(user_id: str, limit: int = 20) -> list[dict]:
    """The user's chats, newest first, as the frontend stored them."""
    r = httpx.get(_url("/rest/v1/chats"), headers=_db_headers(), timeout=20, params={
        "select": "data", "user_id": f"eq.{user_id}", "order": "updated_at.desc", "limit": limit})
    r.raise_for_status()
    return [row["data"] for row in r.json()]


def delete_chat(user_id: str, chat_id: str) -> None:
    """Delete one chat and the saved runs of the questions in it. Deleting a chat that is not stored is a no-op."""
    r = httpx.get(_url("/rest/v1/chats"), headers=_db_headers(), timeout=20,
                  params={"select": "data", "user_id": f"eq.{user_id}", "id": f"eq.{chat_id}"})
    r.raise_for_status()
    rows = r.json()
    if not rows:
        return
    thread_ids = [t["threadId"] for t in (rows[0]["data"].get("turns") or []) if t.get("threadId")]
    if thread_ids:
        httpx.delete(_url("/rest/v1/assessments"), headers=_db_headers(), timeout=20, params={
            "user_id": f"eq.{user_id}", "thread_id": f"in.({','.join(thread_ids)})"}).raise_for_status()
    httpx.delete(_url("/rest/v1/chats"), headers=_db_headers(), timeout=20,
                 params={"user_id": f"eq.{user_id}", "id": f"eq.{chat_id}"}).raise_for_status()
