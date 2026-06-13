#!/usr/bin/env python
"""Coffee Cue load test — event-style burst simulator.

Why this exists
---------------
We've been sizing Railway plans by gut feel. Before charging clients
per-event we need to know: at how many concurrent baristas + how many
SMS/min does the current backend start dropping orders or timing out?

The harness simulates a real event:
- Several concurrent walk-in flows (a barista at each station, adding
  orders as fast as a real one would)
- A flurry of GET reads (polling pending/in-progress, refreshing
  inventory, status callbacks)
- An optional inbound-SMS stream (POST /api/sms with Twilio-shaped
  webhook bodies, parsed by the same NLP)

Output: p50/p95/p99 + error rate per endpoint + total throughput.
That's the number to put in the deployment-sizing doc.

Usage
-----
  # Smoke: 5 workers, 30s burst — confirms harness wiring
  python tests/load/run_load_test.py --workers 5 --duration 30

  # Real load: 20 workers, 5 min burst, ramp 30s
  python tests/load/run_load_test.py --workers 20 --duration 300 --ramp 30

  # Hammer ONLY the walk-in path (worst-case write contention)
  python tests/load/run_load_test.py --workers 10 --only walkin

  # Include the inbound-SMS path (TESTING_MODE must be on)
  python tests/load/run_load_test.py --workers 10 --include-sms

  # Different base URL (test against staging or Railway)
  python tests/load/run_load_test.py --base-url https://coffee-cue-staging.up.railway.app

The harness is pure-stdlib + `requests` — no new deps. Runs on the same
laptop or a Railway one-off.

Safety
------
- The load test runs against whatever --base-url you point at. There's
  no "are you sure you want to hammer production" guard — be deliberate.
- Created orders show "LOADTEST" in their notes field so you can find
  and delete them later: `DELETE FROM orders WHERE notes LIKE '%LOADTEST%'`.
- Default credentials are coffeecue/adminpassword. Pass --username and
  --password to use different ones.
"""
from __future__ import annotations

import argparse
import json
import random
import re
import statistics
import sys
import threading
import time
from concurrent.futures import ThreadPoolExecutor, as_completed
from dataclasses import dataclass, field
from typing import Callable

try:
    import requests
except ImportError:
    sys.exit("requests not installed — pip install requests")


# ---------------------------------------------------------------------------
# Latency bookkeeping
# ---------------------------------------------------------------------------

@dataclass
class EndpointStats:
    """Per-endpoint latency + error tally."""
    name: str
    latencies_ms: list[float] = field(default_factory=list)
    errors: int = 0
    statuses: dict[int, int] = field(default_factory=dict)
    # RLock (not Lock): summary() holds the lock and calls percentile(),
    # which re-acquires it. A plain Lock is non-reentrant and would
    # self-deadlock the reporting phase (workers finish, report hangs
    # forever). RLock lets the same thread re-enter. Found via stack
    # dump during the first real load run.
    _lock: threading.RLock = field(default_factory=threading.RLock)

    def record(self, latency_ms: float, status_code: int, ok: bool):
        with self._lock:
            self.latencies_ms.append(latency_ms)
            self.statuses[status_code] = self.statuses.get(status_code, 0) + 1
            if not ok:
                self.errors += 1

    def _percentile_locked(self, p: float) -> float | None:
        """Percentile assuming the caller already holds self._lock."""
        if not self.latencies_ms:
            return None
        xs = sorted(self.latencies_ms)
        # Linear-interp percentile so we're not biased by tiny samples.
        k = (len(xs) - 1) * (p / 100)
        f = int(k)
        c = min(f + 1, len(xs) - 1)
        return xs[f] + (xs[c] - xs[f]) * (k - f)

    def percentile(self, p: float) -> float | None:
        with self._lock:
            return self._percentile_locked(p)

    def summary(self) -> dict:
        with self._lock:
            n = len(self.latencies_ms)
            return {
                'name': self.name,
                'requests': n,
                'errors': self.errors,
                'error_rate': (self.errors / n) if n else 0.0,
                'p50_ms': self._percentile_locked(50),
                'p95_ms': self._percentile_locked(95),
                'p99_ms': self._percentile_locked(99),
                'max_ms': max(self.latencies_ms) if self.latencies_ms else None,
                'mean_ms': statistics.mean(self.latencies_ms) if self.latencies_ms else None,
                'statuses': dict(self.statuses),
            }


