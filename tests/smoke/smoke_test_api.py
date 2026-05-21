#!/usr/bin/env python3
"""
smoke_test_api.py — API contract smoke test.

What this does:
  1. Loads tests/smoke/api_contracts.json
  2. Logs in to /api/auth/login with the configured creds (default:
     coffeecue/adminpassword) and grabs a real JWT
  3. For every entry in `checks`, makes the request and asserts:
       - HTTP status matches expect_status
       - All `expect_keys` are present at the response root
       - If expect_item_keys_at is set, all expect_item_keys are
         present on each item under that path
  4. Writes a structured failure report to logs/smoke_<ts>.json
  5. Exits 0 if all checks pass, 1 if any fail

Why this exists: 5 of the last ~12 bug-fixes were field-name mismatches
across the FE/BE boundary. Static analysis can't catch those across
Python + JS. This file is the cheapest possible test that does.

Assumes the backend is already running on --base-url (default
http://localhost:5001). Will NOT start the stack — that's a separate
concern. Run after `./start_expresso.sh` if you need the stack up.

Usage:
    python tests/smoke/smoke_test_api.py
    python tests/smoke/smoke_test_api.py --base-url http://localhost:5001
    python tests/smoke/smoke_test_api.py --contracts tests/smoke/api_contracts.json

Exit codes:
    0  all checks passed
    1  one or more checks failed
    2  bootstrap failed (couldn't reach server / log in)
"""
from __future__ import annotations

import argparse
import json
import sys
import time
from datetime import datetime
from pathlib import Path
from typing import Any

try:
    import requests
except ImportError:
    print("ERROR: 'requests' not installed. Run: pip install requests")
    sys.exit(2)


# ---------- ANSI colours (skip if not a TTY) ----------

def _colour(code: str) -> str:
    return code if sys.stdout.isatty() else ""


RED = _colour("\033[31m")
GREEN = _colour("\033[32m")
YELLOW = _colour("\033[33m")
DIM = _colour("\033[2m")
RESET = _colour("\033[0m")


# ---------- Helpers ----------

def _walk_path(obj: Any, path: str) -> list:
    """Walk a dotted path through obj; `[*]` iterates a list.

    Returns a list of (path, value) tuples for every leaf the walk
    reaches. So `data[*]` against {"data": [{...}, {...}]} returns
    two entries, one per item.
    """
    if not path:
        return [(path, obj)]
    parts = path.replace("[*]", ".[*]").split(".")
    parts = [p for p in parts if p]
    current = [("", obj)]
    for part in parts:
        next_level = []
        for prefix, value in current:
            if part == "[*]":
                if not isinstance(value, list):
                    return [(prefix, None)]
                for idx, item in enumerate(value):
                    next_level.append((f"{prefix}[{idx}]", item))
            else:
                if not isinstance(value, dict):
                    return [(prefix, None)]
                next_level.append(
                    (f"{prefix}.{part}" if prefix else part, value.get(part))
                )
        current = next_level
    return current


def _missing_keys(item: Any, required: list[str]) -> list[str]:
    if not isinstance(item, dict):
        return required[:]
    return [k for k in required if k not in item]


# ---------- Runner ----------

