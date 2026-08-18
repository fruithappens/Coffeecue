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

    # Roll width is honoured (#206): an 80mm preview must be 640 dots.
    wcode, wbody = _raw_get(c, "/api/print/preview?sample=1&width=640")
    wok = wcode == 200 and _png_width(wbody) == 640
    out.append(R("print_prev", "preview honours the requested roll width",
                 "pass" if wok else "fail",
                 f"HTTP {wcode}, width={_png_width(wbody)} (expected 640)",
                 suggestion="" if wok else
                 "Printers declare rolls from 40-80mm; a preview stuck at "
                 "58mm lies about what the other stations will print.",
                 refs=[] if wok else ["routes/print_routes.py"]))

    # GROW mode (#206): the same long text must produce a TALLER label
    # than compact — the sticker grows instead of the text shrinking.
    def _png_height(b):
        return int.from_bytes(b[20:24], "big") if len(b) > 24 else 0
    _sc, sb, _ = c.get("/api/print/label-settings")
    prev_mode = ((sb or {}).get("settings") or {}).get("label_scale_mode", "compact")
    prev_instr = ((sb or {}).get("settings") or {}).get("instructions_text", "")
    long_text = ("Order ahead any time by texting this number and we will "
                 "have it waiting when you arrive")
    try:
        c.req("PUT", "/api/print/label-settings",
              body={"label_scale_mode": "compact", "instructions_text": long_text})
        _c1, compact_png = _raw_get(c, "/api/print/preview?sample=1")
        c.req("PUT", "/api/print/label-settings",
              body={"label_scale_mode": "grow"})
        _c2, grow_png = _raw_get(c, "/api/print/preview?sample=1")
        ch, gh = _png_height(compact_png), _png_height(grow_png)
        grew = gh > ch
        out.append(R("print_prev", "grow mode makes the LABEL longer, not the text smaller",
                     "pass" if grew else "fail",
                     f"compact {ch}px vs grow {gh}px",
                     suggestion="" if grew else
                     "In grow mode a long sentence must consume more sticker "
                     "(Steve) — shrinking the text instead defeats the mode.",
                     refs=[] if grew else ["services/label_printer.py"]))
    finally:
        c.req("PUT", "/api/print/label-settings",
              body={"label_scale_mode": prev_mode,
                    "instructions_text": prev_instr})
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


def suite_print_fit(rn):
    """Guards the #209 clipping class: text must never run off the roll.

    A real label came out as "Medium Cappuccino * Sk" / "Milk" — the "im"
    fell off the edge, because the renderer split the drink line on a
    CHARACTER count (drink_line[:24]) while the roll is measured in
    PIXELS. Silent character loss is the dangerous part: nothing errors,
    every status is 200, and the barista can't tell the label is wrong.

    Ink touching the final pixel column means something was cut off.
    """
    out = []
    try:
        # The bench runs from testbench/; the renderer lives at the repo root.
        import os as _os, sys as _sys
        _root = _os.path.dirname(_os.path.dirname(_os.path.dirname(_os.path.abspath(__file__))))
        if _root not in _sys.path:
            _sys.path.insert(0, _root)
        from PIL import Image
        from services.label_printer import render_label
    except Exception as e:
        return [R("print_fit", "renderer importable for fit checks", "fail",
                  f"import failed: {e}", refs=["services/label_printer.py"])]

    import io
    cases = [
        ("Skim Milk cappuccino (the #209 reproducer)",
         {"size": "Medium", "drink": "Cappuccino", "milk": "Skim Milk"}),
        ("longest realistic drink + milk",
         {"size": "Large", "drink": "Caramel Macchiato", "milk": "Lactose Free Milk"}),
        ("long single word (no space to wrap on)",
         {"size": "Large", "drink": "Frappuccinooooooooooooo", "milk": "Oat"}),
    ]
    for label, drink in cases:
        try:
            png = render_label({
                "order_number": "1377", "name": "Alexandra W.",
                "station_id": 1, "modifiers": ["Extra hot", "2 sugars"],
                **drink,
            }, 406, {})
            im = Image.open(io.BytesIO(png)).convert("1")
            w, h = im.size
            edge = sum(1 for y in range(h) if im.getpixel((w - 1, y)) == 0)
        except Exception as e:
            out.append(R("print_fit", f"renders: {label}", "fail", str(e),
                         refs=["services/label_printer.py"]))
            continue
        out.append(R("print_fit", f"no text clipped off the roll: {label}",
                     "pass" if edge == 0 else "fail",
                     f"{edge} ink pixels in the final column (want 0)",
                     suggestion="" if edge == 0 else
                     "Text is running off the label edge and characters are "
                     "being lost silently. Use _fit_to_width/_wrap_to_width "
                     "(pixel-measured) rather than a character cap.",
                     refs=[] if edge == 0 else ["services/label_printer.py"]))
    return out