class Stats:
    """Global stats registry. Thread-safe."""
    def __init__(self):
        self._endpoints: dict[str, EndpointStats] = {}
        self._lock = threading.Lock()

    def get(self, name: str) -> EndpointStats:
        with self._lock:
            ep = self._endpoints.get(name)
            if ep is None:
                ep = EndpointStats(name)
                self._endpoints[name] = ep
            return ep

    def all(self) -> list[EndpointStats]:
        with self._lock:
            return list(self._endpoints.values())


# ---------------------------------------------------------------------------
# HTTP helper — wraps requests so every call records latency.
# ---------------------------------------------------------------------------

class Client:
    def __init__(self, base_url: str, token: str, stats: Stats, timeout: float = 10.0):
        self.base_url = base_url.rstrip('/')
        self.token = token
        self.stats = stats
        self.timeout = timeout

    def call(self, method: str, path: str, *, label: str | None = None,
             json_body=None, ok_statuses=None) -> requests.Response | None:
        url = f"{self.base_url}{path}"
        headers = {'Authorization': f'Bearer {self.token}'} if self.token else {}
        ep = self.stats.get(label or f"{method} {path}")
        t0 = time.monotonic()
        try:
            r = requests.request(method, url, json=json_body, headers=headers,
                                 timeout=self.timeout)
        except requests.RequestException as exc:
            elapsed = (time.monotonic() - t0) * 1000
            ep.record(elapsed, 0, ok=False)
            return None
        elapsed = (time.monotonic() - t0) * 1000
        allowed = set(ok_statuses or [200, 201, 204])
        ep.record(elapsed, r.status_code, ok=r.status_code in allowed)
        return r


# ---------------------------------------------------------------------------
# Workload scenarios
# ---------------------------------------------------------------------------

DRINKS = ['Latte', 'Flat White', 'Cappuccino', 'Long Black', 'Espresso', 'Mocha']
# Only milks the DEFAULT Quick Setup preset stocks. If you generate
# orders for a milk the station doesn't carry, the backend correctly
# refuses with 400 ("This station doesn't stock soy") — which is right
# behaviour but pollutes the load-test error rate with false positives.
# Keep this in sync with DEFAULT_QUICK_PRESET['milks'] in
# routes/consolidated_api_routes.py, or pass --milks to override.
# (First real load run reported a phantom ~15% error rate purely from
# randomly picking 'soy', which the default preset doesn't stock.)
MILKS = ['full cream', 'skim', 'oat', 'almond', 'lactose free']
# Default station catalog also doesn't stock every size — 'medium' is
# the only size the default preset seeds, so bias toward it.
SIZES = ['medium', 'medium', 'small', 'large']
NAMES = ['Alex', 'Sam', 'Jordan', 'Casey', 'Morgan', 'Riley', 'Taylor',
         'Avery', 'Quinn', 'Skyler', 'Drew', 'Emerson', 'Hayden']


def _walkin_payload(idx: int) -> dict:
    """Build a varied walk-in body. The notes field carries a LOADTEST
    marker so cleanup is easy."""
    return {
        'type': 'walk_in',
        'customer_name': f"{random.choice(NAMES)} {idx}",
        'coffee_type': random.choice(DRINKS),
        'milk_type': random.choice(MILKS),
        'size': random.choice(SIZES),
        'sugar': random.choice(['no sugar', '1 sugar', '2 sugar']),
        'notes': 'LOADTEST',
        'phone': '+61400000000',
        'priority': random.random() < 0.05,  # 5% VIP
    }


def scenario_walkin(client: Client, idx: int) -> None:
    """Create a walk-in order. The hottest write path in the system."""
    client.call('POST', '/api/orders', label='POST /api/orders (walkin)',
                json_body=_walkin_payload(idx))


