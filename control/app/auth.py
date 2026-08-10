"""
auth.py - Optional single-password WebUI / API authentication.

Empty password (default) = no login required (upgrade-compatible).
When a password is set (config hash or VOWIFI_WEB_PASSWORD), management
HTTP + WebSocket require a 30-day HMAC-signed HttpOnly cookie.
"""
from __future__ import annotations

import base64
import hashlib
import hmac
import os
import secrets
import time
from typing import Any
from urllib.parse import urlparse

from fastapi import Request, Response
from fastapi.responses import JSONResponse

COOKIE_NAME = "vowifi_session"
COOKIE_MAX_AGE = 30 * 24 * 3600  # 30 days
WS_CLOSE_AUTH = 4401
ENGINE_TOKEN_HEADER = "X-Vowifi-Engine-Token"


def engine_callback_authorized(
    expected_token: str,
    got_token: str,
    *,
    peer_host: str = "",
    x_forwarded_for: str = "",
    container_ip: str | None = None,
    container_ips: list[str] | None = None,
) -> bool:
    """Admit an engine → control callback.

    Token match wins. Otherwise (legacy containers without the header) accept only
    when the TCP peer or first X-Forwarded-For hop equals one of that engine's
    live container IPs.
    """
    expected = (expected_token or "").strip()
    got = (got_token or "").strip()
    if expected and got and hmac.compare_digest(got.encode("utf-8"), expected.encode("utf-8")):
        return True
    ips: list[str] = []
    if container_ips:
        ips.extend(str(ip).strip() for ip in container_ips if ip and str(ip).strip())
    if container_ip and str(container_ip).strip():
        cip = str(container_ip).strip()
        if cip not in ips:
            ips.append(cip)
    if not ips:
        return False
    peer = (peer_host or "").strip()
    if peer and peer in ips:
        return True
    xf = (x_forwarded_for or "").split(",")[0].strip()
    return bool(xf and xf in ips)


# ---------------------------------------------------------------------------
# Auth-surface map (post Web-static-password). Keep in sync with main.py routes.
#
# Engine → control (ONLY HTTP callback; skipped by cookie middleware, uses
# X-Vowifi-Engine-Token or legacy container-IP match):
#   POST /api/engine/event
#     sms_in          → store + WS + webhook/Telegram   (inbound SMS UI)
#     call_in/out/result → call log + WS + push         (Recent calls)
#     tunnel_*/pcscf/registered/unregistered → status push
#     cp_mode_resolved → persist CP family
#
# Control → engine (AMI / Docker / files — NOT affected by engine callback token):
#   SMS send, Originate/hangup, registration poll, logs, start/stop, eSIM/LPA, PIN
#
# Browser → control (cookie session when password set):
#   All other /api/* + /ws. Softphone media/SIP is direct to the engine (WSS/SIP),
#   not via these management APIs.
# ---------------------------------------------------------------------------

# scrypt params (OWASP-ish; tune for Pi-class hosts)
_SCRYPT_N = 2 ** 14
_SCRYPT_R = 8
_SCRYPT_P = 1
_SCRYPT_DKLEN = 32

# Login rate limit: per client IP
_LOGIN_WINDOW_S = 60.0
_LOGIN_MAX_FAILS = 8
_login_fails: dict[str, list[float]] = {}


def hash_password(password: str, salt: bytes | None = None) -> str:
    """Return `scrypt$<n>$<r>$<p>$<salt_b64>$<dk_b64>`."""
    if salt is None:
        salt = secrets.token_bytes(16)
    dk = hashlib.scrypt(
        password.encode("utf-8"),
        salt=salt,
        n=_SCRYPT_N,
        r=_SCRYPT_R,
        p=_SCRYPT_P,
        dklen=_SCRYPT_DKLEN,
    )
    return (
        f"scrypt${_SCRYPT_N}${_SCRYPT_R}${_SCRYPT_P}$"
        f"{base64.urlsafe_b64encode(salt).decode()}$"
        f"{base64.urlsafe_b64encode(dk).decode()}"
    )


def verify_password(password: str, stored: str) -> bool:
    """Constant-time verify against a hash_password() string."""
    try:
        parts = stored.split("$")
        if len(parts) != 6 or parts[0] != "scrypt":
            return False
        _, n_s, r_s, p_s, salt_b64, dk_b64 = parts
        salt = base64.urlsafe_b64decode(salt_b64.encode())
        expected = base64.urlsafe_b64decode(dk_b64.encode())
        got = hashlib.scrypt(
            password.encode("utf-8"),
            salt=salt,
            n=int(n_s),
            r=int(r_s),
            p=int(p_s),
            dklen=len(expected),
        )
        return hmac.compare_digest(got, expected)
    except Exception:
        return False


def _b64u(data: bytes) -> str:
    return base64.urlsafe_b64encode(data).rstrip(b"=").decode("ascii")


def _b64u_decode(s: str) -> bytes:
    pad = "=" * (-len(s) % 4)
    return base64.urlsafe_b64decode((s + pad).encode("ascii"))


def sign_session(secret: str, version: int, max_age: int = COOKIE_MAX_AGE,
                 now: float | None = None) -> str:
    """Create a signed session token: v.<version>.<exp>.<sig>."""
    if now is None:
        now = time.time()
    exp = int(now + max_age)
    payload = f"v.{int(version)}.{exp}"
    sig = hmac.new(secret.encode("utf-8"), payload.encode("utf-8"),
                   hashlib.sha256).digest()
    return f"{payload}.{_b64u(sig)}"


