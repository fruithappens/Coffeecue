"""
Cross-codebase consistency audit for the Expresso project.

Steve asked: "is there a full audit that is looking for inconsistencies
like _ vs -, similar names that don't line up, hardcoded things, things
built by Claude without context that duplicate existing code?"

This script doesn't fix anything — it just produces a report. Run it
periodically (especially after big changes) to catch the kind of
drift that caused the in-progress-vanishing bug, the demo-data
display bug, the three-localStorage-keys-for-the-same-thing bug, etc.

Checks performed:

  1. Endpoint URL mismatches
       Frontend URLs the React code calls that don't exist on the
       backend, and backend routes the frontend never calls (dead
       endpoints).

  2. Status string consistency
       Greps for status string literals on both sides and flags any
       that exist on one side but not the other (e.g. 'in_progress'
       vs 'in-progress' — a one-character typo that caused the
       "started orders disappear" bug).

  3. localStorage key proliferation
       Lists every key used and groups similar names (e.g.
       coffee_cue_settings / coffee_cue_barista_settings /
       coffee_system_branding — three stores for overlapping data).

  4. Schema column references vs CREATE TABLE
       Greps all SQL in backend Python files for column references
       and cross-checks them against the schema in pg_init.py. Flags
       columns referenced but not declared (the
       station_stats.name-missing bug).

  5. Parallel / orphan component files
       Finds suffixed variants like *.original.js, *.improved.js,
       *.backup, etc. and flags whether the un-suffixed file is the
       only one wired up.

  6. Dead UI button handlers
       Finds onClick/onChange handlers whose body is just an alert,
       console.log, or setTimeout (placeholder code).

Usage:

    python audit_inconsistencies.py
    python audit_inconsistencies.py --section endpoints   # one section only
    python audit_inconsistencies.py --json > audit.json   # machine-readable

Exit code is 0 always — this is informational, not a CI gate.
"""

from __future__ import annotations

import argparse
import json
import os
import re
import sys
from collections import defaultdict
from pathlib import Path

ROOT = Path(__file__).resolve().parent
FRONTEND = ROOT / "Barista Front End" / "src"
BACKEND_ROUTES = ROOT / "routes"
BACKEND_APP = ROOT / "app.py"
BACKEND_SERVICES = ROOT / "services"
PG_INIT = ROOT / "pg_init.py"

# ────────────────────────────────────────────────────────────────────
# tiny utilities
# ────────────────────────────────────────────────────────────────────

def _walk(dir_: Path, suffixes: tuple[str, ...]) -> list[Path]:
    files = []
    if not dir_.exists():
        return files
    for p in dir_.rglob('*'):
        if p.is_file() and p.suffix in suffixes:
            # skip vendor / node_modules / archives — they're not "ours"
            if any(seg in {'node_modules', '_archive', '_archive_legacy',
                           'backend_backup_20250525_125912'} for seg in p.parts):
                continue
            files.append(p)
    return files


def _read(p: Path) -> str:
    try:
        return p.read_text(encoding='utf-8', errors='ignore')
    except Exception:
        return ''


def _heading(s: str) -> str:
    return f"\n\033[1m{s}\033[0m\n" + "─" * min(72, len(s)) + "\n"


def _bullet(s: str, indent: int = 0) -> str:
    return ("  " * indent) + f"• {s}"


# ────────────────────────────────────────────────────────────────────
# Check 1 — Endpoint URL mismatches
# ────────────────────────────────────────────────────────────────────

