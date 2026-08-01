"""
Coffee Cue Test Bench — PRINT SYSTEM guards (Star mC-Label3 / CloudPRNT).

Two suites:

  print_preview   read-only, always runs. Renders /api/print/preview and
                  asserts it's a real 406-dot-wide PNG that's big enough
                  to have used a scalable font. Guards the exact
                  regression we shipped and fixed in #176: Railway has no
                  system TTFs, so without Pillow's embedded font the
                  whole label silently renders in a ~10px bitmap font
                  (unreadable on a cup) while every status code stays 200.

  print_pipeline  opt-in via --allow-lifecycle (creates printer + job
                  rows, tagged ZZBench). Full CloudPRNT round trip with a
                  simulated printer MAC: auto-register disabled on first
                  poll -> enable/assign -> test job -> poll shows
                  jobReady+token -> PNG fetch (MAC-gated) -> decoy MAC
                  cannot fetch the job -> DELETE code=500 requeues ->
                  re-poll serves the same token -> DELETE code=200 lands
                  it in 'printed'. Cleans up by cancelling leftover
                  queued jobs and disabling the bench printer (the row
                  itself is reused by MAC on the next run, so reruns
                  don't accrete printers).

Zero real printing: the bench MAC belongs to no physical device, and the
bench printer is left disabled, so no real order can ever route a label
to it between runs.
"""
from __future__ import annotations

from .core import BENCH_TAG, result

R = result

BENCH_MAC = "ZZBENCH0PRN1"   # fixed so reruns upsert one row, not many
DECOY_MAC = "ZZBENCH0PRN2"   # never registered — used only to probe isolation
PNG_MAGIC = b"\x89PNG\r\n\x1a\n"


def _png_width(body: bytes):
    """Width from the IHDR chunk (bytes 16..20, big-endian)."""
    if len(body) < 24 or body[:8] != PNG_MAGIC:
        return None
    return int.from_bytes(body[16:20], "big")


def _raw_get(client, path):
    """GET returning raw bytes (core ApiClient json-decodes, which mangles
    binary bodies)."""
    r = client.s.get(f"{client.base}{path}",
                     headers=client._headers(True), timeout=30)
    return r.status_code, r.content


def suite_print_preview(rn):
    c, out = rn.client, []
    code, body = _raw_get(c, "/api/print/preview")
    ok_png = code == 200 and body[:8] == PNG_MAGIC
    out.append(R("print_prev", "label preview renders as PNG",
                 "pass" if ok_png else "fail",
                 f"HTTP {code}, {len(body)} bytes",
                 refs=[] if ok_png else ["routes/print_routes.py",
                                         "services/label_printer.py"]))
    if not ok_png:
        return out
    width = _png_width(body)
    out.append(R("print_prev", "label width matches PRINT_WIDTH_DOTS (406)",
                 "pass" if width == 406 else "fail", f"width={width}",
                 suggestion="" if width == 406 else
                 "Width drift breaks physical calibration on the 58mm stock.",
                 refs=[] if width == 406 else ["services/label_printer.py"]))
    # The #176 regression signature: bitmap-font labels compress to <1KB
    # because everything is tiny. A scalable-font label is >2KB.
    big_enough = len(body) > 2000
    out.append(R("print_prev", "scalable font in use (not the 10px bitmap fallback)",
                 "pass" if big_enough else "fail",
                 f"{len(body)} bytes (bitmap-font labels are ~950)",
                 suggestion="" if big_enough else
                 "Pillow's embedded-font fallback (ImageFont.load_default(size)) "
                 "stopped working — labels render unreadably small while every "
                 "status stays 200. See PR #176.",
                 refs=[] if big_enough else ["services/label_printer.py"]))
    return out