def scenario_read_burst(client: Client, idx: int) -> None:
    """Mimic a barista UI tick: pull pending + in-progress + station list."""
    client.call('GET', '/api/orders/pending', label='GET /api/orders/pending')
    client.call('GET', '/api/orders/in-progress', label='GET /api/orders/in-progress')
    client.call('GET', '/api/stations', label='GET /api/stations')


def scenario_inventory_check(client: Client, idx: int) -> None:
    """Walk-in dialog fetches the station inventory before each new order."""
    sid = random.choice([1, 2, 3])
    client.call('GET', f'/api/inventory?station_id={sid}',
                label='GET /api/inventory')


def scenario_catalog_check(client: Client, idx: int) -> None:
    """useCatalog('milk' | 'drink') refresh on dialog open."""
    cat = random.choice(['milk', 'drink', 'size', 'sweetener'])
    client.call('GET', f'/api/catalog/{cat}', label='GET /api/catalog')


def scenario_sms_inbound(client: Client, idx: int) -> None:
    """Simulate a Twilio inbound SMS hitting /api/sms. Needs TESTING_MODE
    on at the backend — signature validation is skipped in that mode."""
    body = {
        'Body': random.choice(['latte', 'flat white oat', 'cappuccino skim',
                               'long black no sugar', 'mocha large']),
        'From': f'+61400{random.randint(100000, 999999)}',
        'MessageSid': f'SM_LOADTEST_{idx}_{int(time.time()*1000)}',
        'AccountSid': 'AC_LOADTEST',
    }
    # /api/sms expects form-urlencoded, NOT JSON.
    url = f"{client.base_url}/sms"
    ep = client.stats.get('POST /api/sms (inbound)')
    t0 = time.monotonic()
    try:
        r = requests.post(url, data=body, timeout=client.timeout)
        elapsed = (time.monotonic() - t0) * 1000
        ep.record(elapsed, r.status_code, ok=r.status_code in (200, 201, 204))
    except requests.RequestException:
        elapsed = (time.monotonic() - t0) * 1000
        ep.record(elapsed, 0, ok=False)


def scenario_sms_conversation(client: Client, idx: int) -> None:
    """A FULL multi-turn SMS order conversation for one fresh phone number.

    This is the realistic "N concurrent coffee conversations" load: each
    call walks the whole state machine (hi → name → drink → milk → size →
    sugar → yes), 7 POSTs to /api/sms, and only counts as a completed
    order if the final reply confirms. Needs TESTING_MODE=true at the
    backend (signature validation + outbound SMS both stubbed).

    Run as: --only conversation --workers 400  (→ 400 concurrent convos).
    """
    # Name carries the LOADTEST sentinel so synthetic SMS orders are
    # purgeable with the SAME pattern as walk-in load orders — and so prod
    # cleanup never has to match on phone prefix (real AU mobiles are
    # +614…, which would collide with a naive +6149% delete).
    phone = f'+6149{(idx % 9000000) + 1000000:07d}'
    name = f'LOADTEST{idx}'
    turns = [
        ('hi',     r'name'),
        (name,     r'what can i get|coffee|like'),
        ('latte',  r'milk'),
        ('oat',    r'size'),
        ('medium', r'sugar|sweet'),
        ('none',   r'confirm|yes'),
        ('yes',    r'confirm|#|order|line|queue|ready'),
    ]
    ep = client.stats.get('POST /api/sms (convo turn)')
    done = client.stats.get('SMS convo COMPLETED')
    url = f"{client.base_url}/sms"
    completed = False
    for body_text, _expect in turns:
        form = {
            'Body': body_text,
            'From': phone,
            'MessageSid': f'SM_LOADCONVO_{idx}_{int(time.time()*1000)}_{body_text[:3]}',
            'AccountSid': 'AC_LOADTEST',
        }
        t0 = time.monotonic()
        try:
            r = requests.post(url, data=form, timeout=client.timeout)
            elapsed = (time.monotonic() - t0) * 1000
            ok = r.status_code in (200, 201, 204)
            ep.record(elapsed, r.status_code, ok=ok)
            if not ok:
                break
            if body_text == 'yes' and re.search(r'confirm|#|line|queue|ready', r.text, re.I):
                completed = True
        except requests.RequestException:
            ep.record((time.monotonic() - t0) * 1000, 0, ok=False)
            break
        # brief inter-message gap — a real human typing the next reply
        time.sleep(random.uniform(0.05, 0.2))
    done.record(0.0, 200 if completed else 0, ok=completed)