def collect_backend_routes() -> set[tuple[str, str]]:
    """Return a set of (method, normalized_path) from @bp.route declarations."""
    routes: set[tuple[str, str]] = set()
    # ROUTE patterns:
    #   @bp.route('/orders', methods=['GET','POST'])
    #   @app.route('/api/foo', methods=['POST'])
    # The leading prefix differs (blueprint prefix is /api), so normalise.
    for py_file in [BACKEND_APP] + _walk(BACKEND_ROUTES, ('.py',)):
        text = _read(py_file)
        for m in re.finditer(
            r"@(?:bp|app)\.route\(\s*['\"]([^'\"]+)['\"]\s*(?:,\s*methods\s*=\s*\[([^\]]+)\])?",
            text,
        ):
            raw_path, methods_str = m.group(1), (m.group(2) or "'GET'")
            # Normalize: blueprint routes don't include /api prefix; app.route ones might.
            path = raw_path if raw_path.startswith('/api') else '/api' + raw_path
            # Convert <param> placeholders to a sentinel so frontend comparison works.
            normalized = re.sub(r"<[^>]+>", "<param>", path)
            for raw_method in re.findall(r"['\"](\w+)['\"]", methods_str):
                routes.add((raw_method.upper(), normalized.rstrip('/')))
    return routes


def collect_frontend_calls() -> set[tuple[str, str]]:
    """Return (method, normalized_path) from React code's API calls."""
    calls: set[tuple[str, str]] = set()

    # Patterns to detect:
    #   apiService.get('/foo')        → GET   /api/foo
    #   apiService.post('/foo', …)    → POST  /api/foo
    #   apiService.put('/foo', …)     → PUT   /api/foo
    #   apiService.delete('/foo')     → DELETE /api/foo
    #   apiService.request('/foo', {method:'POST'})
    #   fetch('/api/foo', {method:'PUT'})
    #   directFetch('foo')             → GET   /api/foo  (heuristic)
    re_method_helpers = re.compile(
        r"\b(?:apiService|api|this\.apiService)\.(get|post|put|delete|patch)"
        r"\(\s*[`'\"]([^`'\"]+)[`'\"]",
        re.IGNORECASE,
    )
    re_request = re.compile(
        r"\b(?:apiService|api|this\.apiService)\.request"
        r"\(\s*[`'\"]([^`'\"]+)[`'\"]\s*,\s*\{[^}]*method\s*:\s*['\"](\w+)['\"]",
        re.IGNORECASE | re.DOTALL,
    )
    re_request_default = re.compile(
        r"\b(?:apiService|api|this\.apiService)\.request"
        r"\(\s*[`'\"]([^`'\"]+)[`'\"]"
    )
    re_fetch = re.compile(
        r"\bfetch\(\s*[`'\"]([^`'\"]+)[`'\"]\s*(?:,\s*\{[^}]*method\s*:\s*['\"](\w+)['\"])?",
        re.IGNORECASE | re.DOTALL,
    )
    re_directfetch = re.compile(
        r"\b(?:this\.)?directFetch\(\s*[`'\"]([^`'\"]+)[`'\"]"
    )

    for js_file in _walk(FRONTEND, ('.js', '.jsx', '.ts', '.tsx')):
        text = _read(js_file)
        if not text:
            continue
        for m in re_method_helpers.finditer(text):
            method = m.group(1).upper()
            path = _normalize_endpoint(m.group(2))
            if path:
                calls.add((method, path))
        for m in re_request.finditer(text):
            calls.add((m.group(2).upper(), _normalize_endpoint(m.group(1))))
        for m in re_request_default.finditer(text):
            calls.add(('GET', _normalize_endpoint(m.group(1))))
        for m in re_fetch.finditer(text):
            method = (m.group(2) or 'GET').upper()
            path = _normalize_endpoint(m.group(1))
            if path:
                calls.add((method, path))
        for m in re_directfetch.finditer(text):
            calls.add(('GET', _normalize_endpoint(m.group(1))))
    # Drop empty paths
    return {(m, p) for m, p in calls if p}