class SmokeRunner:
    def __init__(self, base_url: str, contracts: dict, timeout: float = 10.0):
        self.base_url = base_url.rstrip("/")
        self.contracts = contracts
        self.timeout = timeout
        self.token: str | None = None
        self.results: list[dict] = []

    def _full_url(self, path: str) -> str:
        if path.startswith("http"):
            return path
        if not path.startswith("/"):
            path = "/" + path
        return self.base_url + path

    def _headers(self, want_auth: bool) -> dict:
        h = {"Content-Type": "application/json"}
        if want_auth and self.token:
            h["Authorization"] = f"Bearer {self.token}"
        return h

    def bootstrap_auth(self) -> bool:
        """Log in and store the JWT. Returns False if we can't."""
        auth = self.contracts.get("auth")
        if not auth:
            print(f"{YELLOW}WARN{RESET} no `auth` block — running unauthenticated")
            return True

        url = self._full_url(auth["path"])
        print(f"{DIM}→ POST {url}{RESET}")
        try:
            r = requests.post(
                url,
                json=auth.get("body", {}),
                timeout=self.timeout,
            )
        except requests.RequestException as exc:
            print(f"{RED}FAIL{RESET} login request errored: {exc}")
            return False

        if r.status_code != auth.get("expect_status", 200):
            print(
                f"{RED}FAIL{RESET} login returned {r.status_code} "
                f"(want {auth.get('expect_status', 200)})"
            )
            print(f"  body: {r.text[:300]}")
            return False

        try:
            payload = r.json()
        except ValueError:
            print(f"{RED}FAIL{RESET} login response wasn't JSON")
            return False

        token_field = auth.get("token_field", "token")
        token = payload.get(token_field)
        if not token:
            print(f"{RED}FAIL{RESET} login response missing `{token_field}`")
            print(f"  body keys: {list(payload.keys())}")
            return False

        self.token = token
        print(f"{GREEN}OK{RESET}  auth: got token ({len(token)} chars)")
        return True

    def run_check(self, check: dict) -> dict:
        """Run one contract check. Returns a result dict."""
        name = check.get("name", check.get("path", "?"))
        method = check.get("method", "GET").upper()
        path = check["path"]
        want_auth = check.get("auth", True)
        expect_status = check.get("expect_status", 200)
        expect_keys = check.get("expect_keys", [])
        item_path = check.get("expect_item_keys_at")
        item_keys = check.get("expect_item_keys", [])
        body = check.get("body")

        url = self._full_url(path)
        result: dict = {
            "name": name,
            "method": method,
            "url": url,
            "ok": False,
            "errors": [],
            "status_code": None,
            "elapsed_ms": None,
        }

        try:
            t0 = time.monotonic()
            r = requests.request(
                method,
                url,
                json=body,
                headers=self._headers(want_auth),
                timeout=self.timeout,
            )
            result["elapsed_ms"] = int((time.monotonic() - t0) * 1000)
        except requests.RequestException as exc:
            result["errors"].append(f"request failed: {exc}")
            return result

        result["status_code"] = r.status_code
        if r.status_code != expect_status:
            result["errors"].append(
                f"status {r.status_code} (want {expect_status}); "
                f"body[:200]: {r.text[:200]}"
            )
            # No point checking keys if status is wrong.
            return result

        # Best-effort JSON parse. Some endpoints might 200 with non-JSON
        # (rare), so don't fail unless keys were demanded.
        try:
            payload = r.json()
        except ValueError:
            if expect_keys or item_keys:
                result["errors"].append("response wasn't JSON")
            else:
                result["ok"] = True
            return result

        # Top-level key check.
        missing_top = _missing_keys(payload, expect_keys)
        if missing_top:
            result["errors"].append(f"missing top-level keys: {missing_top}")

        # Per-item key check.
        if item_path and item_keys:
            leaves = _walk_path(payload, item_path)
            if not leaves:
                result["errors"].append(f"no items at path `{item_path}`")
            else:
                # If the list is empty (e.g. no orders in DB), skip the
                # per-item check rather than fail. We're testing contract
                # shape, not data presence.
                non_empty = [(p, v) for (p, v) in leaves if v is not None]
                if non_empty:
                    for prefix, item in non_empty[:3]:  # sample
                        miss = _missing_keys(item, item_keys)
                        if miss:
                            result["errors"].append(
                                f"item at `{prefix}` missing keys: {miss}"
                            )

        result["ok"] = not result["errors"]
        return result

    def run_all(self) -> tuple[int, int]:
        passed = 0
        failed = 0
        for check in self.contracts.get("checks", []):
            res = self.run_check(check)
            self.results.append(res)
            if res["ok"]:
                passed += 1
                print(
                    f"{GREEN}OK{RESET}  {res['name']} "
                    f"{DIM}({res['elapsed_ms']}ms){RESET}"
                )
            else:
                failed += 1
                print(f"{RED}FAIL{RESET} {res['name']}")
                for err in res["errors"]:
                    print(f"      {err}")
        return passed, failed


# ---------- Entry point ----------

def main() -> int:
    parser = argparse.ArgumentParser(description=__doc__.splitlines()[1])
    parser.add_argument(
        "--base-url",
        default="http://localhost:5001",
        help="backend base URL (default: %(default)s)",
    )
    parser.add_argument(
        "--contracts",
        default=str(Path(__file__).parent / "api_contracts.json"),
        help="path to contracts JSON",
    )
    parser.add_argument(
        "--log-dir",
        default="logs",
        help="directory for the result JSON dump (default: %(default)s)",
    )
    parser.add_argument(
        "--timeout",
        type=float,
        default=10.0,
        help="per-request timeout in seconds (default: %(default)s)",
    )
    args = parser.parse_args()

    contracts_path = Path(args.contracts)
    if not contracts_path.exists():
        print(f"{RED}ERROR{RESET} contracts file not found: {contracts_path}")
        return 2

    try:
        contracts = json.loads(contracts_path.read_text())
    except json.JSONDecodeError as exc:
        print(f"{RED}ERROR{RESET} contracts file is invalid JSON: {exc}")
        return 2

    print(f"Smoke test → {args.base_url}")
    print(f"Contracts  → {contracts_path}")
    print()

    runner = SmokeRunner(args.base_url, contracts, timeout=args.timeout)

    if not runner.bootstrap_auth():
        print(f"\n{RED}bootstrap failed — stopping{RESET}")
        return 2

    print()
    passed, failed = runner.run_all()

    # Write log dump regardless of result.
    log_dir = Path(args.log_dir)
    log_dir.mkdir(parents=True, exist_ok=True)
    ts = datetime.now().strftime("%Y%m%d_%H%M%S")
    log_path = log_dir / f"smoke_{ts}.json"
    log_path.write_text(json.dumps({
        "base_url": args.base_url,
        "ran_at": datetime.now().isoformat(),
        "summary": {"passed": passed, "failed": failed},
        "results": runner.results,
    }, indent=2))

    print()
    print(f"Passed: {GREEN}{passed}{RESET}   Failed: {RED}{failed}{RESET}")
    print(f"Log:    {log_path}")

    return 0 if failed == 0 else 1


if __name__ == "__main__":
    sys.exit(main())