def suite_print_pipeline(rn):
    c, out = rn.client, []
    if not rn.options.get("allow_lifecycle"):
        return [R("print_pipe", "CloudPRNT round trip", "skip",
                  "Opt-in (creates printer/job rows) — enable 'lifecycle'")]

    def step(name, ok, detail, suggestion=""):
        out.append(R("print_pipe", name, "pass" if ok else "fail", detail,
                     suggestion="" if ok else suggestion,
                     refs=[] if ok else ["routes/print_routes.py"]))
        return ok

    printer_id = None
    try:
        # 1. poll: auto-register (or heartbeat an existing bench row)
        code, body, _ = c.req("POST", "/cloudprnt", auth=False,
                              body={"printerMAC": BENCH_MAC,
                                    "statusCode": "200 OK"})
        step("poll heartbeats and never blocks (jobReady flag present)",
             code == 200 and isinstance(body, dict) and "jobReady" in body,
             f"HTTP {code} {str(body)[:80]}")

        _pc, pb, _ = c.get("/api/print/printers")
        row = next((p for p in (pb or {}).get("printers", [])
                    if p.get("mac_address") == BENCH_MAC), None)
        if not step("printer auto-registered by MAC", bool(row),
                    f"mac={BENCH_MAC}",
                    suggestion="First poll should upsert a printers row "
                               "(disabled) — zero-touch onboarding is broken."):
            return out
        printer_id = row["id"]

        # 2. enable + assign, enqueue a test job
        c.req("PATCH", f"/api/print/printers/{printer_id}",
              body={"enabled": True, "station_id": 1,
                    "name": f"{BENCH_TAG} printer"})
        tc, tb, _ = c.post("/api/print/test", {"printer_id": printer_id})
        job_id = (tb or {}).get("job_id")
        if not step("test job enqueued", tc == 200 and bool(job_id),
                    f"HTTP {tc} job={job_id}"):
            return out

        # 3. poll -> jobReady + token; fetch -> 406px PNG
        _c2, b2, _ = c.req("POST", "/cloudprnt", auth=False,
                           body={"printerMAC": BENCH_MAC})
        token = (b2 or {}).get("jobToken")
        step("poll serves jobReady + token",
             (b2 or {}).get("jobReady") is True and token == job_id,
             f"token={token}")
        fc, fbody = _raw_get(
            c, f"/cloudprnt?token={token}&mac={BENCH_MAC}&type=image/png")
        step("job fetch returns the rendered 406px PNG",
             fc == 200 and fbody[:8] == PNG_MAGIC and _png_width(fbody) == 406,
             f"HTTP {fc}, {len(fbody)} bytes, width={_png_width(fbody)}")

        # 4. isolation: a different MAC must never see or fetch this job
        ic, ibody = _raw_get(c, f"/cloudprnt?token={token}&mac={DECOY_MAC}")
        step("cross-printer isolation (decoy MAC gets 404)",
             ic == 404, f"HTTP {ic}",
             suggestion="A job fetched by the wrong printer would print a "
                        "label at the wrong station — MAC gate is the wall.")

        # 4b. banner: free text renders as a LONG sideways strip (#205) —
        # height (print length) must exceed width, proving the rotation.
        bnc, bnb, _ = c.post("/api/print/banner",
                             {"text": "ZZBENCH BANNER", "printer_id": printer_id})
        step("banner job enqueued", bnc == 200 and (bnb or {}).get("success"),
             f"HTTP {bnc}")
        _c5, b5, _ = c.req("POST", "/cloudprnt", auth=False,
                           body={"printerMAC": BENCH_MAC})
        btok = (b5 or {}).get("jobToken")
        if btok:
            bfc, bfbody = _raw_get(
                c, f"/cloudprnt?token={btok}&mac={BENCH_MAC}")
            bw = _png_width(bfbody)
            bh = int.from_bytes(bfbody[20:24], "big") if len(bfbody) > 24 else 0
            step("banner strip is sideways (length >> roll width)",
                 bfc == 200 and bw == 406 and bh > bw,
                 f"{bw}x{bh}px",
                 suggestion="The banner must rotate 90 degrees so the roll "
                            "width becomes its height — a short label here "
                            "means the rotation is lost.")
            c.req("DELETE", f"/cloudprnt?token={btok}&mac={BENCH_MAC}&code=200",
                  auth=False)

        # 5. failure path: code=500 requeues; the SAME token is served again
        dc, _d, _ = c.req("DELETE",
                          f"/cloudprnt?token={token}&mac={BENCH_MAC}&code=500",
                          auth=False)
        _c3, b3, _ = c.req("POST", "/cloudprnt", auth=False,
                           body={"printerMAC": BENCH_MAC})
        step("non-200 confirm requeues the job (retry budget honoured)",
             dc == 200 and (b3 or {}).get("jobToken") == token,
             f"delete={dc} repoll_token={(b3 or {}).get('jobToken')}")

        # 6. success path: fetch again, confirm 200 -> printed
        _raw_get(c, f"/cloudprnt?token={token}&mac={BENCH_MAC}")
        c.req("DELETE", f"/cloudprnt?token={token}&mac={BENCH_MAC}&code=200",
              auth=False)
        _jc, jb, _ = c.get("/api/print/jobs?status=printed")
        step("code=200 confirm lands the job in 'printed'",
             any(j.get("id") == token for j in (jb or {}).get("jobs", [])),
             f"job {token}")
    finally:
        if printer_id:
            # Cancel anything still queued for the bench printer, then
            # disable it so no real order can ever route a label here.
            _qc, qb, _ = c.get("/api/print/jobs?status=queued")
            for j in (qb or {}).get("jobs", []):
                if j.get("printer_id") == printer_id:
                    c.post(f"/api/print/jobs/{j['id']}/cancel")
            c.req("PATCH", f"/api/print/printers/{printer_id}",
                  body={"enabled": False})
    return out


PRINT_SUITES = [
    ("print_preview", suite_print_preview, True),
    ("print_pipeline", suite_print_pipeline, True),
]