def _normalize_endpoint(raw: str) -> str:
    """Turn a frontend URL into the same shape as backend routes:
       leading /api/, no template literals, no query string, <param> placeholders."""
    if not raw:
        return ''
    if raw.startswith('http'):
        # External URL — not interesting for this audit.
        return ''
    # Strip query string + fragment
    raw = raw.split('?')[0].split('#')[0]
    # Strip leading proxy prefix
    if not raw.startswith('/'):
        raw = '/' + raw
    if not raw.startswith('/api'):
        raw = '/api' + raw if raw.startswith('/') else f"/api/{raw}"
    # Collapse any ${…} template literal segments into <param>
    raw = re.sub(r"\$\{[^}]+\}", "<param>", raw)
    # Numeric path segments → <param>
    raw = re.sub(r"/\d+(?=/|$)", "/<param>", raw)
    return raw.rstrip('/')


def audit_endpoints() -> dict:
    backend = collect_backend_routes()
    frontend = collect_frontend_calls()
    backend_set = set(backend)
    frontend_set = set(frontend)

    # Frontend call has no exact backend route?
    # Try a fuzzy match where method matches and path differs only by <param>.
    backend_by_path = defaultdict(set)
    for m, p in backend_set:
        backend_by_path[p].add(m)

    missing_backend: list[tuple[str, str]] = []
    for method, path in sorted(frontend_set):
        if (method, path) in backend_set:
            continue
        # Allow "ANY" method match if backend has the path with any verb.
        if path in backend_by_path:
            continue
        missing_backend.append((method, path))

    unused_backend: list[tuple[str, str]] = []
    frontend_paths = {p for _, p in frontend_set}
    for method, path in sorted(backend_set):
        # Ignore /sms (Twilio webhook), /health, /debug/*, /docs/* — never called by the React UI.
        if any(path.startswith(p) for p in ('/api/sms', '/api/health', '/api/debug', '/api/docs', '/api/test')):
            continue
        if path not in frontend_paths:
            unused_backend.append((method, path))

    return {
        'backend_route_count': len(backend),
        'frontend_call_count': len(frontend),
        'missing_backend': missing_backend,
        'unused_backend': unused_backend,
    }


def render_endpoints(result: dict) -> str:
    out = _heading('1. Endpoint URL mismatches')
    out += f"Backend declared routes: {result['backend_route_count']}\n"
    out += f"Frontend call sites:     {result['frontend_call_count']}\n\n"
    if result['missing_backend']:
        out += "Frontend calls that have NO matching backend route (likely 404):\n"
        for method, path in result['missing_backend'][:30]:
            out += _bullet(f"{method:7s} {path}") + "\n"
        if len(result['missing_backend']) > 30:
            out += f"  … +{len(result['missing_backend']) - 30} more\n"
        out += "\n"
    else:
        out += "✓ Every frontend call has a matching backend route\n\n"
    if result['unused_backend']:
        out += "Backend routes the frontend never calls (dead endpoints?):\n"
        for method, path in result['unused_backend'][:30]:
            out += _bullet(f"{method:7s} {path}") + "\n"
        if len(result['unused_backend']) > 30:
            out += f"  … +{len(result['unused_backend']) - 30} more\n"
    return out


# ────────────────────────────────────────────────────────────────────
# Check 2 — Status string consistency
# ────────────────────────────────────────────────────────────────────

# Status string literals we care about. The list is intentional —
# arbitrary strings would generate too much noise.
STATUS_CANDIDATES = [
    'pending', 'in_progress', 'in-progress', 'completed',
    'picked_up', 'picked-up', 'cancelled', 'canceled',
    'active', 'inactive', 'maintenance',
    'queued', 'ready',
]

def collect_status_usage() -> dict[str, dict[str, list[Path]]]:
    """For each candidate status string, find which Python and JS files reference it."""
    usage: dict[str, dict[str, list[Path]]] = {
        s: {'py': [], 'js': []} for s in STATUS_CANDIDATES
    }
    for f in _walk(BACKEND_ROUTES, ('.py',)) + _walk(BACKEND_SERVICES, ('.py',)) + [BACKEND_APP]:
        text = _read(f)
        for s in STATUS_CANDIDATES:
            if re.search(rf"['\"]{re.escape(s)}['\"]", text):
                usage[s]['py'].append(f)
    for f in _walk(FRONTEND, ('.js', '.jsx', '.ts', '.tsx')):
        text = _read(f)
        for s in STATUS_CANDIDATES:
            if re.search(rf"['\"]{re.escape(s)}['\"]", text):
                usage[s]['js'].append(f)
    return usage


