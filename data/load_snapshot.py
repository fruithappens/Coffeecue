"""Load a production export (Organiser > Settings > Event Data) straight into
the local cupq_next database -- ALL tables, orders included, which the app's
own import deliberately never does. Generic: inserts every column that exists
locally, JSON columns as jsonb, settings rows overwrite (production values
win over pg_init defaults), everything else ON CONFLICT DO NOTHING. Also
loads stations and printers from their API snapshots. Then resets sequences.
Usage: DATABASE_URL=postgresql://localhost/cupq_next venv/bin/python data/load_snapshot.py data/prod_export_2026-09-07.json
"""
import json, os, sys, psycopg2
from psycopg2.extras import Json

snap = json.load(open(sys.argv[1]))
tables = snap.get("snapshot", snap).get("tables", {})
extra = {}
here = os.path.dirname(os.path.abspath(__file__))
for name, fn, key in (("stations", "prod_stations.json", "stations"), ("printers", "prod_printers.json", "printers")):
    p = os.path.join(here, fn)
    if os.path.exists(p):
        b = json.load(open(p)); extra[name] = b.get(key) or b.get("data") or []

ORDER = ["settings", "inventory_items", "catalog_items", "customer_preferences", "stations", "printers",
         "orders", "order_messages", "sms_messages", "conversation_states", "customer_questions", "partial_orders",
         "loyalty_transactions", "payment_transactions", "feedback", "inventory_history", "inventory_alerts",
         "restock_requests", "restock_request_items", "chat_messages", "client_errors", "client_events",
         "station_schedule", "event_breaks"]
conn = psycopg2.connect(os.environ["DATABASE_URL"]); cur = conn.cursor()
for t in ORDER:
    rows = extra.get(t) if t in extra else (tables.get(t) or [])
    if not rows: continue
    cur.execute("select column_name from information_schema.columns where table_schema='public' and table_name=%s", (t,))
    cols_db = {r[0] for r in cur.fetchall()}
    if not cols_db: print(f"{t:24s} skipped (no such table yet)"); continue
    n = fail = 0
    for r in rows:
        cols = [c for c in r.keys() if c in cols_db]
        if not cols: continue
        vals = [Json(r[c]) if isinstance(r[c], (dict, list)) else r[c] for c in cols]
        conflict = "ON CONFLICT (key) DO UPDATE SET value = EXCLUDED.value" if t == "settings" else "ON CONFLICT DO NOTHING"
        cur.execute("SAVEPOINT sp")
        try:
            cur.execute(f'INSERT INTO {t} ({",".join(cols)}) VALUES ({",".join(["%s"] * len(cols))}) {conflict}', vals)
            n += cur.rowcount
        except Exception as e:
            cur.execute("ROLLBACK TO SAVEPOINT sp"); fail += 1
            if fail <= 2: print(f"   {t}: row failed: {str(e).splitlines()[0][:110]}")
    conn.commit(); print(f"{t:24s} {n:5d} of {len(rows):5d} loaded" + (f"  ({fail} failed)" if fail else ""))
cur.execute("select table_name, column_name from information_schema.columns where table_schema='public' and column_default like 'nextval%%'")
for t, c in cur.fetchall():
    cur.execute(f"select setval(pg_get_serial_sequence('{t}','{c}'), greatest(coalesce(max({c}),1),1)) from {t}")
conn.commit(); print("sequences reset")
