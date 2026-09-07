"""Render the load-test results (testbench/loadtest/results/*.json) into the
results table used by the load-test document. Prints HTML rows + a summary."""
import glob, json, os, sys
HERE = os.path.dirname(os.path.abspath(__file__))
rows = []
for f in sorted(glob.glob(os.path.join(HERE, "results", "*.json"))):
    r = json.load(open(f)); c = r["classes"]
    def cls(k, key): return c.get(k, {}).get(key, "—")
    total = sum(v["n"] for v in c.values()); errs = sum(round(v["n"] * v["err_pct"] / 100) for v in c.values())
    mem = r.get("mem") or []
    rows.append({
        "tag": r["tag"], "delegates": r["delegates"], "carts": r["carts"], "orders_per_s": r["target_orders_per_s"], "minutes": r["minutes"],
        "req_s": r["achieved_req_per_s"], "total": total, "errors": errs, "err_pct": round(100 * errs / max(total, 1), 2),
        "orders": r["orders_created"], "completed": r["orders_completed"],
        "beacon_p95": cls("beacon", "p95"), "order_p95": cls("order", "p95"), "board_p95": cls("board", "p95"), "tablet_p95": cls("tablet", "p95"),
        "rss_start": mem[0]["rss"] if mem else "—", "rss_end": mem[-1]["rss"] if mem else "—", "file": os.path.basename(f),
    })
for x in rows: print(json.dumps(x))