def render_status(usage: dict) -> str:
    out = _heading('2. Status string consistency')
    # Pair up the common variants
    pairs = [
        ('in_progress', 'in-progress'),
        ('picked_up', 'picked-up'),
        ('cancelled', 'canceled'),
    ]
    problems = []
    for a, b in pairs:
        a_py, a_js = usage[a]['py'], usage[a]['js']
        b_py, b_js = usage[b]['py'], usage[b]['js']
        if (a_py or a_js) and (b_py or b_js):
            problems.append((a, b, a_py, a_js, b_py, b_js))
    if not problems:
        out += "✓ No mixed status spellings found.\n"
        return out
    for a, b, a_py, a_js, b_py, b_js in problems:
        out += f"⚠ '{a}' AND '{b}' both used:\n"
        out += f"  '{a}' → {len(a_py)} py file(s), {len(a_js)} js file(s)\n"
        out += f"  '{b}' → {len(b_py)} py file(s), {len(b_js)} js file(s)\n"
        out += "  Sample py with each:\n"
        if a_py: out += f"    '{a}': {a_py[0].relative_to(ROOT)}\n"
        if b_py: out += f"    '{b}': {b_py[0].relative_to(ROOT)}\n"
        out += "  Sample js with each:\n"
        if a_js: out += f"    '{a}': {a_js[0].relative_to(ROOT)}\n"
        if b_js: out += f"    '{b}': {b_js[0].relative_to(ROOT)}\n"
        out += "\n"
    return out


# ────────────────────────────────────────────────────────────────────
# Check 3 — localStorage key proliferation
# ────────────────────────────────────────────────────────────────────

def collect_localstorage_keys() -> dict[str, set[Path]]:
    """Map each localStorage key to the files that read/write it."""
    keys: dict[str, set[Path]] = defaultdict(set)
    pat = re.compile(
        r"localStorage\.(?:getItem|setItem|removeItem)\(\s*[`'\"]([^`'\"]+)[`'\"]"
    )
    for f in _walk(FRONTEND, ('.js', '.jsx', '.ts', '.tsx')):
        text = _read(f)
        for m in pat.finditer(text):
            keys[m.group(1)].add(f)
    return dict(keys)


def render_localstorage(keys: dict) -> str:
    out = _heading('3. localStorage key proliferation')
    if not keys:
        out += "(none found)\n"
        return out
    # Look for "near-duplicate" key names — same prefix or similar
    # words (settings, branding, etc.).
    groups: dict[str, list[str]] = defaultdict(list)
    for k in keys:
        # Bucket by a few rough categories
        lk = k.lower()
        if 'setting' in lk: groups['settings'].append(k)
        elif 'brand'   in lk: groups['branding'].append(k)
        elif 'station' in lk: groups['station'].append(k)
        elif 'stock'   in lk: groups['stock'].append(k)
        elif 'inventory' in lk: groups['inventory'].append(k)
        elif 'order'   in lk: groups['order'].append(k)
        elif 'chat'    in lk or 'message' in lk: groups['chat/messages'].append(k)
        elif 'token'   in lk or 'auth' in lk: groups['auth'].append(k)
        elif 'queue'   in lk or 'routing' in lk: groups['queue/routing'].append(k)
        else: groups['other'].append(k)

    for group, key_list in sorted(groups.items(), key=lambda x: -len(x[1])):
        if len(key_list) < 2:
            continue
        out += f"\n[{group}] {len(key_list)} keys (likely consolidation candidates):\n"
        for k in sorted(key_list):
            files = sorted(keys[k])
            out += f"  • {k}  ({len(files)} files)\n"
    out += f"\nTotal distinct keys in use: {len(keys)}\n"
    return out


