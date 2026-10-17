# Sign-in (JWT): what the backend needs

The frontend already does its part. This file is for the backend owner: about 60 lines of FastAPI turn sign-in on.
Until the backend does this, it accepts requests from anyone who knows its URL, and the app shows no sign-in screen.

## Contract

| | |
|---|---|
| `POST /auth/login` | Body `{"username": "...", "password": "..."}`. 200: `{"access_token": "<JWT>", "token_type": "bearer", "expires_in": 28800, "user": {"name": "AFS jury"}}`. Wrong credentials: 401 `{"error": {"code": "invalid_credentials", "message": "..."}}`. Open, no token needed. |
| Every other route except `GET /health` | Requires `Authorization: Bearer <JWT>`. Missing, invalid or expired token: 401 `{"error": {"code": "unauthorized" or "token_expired", "message": "..."}}`. |
| `GET /assessments/{id}/events` (SSE) | The browser's `EventSource` cannot send headers, so it sends `?access_token=<JWT>` instead. Accept the token there too. |
| `GET /health` | Stays open and adds `"auth_required": true`, so the app shows the sign-in screen before the first request. |
| CORS | Allow the `Authorization` header (`allow_headers`), otherwise the browser blocks every signed-in request. |

The JWT is HS256 with claims `sub` (username), `name` (shown in the app), `iat` and `exp`. The app reads `exp` to know when to send people back to sign-in; the backend is what checks the signature.

## Code (`backend/auth.py`, needs `pip install pyjwt`)

```python
"""JWT sign-in for the AFS assistant (contract in frontend/AUTH.md)."""
import hashlib
import hmac
import json
import os
import time

import jwt
from fastapi import APIRouter, HTTPException, Request
from pydantic import BaseModel

JWT_SECRET = os.environ.get("JWT_SECRET", "")           # python -c "import secrets; print(secrets.token_urlsafe(48))"
JWT_TTL_S = int(os.environ.get("JWT_TTL_S", "28800"))   # 8 hours
# AUTH_USERS: {"jury": {"name": "AFS jury", "hash": "pbkdf2$310000$<salt>$<hash>"}, ...}  (hashes from: python auth.py "a password")
USERS: dict = json.loads(os.environ.get("AUTH_USERS", "{}"))


def hash_password(password: str, iterations: int = 310_000) -> str:
    salt = os.urandom(16)
    digest = hashlib.pbkdf2_hmac("sha256", password.encode(), salt, iterations)
    return f"pbkdf2${iterations}${salt.hex()}${digest.hex()}"


def verify_password(password: str, stored: str) -> bool:
    try:
        _, iterations, salt, digest = stored.split("$")
        test = hashlib.pbkdf2_hmac("sha256", password.encode(), bytes.fromhex(salt), int(iterations))
    except ValueError:
        return False
    return hmac.compare_digest(test.hex(), digest)


def fail(status: int, code: str, message: str) -> HTTPException:
    return HTTPException(status, {"error": {"code": code, "message": message}})


router = APIRouter()


class Login(BaseModel):
    username: str
    password: str


@router.post("/auth/login")
def login(body: Login):
    if not JWT_SECRET:
        raise fail(500, "auth_not_configured", "JWT_SECRET is not set on the server.")
    username = body.username.strip().lower()
    user = USERS.get(username)
    if not user or not verify_password(body.password, user["hash"]):
        raise fail(401, "invalid_credentials", "Wrong username or password.")
    now = int(time.time())
    name = user.get("name", username)
    token = jwt.encode({"sub": username, "name": name, "iat": now, "exp": now + JWT_TTL_S}, JWT_SECRET, algorithm="HS256")
    return {"access_token": token, "token_type": "bearer", "expires_in": JWT_TTL_S, "user": {"name": name}}


def require_user(request: Request) -> dict:
    """Dependency for every route except /health and /auth/login."""
    header = request.headers.get("authorization", "")
    # EventSource cannot send headers, so the events stream passes the token as ?access_token=
    token = header[7:] if header.lower().startswith("bearer ") else request.query_params.get("access_token")
    if not token or not JWT_SECRET:
        raise fail(401, "unauthorized", "Sign in to continue.")
    try:
        return jwt.decode(token, JWT_SECRET, algorithms=["HS256"])
    except jwt.ExpiredSignatureError:
        raise fail(401, "token_expired", "Your session expired. Sign in again.")
    except jwt.InvalidTokenError:
        raise fail(401, "unauthorized", "Sign in to continue.")


if __name__ == "__main__":  # python auth.py "a password"  ->  the hash to put in AUTH_USERS
    import sys

    print(hash_password(sys.argv[1]))
```

## Wiring it into the app

```python
from fastapi import Depends
from fastapi.middleware.cors import CORSMiddleware
from auth import require_user, router as auth_router

app.include_router(auth_router)                 # POST /auth/login stays open
protected = [Depends(require_user)]
# Add dependencies=protected to every route except /health, for example:
#   @app.get("/cases", dependencies=protected)
# or put the routes on one APIRouter and: app.include_router(api_router, dependencies=protected)

# In /health, add:  "auth_required": True

app.add_middleware(
    CORSMiddleware,
    allow_origins=CORS_ORIGINS,
    allow_methods=["*"],
    allow_headers=["Authorization", "Content-Type", "Accept", "Last-Event-ID"],
)
```

## Environment on the backend host

- `JWT_SECRET`: a long random string. Never commit it.
- `AUTH_USERS`: one entry per person who may use the app, with a password hash from `python auth.py "their password"`. Remove an entry to remove that person.
- `JWT_TTL_S` (optional): token lifetime in seconds, 8 hours by default.

## Good to know

- The token in the events URL can end up in access logs. Keep the lifetime short and leave query strings out of the logs if the host allows it.
- Rate-limit `POST /auth/login` (for example with `slowapi`) to slow down password guessing.
- To keep people from opening each other's runs, store `sub` with each thread and answer 404 when another user asks for it.
- The frontend keeps the token in `localStorage` until it expires or the person signs out, and keeps each person's chat history separate in that browser.