SCENARIO_REGISTRY: dict[str, Callable[[Client, int], None]] = {
    'walkin':       scenario_walkin,
    'read':         scenario_read_burst,
    'inventory':    scenario_inventory_check,
    'catalog':      scenario_catalog_check,
    'sms':          scenario_sms_inbound,
    'conversation': scenario_sms_conversation,
}


# Mix weights — picked to mimic real-event traffic shape:
# - lots of reads (every barista UI ticks 1-2s)
# - moderate inventory hits (walk-in dialog opens)
# - some walk-ins (the hot write path)
# - small share of catalog refreshes
DEFAULT_MIX = [
    ('read',      6),
    ('inventory', 2),
    ('walkin',    2),
    ('catalog',   1),
]
DEFAULT_MIX_WITH_SMS = DEFAULT_MIX + [('sms', 2)]


def _expand_mix(mix: list[tuple[str, int]]) -> list[str]:
    out = []
    for name, weight in mix:
        out.extend([name] * weight)
    return out


# ---------------------------------------------------------------------------
# Worker
# ---------------------------------------------------------------------------

def _login(base_url: str, username: str, password: str) -> str:
    """Login once, return the JWT. The token is shared across all
    workers — in a real event this would be N independent baristas with
    N tokens, but reuse is fine for load purposes (the server hashes
    the same JWT either way)."""
    r = requests.post(f"{base_url.rstrip('/')}/api/auth/login",
                      json={'username': username, 'password': password},
                      timeout=10)
    if r.status_code != 200:
        raise SystemExit(f"login failed ({r.status_code}): {r.text[:200]}")
    data = r.json()
    token = data.get('token') or data.get('access_token')
    if not token:
        raise SystemExit(f"login returned no token: {data}")
    return token


def _worker(worker_id: int, deadline: float, ramp_until: float,
            client: Client, scenarios: list[str], think_ms_range: tuple[int, int]):
    """One worker loop. Picks a scenario each iteration, then sleeps
    a tick to mimic operator think-time."""
    i = 0
    # Stagger start across the ramp window so all workers don't fire
    # their first request at t=0 — that creates a thundering herd that
    # tells you nothing about steady-state.
    if ramp_until > time.monotonic():
        time.sleep(random.uniform(0, ramp_until - time.monotonic()))
    while time.monotonic() < deadline:
        scenario_name = random.choice(scenarios)
        fn = SCENARIO_REGISTRY[scenario_name]
        try:
            fn(client, worker_id * 100_000 + i)
        except Exception as exc:
            # A scenario raising shouldn't kill the worker — log via the
            # stats tally instead.
            client.stats.get(f'scenario-error:{scenario_name}').record(
                0.0, 0, ok=False
            )
        i += 1
        # Mimic UI tick: 100-500ms between requests is a reasonable
        # human-paced operator.
        lo, hi = think_ms_range
        time.sleep(random.uniform(lo, hi) / 1000.0)


# ---------------------------------------------------------------------------
# CLI
# ---------------------------------------------------------------------------

def _fmt_ms(v):
    return f"{v:>7.1f}" if v is not None else "    n/a"