# ────────────────────────────────────────────────────────────────────
# Check 4 — Schema column references
# ────────────────────────────────────────────────────────────────────

INTERESTING_TABLES = ('orders', 'station_stats', 'users', 'inventory_items',
                      'customer_preferences', 'settings', 'event_breaks',
                      'chat_messages')

def parse_pg_init_columns() -> dict[str, set[str]]:
    """Return {table_name: {column_name, …}} from pg_init.py CREATE TABLE
       and any ALTER TABLE … ADD COLUMN statements scattered through the code."""
    cols: dict[str, set[str]] = defaultdict(set)
    text = _read(PG_INIT)
    # CREATE TABLE blocks
    for m in re.finditer(
        r"CREATE\s+TABLE\s+(?:IF\s+NOT\s+EXISTS\s+)?(\w+)\s*\(([^;]*?)\)\s*;",
        text, re.IGNORECASE | re.DOTALL,
    ):
        table = m.group(1).lower()
        if table not in INTERESTING_TABLES:
            continue
        for line in m.group(2).splitlines():
            line = line.strip().rstrip(',').lstrip(',')
            if not line or line.upper().startswith(('PRIMARY ', 'FOREIGN ', 'UNIQUE ', 'CHECK ',
                                                     'CONSTRAINT ')):
                continue
            col_match = re.match(r"(\w+)\s+", line)
            if col_match:
                cols[table].add(col_match.group(1).lower())
    # ALTER TABLE … ADD COLUMN scattered through services/*.py
    for f in _walk(BACKEND_SERVICES, ('.py',)) + _walk(BACKEND_ROUTES, ('.py',)) + [BACKEND_APP]:
        py_text = _read(f)
        for m in re.finditer(
            r"ALTER\s+TABLE\s+(?:IF\s+EXISTS\s+)?(\w+)\s+ADD\s+COLUMN\s+(?:IF\s+NOT\s+EXISTS\s+)?(\w+)",
            py_text, re.IGNORECASE,
        ):
            table = m.group(1).lower()
            if table in INTERESTING_TABLES:
                cols[table].add(m.group(2).lower())
        for m in re.finditer(
            r"ALTER\s+TABLE\s+(?:IF\s+EXISTS\s+)?(\w+)\s+(.*?)(?=ALTER\s+TABLE|\Z|\";?\s*\)|''')",
            py_text, re.IGNORECASE | re.DOTALL,
        ):
            table = m.group(1).lower()
            if table not in INTERESTING_TABLES:
                continue
            for col_m in re.finditer(r"ADD\s+COLUMN\s+(?:IF\s+NOT\s+EXISTS\s+)?(\w+)",
                                     m.group(2), re.IGNORECASE):
                cols[table].add(col_m.group(1).lower())
    return cols