def suite_print_driver_truth(rn):
    """The driver label must match how the printer is really driven.

    When the mC-Label3 arrived on USB, its row claimed 'starprnt_lan' and
    no value existed that could describe the truth at all — so the Support
    UI confidently named a transport that wasn't in use while jobs sat in
    'queued'. A label that cannot be right is worse than no label: it
    sends you debugging the wrong half of the system.
    """
    c, out = rn.client, []
    code, body, _ = c.get("/api/print/printers")
    printers = (body or {}).get("printers") or [] if isinstance(body, dict) else []
    valid = ("cloudprnt", "cups_agent", "starprnt_lan", "escpos_lan")

    bad = [p for p in printers if (p.get("driver") or "cloudprnt") not in valid]
    out.append(R("print_driver", "every printer's driver is a known value",
                 "pass" if not bad else "fail",
                 f"{len(printers)} printer(s), {len(bad)} unknown"
                 + ("" if not bad else f": {[p.get('driver') for p in bad]}"),
                 refs=[] if not bad else ["routes/print_routes.py"]))

    # The backend must REFUSE an unknown driver rather than store it: a
    # silently-accepted typo is exactly how a label stops matching reality.
    target = next((p for p in printers if p.get("id")), None)
    if not target:
        return out
    was = target.get("driver")
    pcode, _pb, _ = c.req("PATCH", f"/api/print/printers/{target['id']}",
                          body={"driver": "definitely-not-a-driver"})
    refused = pcode == 400
    out.append(R("print_driver", "backend refuses an unknown driver",
                 "pass" if refused else "fail", f"HTTP {pcode} (want 400)",
                 suggestion="" if refused else
                 "An unvalidated driver string lets the Support UI describe "
                 "a transport that does not exist.",
                 refs=[] if refused else ["routes/print_routes.py"]))

    _c, after, _ = c.get("/api/print/printers")
    rows = (after or {}).get("printers") or [] if isinstance(after, dict) else []
    now = next((p for p in rows if p.get("id") == target["id"]), {})
    unchanged = now.get("driver") == was
    if not unchanged:
        # Never leave a real printer row holding junk, even when the server
        # under test is missing the validation this suite is checking for.
        c.req("PATCH", f"/api/print/printers/{target['id']}", body={"driver": was})
    out.append(R("print_driver", "rejected driver was not persisted",
                 "pass" if unchanged else "fail",
                 f"driver={now.get('driver')!r} (was {was!r})"
                 + ("" if unchanged else " — restored"),
                 refs=[] if unchanged else ["routes/print_routes.py"]))
    return out


def suite_print_offline_warning(rn):
    """Queueing to a printer nobody polls must SAY so, not show success.

    Reproduces the real incident: the print agent was stopped, so every
    job sat in 'queued' with attempts=0 while the UI answered "Test label
    queued" with a green tick. The operator concluded the printer was
    broken and spent the next stretch changing driver dropdowns, which
    cannot affect anything. "Queued" is not "printed" — when nothing is
    collecting jobs, the response has to say it.
    """
    c, out = rn.client, []
    code, body, _ = c.get("/api/print/printers")
    printers = (body or {}).get("printers") or [] if isinstance(body, dict) else []

    # Bench printers never poll, so they are permanently "offline" — the
    # exact condition we need, without touching a real printer.
    stale = next((p for p in printers
                  if p.get("seconds_since_poll") is None
                  or p["seconds_since_poll"] > 60), None)
    if not stale:
        return [R("print_offline", "an un-polled printer exists to test against",
                  "skip", "every printer is currently live")]

    was_enabled = stale.get("enabled")
    if not was_enabled:
        c.req("PATCH", f"/api/print/printers/{stale['id']}", body={"enabled": True})
    tcode, tbody, _ = c.req("POST", "/api/print/test",
                            body={"printer_id": stale["id"]})
    warned = isinstance(tbody, dict) and bool(tbody.get("warning"))
    out.append(R("print_offline", "queueing to an un-polled printer returns a warning",
                 "pass" if warned else "fail",
                 f"HTTP {tcode}, warning={(tbody or {}).get('warning') if isinstance(tbody, dict) else None!r}",
                 suggestion="" if warned else
                 "Without this the UI shows a green 'queued' tick while the "
                 "job cannot print, and the printer gets blamed.",
                 refs=[] if warned else ["routes/print_routes.py",
                                         "Barista Front End/src/components/support-tabs/PrintersTab.js"]))

    # Missing printer_id used to surface a raw int() TypeError.
    ncode, nbody, _ = c.req("POST", "/api/print/test", body={})
    clean = ncode == 400 and "int()" not in str((nbody or {}).get("message", ""))
    out.append(R("print_offline", "test print without a printer fails cleanly",
                 "pass" if clean else "fail",
                 f"HTTP {ncode}: {(nbody or {}).get('message') if isinstance(nbody, dict) else nbody!r}",
                 suggestion="" if clean else
                 "A raw TypeError in the response body tells the operator nothing.",
                 refs=[] if clean else ["routes/print_routes.py"]))

    # Self-clean: the job we queued can never print (nothing polls that
    # printer), so cancel it rather than leaving litter in the queue.
    job_id = (tbody or {}).get("job_id") if isinstance(tbody, dict) else None
    if job_id:
        c.req("POST", f"/api/print/jobs/{job_id}/cancel", body={})
    if not was_enabled:
        c.req("PATCH", f"/api/print/printers/{stale['id']}", body={"enabled": False})
    return out


PRINT_SUITES = [
    ("print_preview", suite_print_preview, True),
    ("print_pipeline", suite_print_pipeline, True),
    ("print_fit", suite_print_fit, False),
    ("print_driver", suite_print_driver_truth, True),
    ("print_offline", suite_print_offline_warning, True),
]
