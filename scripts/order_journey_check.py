#!/usr/bin/env python3
"""One order, start to finish, against a running server (roadmap X7-12).

    python scripts/order_journey_check.py http://127.0.0.1:5001

Walks the path every event depends on and fails loudly at the first step
that breaks:

  1. a customer orders on the web (/api/display/order, with a phone)
  2. a barista signs in and starts it
  3. the barista marks it ready
  4. the customer's tracking page shows it ready
  5. the "ready" text is queued for that phone (order_messages)

Needs DEFAULT_ADMIN_USERNAME / DEFAULT_ADMIN_PASSWORD (the server's first
admin, created at boot from the same variables) and DATABASE_URL for step
5. Run it only against a throwaway server with TESTING_MODE=True: texts
are stubbed there, never sent. It refuses cupq.app and demo outright.
"""

import json
import os
import sys
import urllib.error
import urllib.request

PHONE = "+61400000999"  # a made-up number; TESTING_MODE stubs the send
NAME = "Journey Check"


def call(base, method, path, body=None, token=None):
    data = json.dumps(body).encode() if body is not None else None
    req = urllib.request.Request(base + path, data=data, method=method)
    req.add_header("Content-Type", "application/json")
    if token:
        req.add_header("Authorization", "Bearer " + token)
    try:
        with urllib.request.urlopen(req, timeout=30) as r:
            return r.status, json.loads(r.read() or b"{}")
    except urllib.error.HTTPError as e:
        raw = e.read()
        try:
            return e.code, json.loads(raw or b"{}")
        except ValueError:
            return e.code, {"raw": raw[:300].decode("utf-8", "replace")}


def step(n, label, ok, detail):
    print(("PASS" if ok else "FAIL") + f"  {n}. {label}: {detail}")
    if not ok:
        sys.exit(1)


def main():
    base = (sys.argv[1] if len(sys.argv) > 1 else "http://127.0.0.1:5001").rstrip("/")
    if "cupq.app" in base:
        sys.exit("Refusing: this check places and completes a real order. Local/CI only.")
    if os.getenv("TESTING_MODE", "").lower() != "true":
        sys.exit("Refusing: set TESTING_MODE=True so no text is really sent.")

    code, menu = call(base, "GET", "/api/display/menu")
    drinks = [str(d.get("name") or d.get("id") or "").lower()
              for d in ((menu or {}).get("coffee_types") or (menu or {}).get("drinks") or [])
              if isinstance(d, dict)]
    drink = "latte" if not drinks or "latte" in drinks else drinks[0]

    code, body = call(base, "POST", "/api/display/order", {
        "name": NAME, "coffee_type": drink, "milk": "full cream", "size": "medium",
        "sugar": "No sugar", "phone": PHONE,
    })
    data = (body or {}).get("data") or {}
    number = (body or {}).get("order_number") or data.get("order_number")
    station = (body or {}).get("station_id") or data.get("station_id")
    step(1, "customer orders on the web", code == 200 and bool(number),
         f"HTTP {code}, order {number}" + ("" if number else f" {str(body)[:300]}"))

    code, body = call(base, "POST", "/api/auth/login", {
        "username": os.environ["DEFAULT_ADMIN_USERNAME"],
        "password": os.environ["DEFAULT_ADMIN_PASSWORD"],
    })
    body = body or {}
    token = (body.get("token") or body.get("access_token")
             or (body.get("data") or {}).get("access_token"))
    step(2, "staff sign in", code == 200 and bool(token), f"HTTP {code}")

    code, body = call(base, "POST", f"/api/orders/{number}/start",
                      {"station_id": station} if station else {}, token)
    step(3, "barista starts it", code == 200 and (body or {}).get("success") is not False,
         f"HTTP {code} {str(body)[:200]}")

    code, body = call(base, "POST", f"/api/orders/{number}/complete", {}, token)
    step(4, "barista marks it ready", code == 200 and (body or {}).get("success") is not False,
         f"HTTP {code} {str(body)[:200]}")

    code, body = call(base, "GET", f"/api/orders/{number}/track")
    status = str((body or {}).get("status") or "").lower()
    step(5, "customer page shows it ready", code == 200 and status in ("completed", "ready"),
         f"HTTP {code}, status {status!r}")

    import psycopg2  # only needed for the last step

    conn = psycopg2.connect(os.environ["DATABASE_URL"])
    try:
        cur = conn.cursor()
        cur.execute("SELECT message FROM order_messages WHERE order_number = %s",
                    (str(number),))
        texts = [r[0] or "" for r in cur.fetchall()]
    finally:
        conn.close()
    ready_text = [t for t in texts if "ready" in t.lower()]
    step(6, "the ready text is queued for the customer", bool(ready_text),
         f"{len(texts)} text(s) filed for order {number}"
         + (f": {ready_text[0][:80]!r}" if ready_text else f" {texts!r}"))
    print("Order journey OK")


if __name__ == "__main__":
    main()