def collect_column_references() -> dict[str, set[tuple[str, Path]]]:
    """Find columns referenced in SQL strings. Returns
       {table: {(column, file_path), …}}."""
    refs: dict[str, set[tuple[str, Path]]] = defaultdict(set)
    for f in _walk(BACKEND_SERVICES, ('.py',)) + _walk(BACKEND_ROUTES, ('.py',)) + [BACKEND_APP]:
        text = _read(f)
        # Find every SQL-looking string.
        for sql_match in re.finditer(
            r"(?:execute|executemany)\s*\(\s*(?:f|r|b)?['\"]{1,3}(.*?)['\"]{1,3}",
            text, re.IGNORECASE | re.DOTALL,
        ):
            sql = sql_match.group(1)
            # Lowercase for matching
            sql_l = sql.lower()
            for table in INTERESTING_TABLES:
                if table not in sql_l:
                    continue
                # Heuristic: collect identifiers near "FROM table"
                # and "table." and the column list in SELECT.
                # This is sloppy; it overcounts but doesn't miss.
                for col_match in re.finditer(
                    rf"\b{table}\.(\w+)", sql_l,
                ):
                    refs[table].add((col_match.group(1), f))
                # SELECT col1, col2 FROM table — naive
                sel_match = re.search(
                    rf"select\s+(.+?)\s+from\s+{table}\b", sql_l, re.DOTALL,
                )
                if sel_match:
                    for col in re.findall(r"\b(\w+)\b", sel_match.group(1)):
                        if col in {'as', 'distinct', 'coalesce', 'count', 'sum',
                                   'avg', 'max', 'min', 'null', 'and', 'or',
                                   'where', 'on', 'case', 'when', 'then', 'else',
                                   'end', 'cast', 'true', 'false', 'over',
                                   'order', 'by', 'group', 'partition', 'limit',
                                   'offset', 'inner', 'left', 'right', 'join',
                                   'using', 'in', 'not', 'is'}:
                            continue
                        if col.isdigit():
                            continue
                        refs[table].add((col, f))
    return refs


def audit_columns() -> dict:
    declared = parse_pg_init_columns()
    referenced = collect_column_references()
    missing: dict[str, list[tuple[str, Path]]] = defaultdict(list)
    for table, refs in referenced.items():
        dset = declared.get(table, set())
        if not dset:
            # We don't have a definition for this table — skip rather
            # than complain about every reference.
            continue
        for col, f in refs:
            if col in dset:
                continue
            # Allow * and well-known SQL functions
            if col in {'*', 'count', 'sum', 'distinct'}:
                continue
            missing[table].append((col, f))
    return {'declared': declared, 'missing': missing}


def render_columns(result: dict) -> str:
    out = _heading('4. Schema column references vs CREATE TABLE')
    if not result['missing']:
        out += "✓ All column references resolve to a declared column.\n"
        return out
    for table, items in sorted(result['missing'].items()):
        unique = sorted({c for c, _ in items})
        if not unique:
            continue
        # Filter out noise (very short tokens, etc.)
        unique = [c for c in unique if len(c) > 2 and c not in {'all', 'set'}]
        if not unique:
            continue
        out += f"⚠ Table '{table}' — referenced but not declared:\n"
        for c in unique[:15]:
            sample = next(f for col, f in items if col == c)
            out += _bullet(f"{c}  (e.g. in {sample.relative_to(ROOT)})") + "\n"
        if len(unique) > 15:
            out += f"  … +{len(unique) - 15} more\n"
        out += "\n"
    out += ("Note: this check is heuristic — false positives include\n"
            "SQL aliases, function names, and JSON keys. Use it as a\n"
            "starting point, then verify with the real schema.\n")
    return out


# ────────────────────────────────────────────────────────────────────
# Check 5 — Parallel / orphan component files
# ────────────────────────────────────────────────────────────────────

SUFFIX_RE = re.compile(
    r"(?P<base>.+?)\.(?:original|improved|refactored|fixed|simplified|"
    r"broken|old|backup|new|alt|v2|v3|test\.backup|patched|temp)\.js$",
    re.IGNORECASE,
)

def audit_parallel_files() -> dict:
    parallels: dict[str, list[Path]] = defaultdict(list)
    for f in _walk(FRONTEND, ('.js',)):
        m = SUFFIX_RE.match(f.name)
        if m:
            parallels[m.group('base')].append(f)
    # Also flag the un-suffixed base file if it exists
    result = {}
    for base, variants in parallels.items():
        base_path = variants[0].parent / f"{base}.js"
        result[str(base_path.relative_to(ROOT))] = sorted(
            v.relative_to(ROOT) for v in variants
        )
    return result