def _print_report(stats: Stats, elapsed_s: float):
    rows = sorted([ep.summary() for ep in stats.all()],
                  key=lambda r: r['requests'], reverse=True)
    total = sum(r['requests'] for r in rows)
    errs = sum(r['errors'] for r in rows)
    print("\n" + "=" * 88)
    print(f"LOAD TEST RESULTS — {elapsed_s:.1f}s elapsed, "
          f"{total} requests, {errs} errors "
          f"({(errs/total*100 if total else 0):.1f}% error rate), "
          f"~{total/elapsed_s:.1f} req/s overall")
    print("=" * 88)
    hdr = f"{'endpoint':<38} {'n':>6}  {'p50':>7} {'p95':>7} {'p99':>7} {'max':>7}  err"
    print(hdr)
    print("-" * len(hdr))
    for r in rows:
        print(
            f"{r['name'][:38]:<38} {r['requests']:>6}  "
            f"{_fmt_ms(r['p50_ms'])} {_fmt_ms(r['p95_ms'])} "
            f"{_fmt_ms(r['p99_ms'])} {_fmt_ms(r['max_ms'])}  "
            f"{r['errors']:>4}"
        )
    print("=" * 88)
    print("Status code distribution:")
    by_status: dict[int, int] = {}
    for r in rows:
        for code, n in (r['statuses'] or {}).items():
            by_status[code] = by_status.get(code, 0) + n
    for code in sorted(by_status):
        emoji = '✓' if 200 <= code < 300 else ('!' if code == 0 else '✗')
        print(f"  {emoji} {code}: {by_status[code]}")
    print("=" * 88)
    print("Cleanup (drops ALL synthetic orders — walk-in AND SMS-conversation —")
    print("matching on the LOADTEST sentinel in the order body, never on phone):")
    print("  DELETE FROM orders WHERE order_details::text LIKE '%LOADTEST%';")


def main():
    ap = argparse.ArgumentParser(description=__doc__,
                                 formatter_class=argparse.RawDescriptionHelpFormatter)
    ap.add_argument('--base-url', default='http://localhost:5001',
                    help='backend URL (default: http://localhost:5001)')
    ap.add_argument('--username', default='coffeecue')
    ap.add_argument('--password', default='adminpassword')
    ap.add_argument('--workers', type=int, default=10,
                    help='concurrent workers (≈ baristas) (default: 10)')
    ap.add_argument('--duration', type=int, default=60,
                    help='burst duration in seconds (default: 60)')
    ap.add_argument('--ramp', type=int, default=5,
                    help='ramp-up over this many seconds (default: 5)')
    ap.add_argument('--think-min', type=int, default=150,
                    help='min think-time ms between worker iterations')
    ap.add_argument('--think-max', type=int, default=600,
                    help='max think-time ms between worker iterations')
    ap.add_argument('--include-sms', action='store_true',
                    help='include POST /api/sms in the mix (needs TESTING_MODE=true)')
    ap.add_argument('--only',
                    help='run ONLY this scenario (walkin/read/inventory/catalog/sms)')
    ap.add_argument('--json', metavar='PATH',
                    help='write machine-readable summary to this JSON file')
    args = ap.parse_args()

    print(f"Logging in as {args.username} → {args.base_url} …")
    token = _login(args.base_url, args.username, args.password)
    print("✓ login OK")

    stats = Stats()
    client = Client(args.base_url, token, stats)

    if args.only:
        if args.only not in SCENARIO_REGISTRY:
            sys.exit(f"unknown scenario {args.only!r}; "
                     f"options: {', '.join(SCENARIO_REGISTRY)}")
        scenarios = [args.only]
    else:
        mix = DEFAULT_MIX_WITH_SMS if args.include_sms else DEFAULT_MIX
        scenarios = _expand_mix(mix)

    deadline = time.monotonic() + args.duration
    ramp_until = time.monotonic() + args.ramp
    print(f"Starting {args.workers} workers for {args.duration}s "
          f"(ramp {args.ramp}s, scenarios: {scenarios}) …")
    started_at = time.monotonic()
    with ThreadPoolExecutor(max_workers=args.workers) as pool:
        futures = [
            pool.submit(_worker, i, deadline, ramp_until, client, scenarios,
                        (args.think_min, args.think_max))
            for i in range(args.workers)
        ]
        # Wait for them all; exceptions don't kill the pool, they get
        # recorded by the worker itself.
        for f in as_completed(futures):
            _ = f.result()
    elapsed = time.monotonic() - started_at
    _print_report(stats, elapsed)

    if args.json:
        out = {
            'config': vars(args),
            'elapsed_s': elapsed,
            'endpoints': [ep.summary() for ep in stats.all()],
        }
        with open(args.json, 'w') as f:
            json.dump(out, f, indent=2, default=str)
        print(f"\nWrote machine-readable summary to {args.json}")


if __name__ == '__main__':
    main()
