"""Which other websites may call this copy's API from a browser (audit SEC-012).

Before: every copy, live included, accepted http://localhost:3000 and
"https://*.railway.app". Flask-CORS reads a pattern with * as an unanchored
regex, so https://xrailway.app.evil.example was accepted too, with
credentials. Now a copy on Railway accepts only its own address (https),
plus CORS_ALLOWED_ORIGINS if set; a laptop copy accepts the dev server.
The cupq.com.au forms have their own list (routes/signup_routes.py,
routes/demo_request_routes.py).
"""
import os

LAPTOP = ["http://localhost:3000", "http://127.0.0.1:3000"]


def _host(value):
    return (value or "").strip().replace("https://", "").replace("http://", "").strip("/")


def allowed_sites(env=None):
    env = os.environ if env is None else env
    on_server = bool(env.get("RAILWAY_ENVIRONMENT") or env.get("RAILWAY_PUBLIC_DOMAIN"))
    explicit = [o.strip().rstrip("/") for o in (env.get("CORS_ALLOWED_ORIGINS") or "").split(",")]
    # Full origins only: a scheme, and no pattern characters Flask-CORS would
    # treat as a regex.
    sites = [o for o in explicit if o.startswith(("https://", "http://")) and not any(c in o for c in "*?[]()^$\\")]
    if not on_server:
        sites += LAPTOP
    for var in ("RAILWAY_PUBLIC_DOMAIN", "RAILWAY_STATIC_URL"):
        host = _host(env.get(var))
        if host:
            sites.append(f"https://{host}")
    if env.get("CORS_ALLOW_ANY_ORIGIN", "").lower() == "true":
        sites.append("*")
    out = []
    for s in sites:
        if s not in out:
            out.append(s)
    return out