def render_parallels(result: dict) -> str:
    out = _heading('5. Parallel / orphan component files')
    if not result:
        out += "✓ No suffixed parallel variants found.\n"
        return out
    out += f"Found {len(result)} files with parallel variants:\n\n"
    for base, variants in sorted(result.items()):
        out += f"  {base}\n"
        for v in variants:
            out += f"    └─ {v}\n"
        out += "\n"
    out += ("Recommendation: move all variants to _archive_legacy/ unless\n"
            "verified to be wired in. Use `grep -l ImportName src` to confirm.\n")
    return out


# ────────────────────────────────────────────────────────────────────
# Check 6 — Dead UI button handlers
# ────────────────────────────────────────────────────────────────────

# Patterns that signal a placeholder: a button onClick whose body is
# only alert(), console.log(), setTimeout(), or empty arrow.
PLACEHOLDER_PATTERNS = [
    re.compile(r"onClick\s*=\s*\{\s*\(\)\s*=>\s*alert\("),
    re.compile(r"onClick\s*=\s*\{\s*\(\)\s*=>\s*console\.log\("),
    re.compile(r"onClick\s*=\s*\{\s*\(\)\s*=>\s*setTimeout\("),
    re.compile(r"onClick\s*=\s*\{\s*\(\)\s*=>\s*\{\s*\}\s*\}"),
    re.compile(r"onClick\s*=\s*\{\s*\(\)\s*=>\s*\(\s*\)\s*\}"),
]

def audit_placeholders() -> list[tuple[Path, int, str]]:
    hits: list[tuple[Path, int, str]] = []
    for f in _walk(FRONTEND, ('.js', '.jsx')):
        text = _read(f)
        for i, line in enumerate(text.splitlines(), start=1):
            for pat in PLACEHOLDER_PATTERNS:
                if pat.search(line):
                    hits.append((f, i, line.strip()[:120]))
                    break
    return hits


def render_placeholders(hits: list) -> str:
    out = _heading('6. Dead UI button handlers (alert/console/empty)')
    if not hits:
        out += "✓ No obvious placeholder onClicks.\n"
        return out
    out += f"Found {len(hits)} placeholder handler(s):\n\n"
    for f, line_no, content in hits[:30]:
        out += _bullet(f"{f.relative_to(ROOT)}:{line_no}  {content}") + "\n"
    if len(hits) > 30:
        out += f"  … +{len(hits) - 30} more\n"
    return out


# ────────────────────────────────────────────────────────────────────
# Driver
# ────────────────────────────────────────────────────────────────────

SECTIONS = {
    'endpoints':    (audit_endpoints,    render_endpoints),
    'status':       (collect_status_usage, render_status),
    'localstorage': (collect_localstorage_keys, render_localstorage),
    'columns':      (audit_columns,     render_columns),
    'parallels':    (audit_parallel_files, render_parallels),
    'placeholders': (audit_placeholders, render_placeholders),
}


def main() -> int:
    ap = argparse.ArgumentParser()
    ap.add_argument('--section', choices=list(SECTIONS), action='append',
                    help='Run only specific section(s). May be passed multiple times.')
    ap.add_argument('--json', action='store_true',
                    help='Emit machine-readable JSON instead of human-readable text.')
    args = ap.parse_args()
    sections_to_run = args.section or list(SECTIONS)
    results: dict = {}
    for name in sections_to_run:
        collect, render = SECTIONS[name]
        try:
            data = collect()
        except Exception as e:
            print(f"\n[ERROR in {name}] {e}\n", file=sys.stderr)
            continue
        results[name] = data
        if not args.json:
            print(render(data))
    if args.json:
        # Make Path objects serializable
        def _conv(o):
            if isinstance(o, Path):
                return str(o.relative_to(ROOT))
            if isinstance(o, set):
                return sorted(_conv(x) for x in o)
            if isinstance(o, dict):
                return {k: _conv(v) for k, v in o.items()}
            if isinstance(o, (list, tuple)):
                return [_conv(x) for x in o]
            return o
        print(json.dumps(_conv(results), indent=2, default=str))
    return 0


if __name__ == '__main__':
    sys.exit(main())
