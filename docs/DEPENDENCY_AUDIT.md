# Dependency audit

Roadmap task S1-8. CI runs `pip-audit` (Python) and `npm audit` (frontend) on
every PR as an **informational** job: it reports, it doesn't block, because the
remaining findings below need deliberate, staged upgrades rather than a merge
gate.

## Python (runs on the live server, so it matters most)

Audited 11 Oct 2026 against `requirements.txt`.

**Batch 1: done (low risk: patch/minor versions, or unused packages)**

| Package | Was | Now | Why |
|---|---|---|---|
| werkzeug | 3.1.8 | 3.1.9 | 1 advisory |
| urllib3 | 2.7.0 | 2.8.0 | 3 advisories |
| requests | 2.31.0 | 2.33.0 | 6 advisories |
| python-dotenv | 1.0.0 | 1.2.2 | 2 advisories |
| pyjwt | 2.13.0 | 2.15.0 | 14 advisories (flask-jwt-extended's token library) |
| multidict | 6.7.1 | 6.9.1 | 1 advisory (pulled in by aiohttp) |
| bleach | 6.1.0 | 6.4.0 | 2 advisories (security_middleware.py input cleaning) |
| python-jose, ecdsa, rsa, pyasn1 | | removed | imported nowhere; jose alone had 5 advisories, ecdsa 2 with no fix |
| gunicorn | 21.2.0 | removed | not used: production starts with `python run_server.py` |

Checked by: fresh virtualenv from the new file (`pip check` clean),
`pytest tests/unit`, the server booted against a copy of the database with no
missing modules, and live calls: login refusal (401), a JWT-protected route
(200 with a real token, 401 with a bad one), the public menu, the demo-form
CORS preflight from cupq.com.au.

**Batch 2: needs staging (major versions)**

| Package | Now | Fix | Risk | Test before shipping |
|---|---|---|---|---|
| pillow | 10.1.0 | 12.3.0 | Label and QR image rendering | Print every label type to the mC-Label3 and TSP; compare QR codes |
| flask-cors | 4.0.0 | 6.0.0 | CORS behaviour changed between majors | Barista, display, kiosk, demo form from cupq.com.au, EventsAir app frame |

**Batch 3: needs staging plus a load test (server core)**

| Package | Now | Fix | Risk | Test before shipping |
|---|---|---|---|---|
| eventlet | 0.33.3 | 0.40.3 | The server's networking layer; the August hangs lived here | Load test on staging with a deliberately slow request; SMS and EventsAir calls; WebSockets |
| flask | 2.3.3 | 3.1.3 | Framework major; extensions must match | Full test suite and a run-through of every screen on staging |

These wait for the staging copy (roadmap S1-2) so they never reach an event
untested.

## Frontend

`npm audit --omit=dev` reports ~112 findings, but nearly all are in the build
tooling (react-scripts and its webpack, postcss and yaml chain), which runs
on the build machine and never reaches a browser. Moving off react-scripts is
the real fix and is a separate, larger job. The audit runs in CI so new
runtime findings stand out.