def verify_session(secret: str, token: str, expected_version: int,
                   now: float | None = None) -> bool:
    """Validate signature, expiry, and credential version."""
    if now is None:
        now = time.time()
    try:
        parts = token.split(".")
        if len(parts) != 4 or parts[0] != "v":
            return False
        _, ver_s, exp_s, sig_b64 = parts
        ver = int(ver_s)
        exp = int(exp_s)
        if ver != int(expected_version):
            return False
        if exp < int(now):
            return False
        payload = f"v.{ver}.{exp}"
        expected = hmac.new(secret.encode("utf-8"), payload.encode("utf-8"),
                            hashlib.sha256).digest()
        return hmac.compare_digest(_b64u_decode(sig_b64), expected)
    except Exception:
        return False


def auth_required_response(detail: str = "Authentication required") -> JSONResponse:
    return JSONResponse(
        status_code=401,
        content={"detail": {"code": "auth_required", "message": detail}},
    )


def set_session_cookie(response: Response, token: str, secure: bool = True,
                       max_age: int = COOKIE_MAX_AGE) -> None:
    # Only Max-Age (not expires=seconds): an integer `expires` is treated as a Unix
    # timestamp by Starlette/browsers, which would land near 1970 for COOKIE_MAX_AGE.
    response.set_cookie(
        key=COOKIE_NAME,
        value=token,
        max_age=max_age,
        path="/",
        httponly=True,
        samesite="strict",
        secure=secure,
    )


def clear_session_cookie(response: Response, secure: bool = True) -> None:
    response.delete_cookie(
        key=COOKIE_NAME,
        path="/",
        httponly=True,
        samesite="strict",
        secure=secure,
    )


def request_wants_secure_cookie(request: Request) -> bool:
    """Prefer Secure cookies under HTTPS (or behind TLS-terminating proxies)."""
    if request.url.scheme == "https":
        return True
    xf = (request.headers.get("x-forwarded-proto") or "").split(",")[0].strip().lower()
    return xf == "https"


def client_ip(request: Request) -> str:
    xf = (request.headers.get("x-forwarded-for") or "").split(",")[0].strip()
    if xf:
        return xf
    if request.client and request.client.host:
        return request.client.host
    return "unknown"


def login_rate_limited(ip: str, now: float | None = None) -> bool:
    if now is None:
        now = time.time()
    fails = _login_fails.get(ip) or []
    fails = [t for t in fails if now - t < _LOGIN_WINDOW_S]
    _login_fails[ip] = fails
    return len(fails) >= _LOGIN_MAX_FAILS


def record_login_failure(ip: str, now: float | None = None) -> None:
    if now is None:
        now = time.time()
    fails = _login_fails.setdefault(ip, [])
    fails.append(now)
    # prune
    _login_fails[ip] = [t for t in fails if now - t < _LOGIN_WINDOW_S]


def clear_login_failures(ip: str) -> None:
    _login_fails.pop(ip, None)


def reset_login_rate_limit_for_tests() -> None:
    _login_fails.clear()


def origin_ok(request: Request) -> bool:
    """CSRF: mutating requests with a session cookie must be same-origin."""
    origin = request.headers.get("origin")
    if not origin:
        # Non-browser clients (curl, engine) often omit Origin; allow when no Origin.
        # Cookie-bearing browser POSTs always send Origin on cross-site; same-site
        # navigations may omit it for GET but we only call this on mutating methods.
        return True
    try:
        o = urlparse(origin)
        host = request.headers.get("host") or request.url.netloc
        return (o.scheme, o.netloc.lower()) == (request.url.scheme, host.lower()) \
            or _origin_host_matches(o.netloc, host)
    except Exception:
        return False


def _origin_host_matches(origin_netloc: str, host_header: str) -> bool:
    """Compare host:port ignoring default ports / case."""
    return origin_netloc.lower() == host_header.lower()


# Paths that stay public even when a password is configured.
PUBLIC_API_PREFIXES = (
    "/api/auth/status",
    "/api/auth/login",
    "/api/auth/logout",
)
PUBLIC_EXACT = {
    "/api/auth/status",
    "/api/auth/login",
    "/api/auth/logout",
}


def is_public_path(path: str) -> bool:
    if path in PUBLIC_EXACT:
        return True
    # Static SPA assets + root document are public; API/ws are not.
    if path.startswith("/assets/"):
        return True
    if path in ("/", "/favicon.ico", "/index.html"):
        return True
    # OpenAPI docs — require auth when password is set (checked by middleware).
    return False


def is_api_or_docs(path: str) -> bool:
    return (
        path.startswith("/api/")
        or path == "/ws"
        or path in ("/docs", "/redoc", "/openapi.json")
        or path.startswith("/docs/")
        or path.startswith("/redoc/")
    )


def public_auth_status(auth_cfg: dict[str, Any]) -> dict[str, Any]:
    """Safe fields for GET /api/auth/status and nested under /api/settings."""
    return {
        "enabled": bool(auth_cfg.get("enabled")),
        "authenticated": bool(auth_cfg.get("authenticated")),
        "managed_by_env": bool(auth_cfg.get("managed_by_env")),
    }
