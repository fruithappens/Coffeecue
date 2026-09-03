"""Label print subsystem: job queue + Star CloudPRNT endpoints + app API.

Architecture (see the print build spec):

    POST /api/print/label ─► print_jobs (queued) ─► drivers
      - cloudprnt:   the mC-Label3 POLLS /cloudprnt over HTTPS (pull) —
                     works behind any NAT/4G router, no inbound ports.
      - starprnt_lan / escpos_lan: a local agent polls /api/print/jobs
                     and pushes raster over TCP 9100 (Scenario C/D).

Design rules honoured here:
  - Payloads are SNAPSHOTS taken at enqueue time; reprints reproduce the
    original label even if the order was edited afterwards.
  - The poll path stays light (<200ms): no rendering during POST
    /cloudprnt — the PNG renders at GET-job time from the snapshot.
  - A dead printer NEVER blocks order flow; failures land on the job row
    and in the log, and the UI degrades to on-screen alerts.
  - Unknown printer MACs are auto-registered DISABLED (heartbeat only)
    so new hardware onboards zero-touch but can't pull jobs until an
    operator enables + assigns it.
"""
from __future__ import annotations

import json
import logging
import os
import uuid
from datetime import datetime, timedelta

from flask import Blueprint, current_app, jsonify, request, Response

from auth import jwt_required_with_demo, role_required_with_demo
from utils.label_roll import ROLL_SETTING_KEY, assess, roll_for, set_roll
import urllib.parse

logger = logging.getLogger(__name__)

# App-facing API (JWT'd) and the printer-facing CloudPRNT endpoint
# (public by necessity — printers can't OAuth) live on two blueprints.
bp = Blueprint("print_api", __name__, url_prefix="/api/print")
cloudprnt_bp = Blueprint("cloudprnt", __name__)

CLOUDPRNT_POLL_TIMEOUT_S = int(os.environ.get("CLOUDPRNT_POLL_TIMEOUT_S", "15"))
PRINT_RETRY_MAX = int(os.environ.get("PRINT_RETRY_MAX", "3"))
PRINT_FETCH_TIMEOUT_S = int(os.environ.get("PRINT_FETCH_TIMEOUT_S", "60"))
CLOUDPRNT_SHARED_SECRET = os.environ.get("CLOUDPRNT_SHARED_SECRET", "")


# ---------------------------------------------------------------------------
# Schema (lazy-created, matching the repo's ensure-tables pattern)
# ---------------------------------------------------------------------------


def _db():
    return current_app.config.get("coffee_system").db


# Once per process, not once per print route.
#
# Called from 19 places, including the CloudPRNT poll that every printer
# makes every 5 seconds. The block contains an ADD COLUMN on `printers`,
# and ADD COLUMN takes ACCESS EXCLUSIVE before it checks whether the
# column is there -- so an idle cart with two printers was asking for
# the strongest lock on that table 24 times a minute, forever, to do
# nothing. Set only on success so a failure retries.
_PRINT_TABLES_READY = False


def _ensure_tables(db):
    global _PRINT_TABLES_READY
    if _PRINT_TABLES_READY:
        return
    try:
        cur = db.cursor()
        cur.execute(
            """
            CREATE TABLE IF NOT EXISTS printers (
                id SERIAL PRIMARY KEY,
                name VARCHAR(100) NOT NULL DEFAULT 'Printer',
                station_id INTEGER,
                driver VARCHAR(20) NOT NULL DEFAULT 'cloudprnt',
                mac_address VARCHAR(32) UNIQUE,
                ip_address VARCHAR(64),
                width_dots INTEGER NOT NULL DEFAULT 406,
                enabled BOOLEAN NOT NULL DEFAULT FALSE,
                last_poll_at TIMESTAMP,
                last_status TEXT,
                created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
            )
        """
        )
        cur.execute(
            """
            CREATE TABLE IF NOT EXISTS print_jobs (
                id VARCHAR(36) PRIMARY KEY,
                printer_id INTEGER REFERENCES printers(id),
                order_id VARCHAR(50),
                type VARCHAR(10) NOT NULL DEFAULT 'label',
                status VARCHAR(12) NOT NULL DEFAULT 'queued',
                payload TEXT,
                attempts INTEGER NOT NULL DEFAULT 0,
                error TEXT,
                created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
                fetched_at TIMESTAMP,
                printed_at TIMESTAMP
            )
        """
        )
        cur.execute(
            """
            CREATE INDEX IF NOT EXISTS idx_print_jobs_poll
            ON print_jobs (printer_id, status, created_at)
        """
        )
        # Horizontal correction, in dots, for printers that do not place a
        # raw image where the label actually is. Measured on the live
        # mC-Label3 over CloudPRNT: the calibration ruler's "50" printed as
        # "0", i.e. content landed ~58 dots left of the label — exactly the
        # 464-406 slack between 58mm stock and our render width. Ticks stayed
        # evenly spaced, so it is a pure translation, not scaling. Per
        # printer because the TSP143IV arriving next may not need it.
        cur.execute(
            "ALTER TABLE printers ADD COLUMN IF NOT EXISTS "
            "offset_dots INTEGER NOT NULL DEFAULT 0"
        )
        db.commit()
        _PRINT_TABLES_READY = True
    except Exception as e:
        logger.warning(f"print tables ensure failed: {e}")
        try:
            db.rollback()
        except Exception:
            pass


def _norm_mac(mac):
    return str(mac or "").replace(":", "").replace("-", "").strip().upper()


def _shift_right(png_bytes, offset_dots):
    """Pad `offset_dots` of blank on the LEFT so content lands on the label.

    Some printers do not place a raw image where the label physically is.
    Measured on the mC-Label3 over CloudPRNT: the calibration ruler's "50"
    printed as "0" and "TEST LABEL" as "ST LABEL" — content sat ~58 dots
    left of the stock, which is exactly 464-406, the slack between 58mm
    media and our render width. Tick spacing was unchanged, so it is a
    translation, not scaling, and padding is the honest correction.

    Done here rather than in the renderer so the label DESIGN stays one
    canvas at one width; only delivery to a particular printer is adjusted,
    and the preview keeps matching the design. Returns the input untouched
    on 0 / missing / any failure — a print that is offset beats no print.
    """
    try:
        offset = int(offset_dots or 0)
    except (TypeError, ValueError):
        return png_bytes
    if offset <= 0:
        return png_bytes
    try:
        import io
        from PIL import Image

        src = Image.open(io.BytesIO(png_bytes))
        out = Image.new(
            src.mode,
            (src.width + offset, src.height),
            255 if src.mode in ("1", "L") else "white",
        )
        out.paste(src, (offset, 0))
        buf = io.BytesIO()
        out.save(buf, format="PNG")
        return buf.getvalue()
    except Exception as e:
        logger.warning(f"print offset shift failed (sending unshifted): {e}")
        return png_bytes


def _cloudprnt_success(code) -> bool:
    """Did the printer report a successful print?

    The mC-Label3 reports success as the string "200 OK". The old test was
    an exact-match tuple ('200', 'OK', 'ok', '') which "200 OK" does not
    satisfy, so every successful print was recorded as a FAILURE, requeued,
    and re-delivered on the next poll — an infinite reprint loop that only
    stopped when retries ran out. Seen live on 2026-08-18: one label
    reprinted every 5s until the printer was disabled.

    Star reports an HTTP-status-like token, so judge the FIRST token: 2xx
    or a literal OK. Matching "OK" anywhere would wrongly pass codes that
    merely contain those letters (e.g. "TOKEN").

    An ABSENT code stays success, deliberately. It is the pre-existing
    behaviour, and the two failure modes are not equal: treating a missing
    code as failure re-creates the reprint loop for any firmware that omits
    it (the TSP143IV arriving next may differ), whereas treating it as
    success costs at most one un-reprinted label, recoverable from the UI.
    """
    c = str(code or "").strip().upper()
    if not c:
        return True
    first = c.split()[0]
    return first.startswith("2") or first == "OK"


def _row_to_dict(cur, row):
    if row is None:
        return None
    if isinstance(row, dict):
        return dict(row)
    cols = [d[0] for d in cur.description]
    return dict(zip(cols, row))


# ---------------------------------------------------------------------------
# Lazy sweeps (no cron): retry stuck jobs on every poll
# ---------------------------------------------------------------------------


def _sweep_stuck_jobs(db):
    """Jobs stuck in 'fetched' beyond PRINT_FETCH_TIMEOUT_S mean the
    printer died mid-print. Fail them; requeue while attempts remain."""
    try:
        cur = db.cursor()
        cutoff = datetime.now() - timedelta(seconds=PRINT_FETCH_TIMEOUT_S)
        cur.execute(
            "UPDATE print_jobs SET status = CASE WHEN attempts < %s THEN 'queued' "
            "ELSE 'failed' END, attempts = attempts + 1, "
            "error = COALESCE(error,'') || ' [fetch timeout]' "
            "WHERE status = 'fetched' AND fetched_at < %s",
            (PRINT_RETRY_MAX, cutoff),
        )
        if cur.rowcount:
            logger.warning(f"print sweep: {cur.rowcount} stuck job(s) handled")

        # Jobs nobody ever FETCHED, aimed at a printer that is not
        # answering. The sweep above only rescues jobs a printer took and
        # then died holding; a job queued to a printer that never polls
        # just waits, indefinitely, and prints whenever that machine is
        # next plugged in. Steve had station 1 enabled with a printer
        # that had not checked in for two days.
        #
        # A cup label's usefulness expires with the drink, so past the
        # window these are cancelled rather than kept.
        #
        # The AGES are computed in SQL. created_at is `timestamp WITHOUT
        # time zone` holding the database server's local clock, so doing
        # this arithmetic in Python against UTC worked on a UTC host and
        # silently did nothing anywhere else. Here NOW() and created_at
        # share one clock and the timezone question cannot arise.
        try:
            from utils.print_queue import DEFAULT_STALE_SECONDS, is_stale

            c3 = db.cursor()
            c3.execute(
                "SELECT j.id, "
                "  EXTRACT(EPOCH FROM (NOW() - j.created_at)), "
                "  CASE WHEN p.last_poll_at IS NULL THEN NULL "
                "       ELSE EXTRACT(EPOCH FROM (NOW() - p.last_poll_at)) END "
                "FROM print_jobs j LEFT JOIN printers p ON p.id = j.printer_id "
                "WHERE j.status = 'queued'"
            )
            giving_up = []
            for row in c3.fetchall() or []:
                if isinstance(row, dict):
                    vals = list(row.values())
                    jid, job_age, silent = vals[0], vals[1], vals[2]
                else:
                    jid, job_age, silent = row[0], row[1], row[2]
                if is_stale(job_age, silent, DEFAULT_STALE_SECONDS):
                    giving_up.append(jid)
            for jid in giving_up:
                c3.execute(
                    "UPDATE print_jobs SET status = 'cancelled', "
                    "error = COALESCE(error,'') || ' [printer never collected it]' "
                    "WHERE id = %s",
                    (jid,),
                )
            if giving_up:
                logger.warning(
                    "print sweep: gave up on %d label(s) queued to a "
                    "printer that is not answering",
                    len(giving_up),
                )
        except Exception as stale_err:
            logger.warning(f"stale queued-job sweep failed: {stale_err}")

        db.commit()
    except Exception as e:
        logger.warning(f"print job sweep failed: {e}")
        try:
            db.rollback()
        except Exception:
            pass


# ---------------------------------------------------------------------------
# Payload snapshot
# ---------------------------------------------------------------------------


def _snapshot_order(db, order_number, station_id=None):
    """Freeze the label data NOW. Never re-read the live order at print
    time — what was queued is what prints."""
    cur = db.cursor()
    cur.execute(
        "SELECT order_number, order_details, station_id FROM orders "
        "WHERE order_number = %s",
        (str(order_number),),
    )
    row = cur.fetchone()
    if not row:
        return None
    if isinstance(row, dict):
        onum, od_raw, o_station = (
            row.get("order_number"),
            row.get("order_details"),
            row.get("station_id"),
        )
    else:
        onum, od_raw, o_station = row
    try:
        od = json.loads(od_raw) if isinstance(od_raw, str) else (od_raw or {})
    except Exception:
        od = {}
    sid = station_id or o_station
    station_name = f"Station {sid}" if sid else ""
    try:
        c2 = db.cursor()
        c2.execute(
            "SELECT COALESCE(name,'') FROM station_stats WHERE station_id = %s", (sid,)
        )
        r2 = c2.fetchone()
        if r2 and (r2[0] if not isinstance(r2, dict) else r2.get("coalesce")):
            station_name = r2[0] if not isinstance(r2, dict) else list(r2.values())[0]
    except Exception:
        try:
            db.rollback()
        except Exception:
            pass
    modifiers = []
    if od.get("extra_hot") or od.get("temp") == "extra hot":
        modifiers.append("Extra hot")
    sugar = str(od.get("sugar") or "")
    if sugar and sugar.lower() not in ("no sugar", "none", "0"):
        modifiers.append(sugar)
    if od.get("strength"):
        modifiers.append(str(od["strength"]))
    if od.get("decaf"):
        modifiers.append("DECAF")
    # Customer's free-text NOTES ("1/4 strength, 3 shots", "no lid", "oat not
    # soy") must print on the cup — they were never added, so the sticker
    # dropped the one instruction the barista follows while making the drink
    # (Steve/Asher, live). specialInstructions is the camelCase alias.
    _notes = str(od.get("notes") or od.get("specialInstructions") or "").strip()
    if _notes:
        modifiers.append(_notes)
    return {
        "order_number": onum,
        "name": od.get("name") or "Customer",
        "drink": od.get("type") or "Coffee",
        "size": od.get("size") or "",
        "milk": od.get("milk") or "",
        "modifiers": modifiers,
        "station_name": station_name,
        # The id as well as the name: milk symbols are a per-station
        # option and the name is free text a barista can rename.
        "station_id": sid,
        "ts": datetime.now().isoformat(),
    }


def _printer_liveness(db, printer_id):
    """Is anything actually collecting jobs for this printer right now?

    A queued job is not a printed job. Whether it ever prints depends on
    something POLLING us — the printer itself on CloudPRNT, or the local
    agent for USB/LAN drivers. When nothing is polling, jobs pile up in
    'queued' with attempts=0 and the operator gets silence: that is
    exactly how a stopped agent cost a real debugging session, with the
    driver dropdown blamed instead. Returns (online, seconds, name).
    """
    try:
        cur = db.cursor()
        cur.execute(
            "SELECT name, last_poll_at FROM printers WHERE id = %s", (int(printer_id),)
        )
        row = cur.fetchone()
        if not row:
            return None, None, None
        name, last_poll = (
            (row["name"], row["last_poll_at"])
            if isinstance(row, dict)
            else (row[0], row[1])
        )
        if not last_poll:
            return False, None, name
        secs = int((datetime.now(last_poll.tzinfo) - last_poll).total_seconds())
        return secs <= CLOUDPRNT_POLL_TIMEOUT_S, secs, name
    except Exception as e:
        logger.warning(f"printer liveness check failed: {e}")
        return None, None, None


def _offline_note(db, printer_id):
    """Human-readable warning to hand back with a queued job, or None.
    The job still queues — it prints when the printer/agent returns."""
    online, secs, name = _printer_liveness(db, printer_id)
    if online is None or online:
        return None
    who = name or f"Printer {printer_id}"
    when = (
        "has never checked in"
        if secs is None
        else (
            f"last checked in {secs // 60} min ago"
            if secs >= 120
            else f"last checked in {secs}s ago"
        )
    )
    return (
        f"Queued, but {who} {when} — nothing is collecting jobs, so it "
        f"will not print yet. If this printer is USB or LAN-via-agent, "
        f"start the print agent; if it is CloudPRNT, check the printer "
        f"is powered on and on the network. The job prints as soon as "
        f"it reconnects."
    )


def _supersede_older_labels(db, order_id, new_printer_id):
    """Retire a label still waiting on a printer this station no longer uses.

    A label queued to printer A, printer A dies, a spare goes on that
    station, the barista presses print again -- the new job goes to the
    new printer and the OLD one sits in A's queue. Plug A back in next
    week and it prints a label for a coffee drunk days ago.

    Only when the printer DIFFERS. Re-printing to the same printer is the
    operator asking for a second copy, which is a real thing to want.

    Called from BOTH paths on purpose. _enqueue alone was not enough:
    /reprint passes order_id=None (so its idempotency check cannot block
    a deliberate second copy), which meant the one path that exists to
    recover from a swapped-out printer was the one path that never
    cleaned up after it.
    """
    if not order_id:
        return
    try:
        from utils.print_queue import supersedes

        cur = db.cursor()
        cur.execute(
            "SELECT id, printer_id FROM print_jobs WHERE order_id = %s "
            "AND status = 'queued' AND type = 'label'",
            (str(order_id),),
        )
        for row in cur.fetchall() or []:
            old_id = row[0] if not isinstance(row, dict) else row.get("id")
            old_printer = row[1] if not isinstance(row, dict) else row.get("printer_id")
            if supersedes(new_printer_id, old_printer):
                cur.execute(
                    "UPDATE print_jobs SET status = 'cancelled', "
                    "error = COALESCE(error,'') || ' [superseded: station now "
                    "prints on another printer]' WHERE id = %s",
                    (old_id,),
                )
                logger.info(
                    "print: job %s on printer %s superseded by printer %s",
                    old_id,
                    old_printer,
                    new_printer_id,
                )
        db.commit()
    except Exception as e:
        logger.warning(f"could not supersede older print jobs: {e}")
        try:
            db.rollback()
        except Exception:
            pass


def _enqueue(db, printer_id, payload, order_id=None, job_type="label"):
    """Insert a queued job. Idempotent for label AND ticket jobs: an
    identical queued job for the same order+printer+type is returned,
    not duplicated (double-tap safety)."""
    cur = db.cursor()
    if order_id and job_type in ("label", "ticket"):
        cur.execute(
            "SELECT id FROM print_jobs WHERE printer_id = %s AND order_id = %s "
            "AND status = 'queued' AND type = %s LIMIT 1",
            (printer_id, str(order_id), job_type),
        )
        row = cur.fetchone()
        if row:
            return (row[0] if not isinstance(row, dict) else row.get("id")), False
    if order_id and job_type == "label":
        _supersede_older_labels(db, order_id, printer_id)

    job_id = str(uuid.uuid4())
    cur.execute(
        "INSERT INTO print_jobs (id, printer_id, order_id, type, status, payload) "
        "VALUES (%s, %s, %s, %s, 'queued', %s)",
        (
            job_id,
            printer_id,
            str(order_id) if order_id else None,
            job_type,
            json.dumps(payload),
        ),
    )
    db.commit()
    return job_id, True


# ---------------------------------------------------------------------------
# CloudPRNT (Star CloudPRNT Version 1, simple HTTP polling)
# ---------------------------------------------------------------------------


# What the printer is TELLING US, in words.
#
# The mC-Label3 and TSP100IV report a CloudPRNT statusCode on every poll,
# URL-encoded: "410%20Out%20of%20paper". It was stored and never shown.
#
# Steve, with two jobs stuck: "printer issue again ... #10 didnt print".
# The queue said queued / 0 attempts / no error, because from the
# server's side nothing had gone wrong -- it offered the job every second
# and the printer never came for it. The printer was out of paper and had
# been saying so, in plain English, on every poll for an hour.
#
# A queue that cannot say "out of paper" makes the operator debug the
# server. Decoding costs nothing and is the whole difference between a
# five-second fix and a lost hour.
def printer_fault(last_status):
    """Human-readable fault from a stored CloudPRNT status, or None if OK."""
    if not last_status:
        return None
    try:
        blob = last_status
        if isinstance(blob, str):
            blob = json.loads(blob)
        if not isinstance(blob, dict):
            return None
        code = urllib.parse.unquote(str(blob.get("statusCode") or "")).strip()
        if not code:
            return None
        num = code.split(" ")[0]

        # NOT every 2xx is a working printer.
        #
        # CloudPRNT uses the 2xx range for "reachable", including states
        # where the printer is deliberately refusing to print until a
        # human does something. 221 is the one that bit us: a printed
        # label left in the output slot, and the TSP100IV will not print
        # the next job until it is taken.
        #
        # Treating the whole range as healthy meant the printer was
        # saying "I am blocked, come and take the label" on every poll,
        # twice a second, and we filed it as fine. Steve saw four jobs
        # queued, cancelled and retried them, and nothing happened --
        # because nothing was wrong with any of them.
        ATTENTION = {
            "221": "A printed label is waiting in the output - take it "
                   "and the queue will start again.",
            "222": "Paper is in the presenter - take it and the queue "
                   "will start again.",
        }
        if num in ATTENTION:
            return ATTENTION[num]
        if num.startswith("2"):
            return None
        # The rest already read as English once decoded ("410 Out of
        # paper", "802 Printer error"); strip the number so the operator
        # reads the sentence, not the protocol.
        words = code.split(" ", 1)
        return words[1].strip() if len(words) > 1 and words[1].strip() else code
    except Exception:
        return None


def _cloudprnt_auth_ok():
    if not CLOUDPRNT_SHARED_SECRET:
        return True
    return request.args.get("secret") == CLOUDPRNT_SHARED_SECRET


# How a printer is actually driven. Kept here because the Support UI and
# this endpoint must agree — a label that doesn't match reality is how an
# operator ends up debugging the wrong half of the system (see #209: a USB
# printer sat in 'queued' while its row claimed a LAN driver).
#   cloudprnt    - the printer polls us itself over the network. No agent.
#   cups_agent   - print-agent hands the PNG to the host OS spooler (USB).
#   starprnt_lan - print-agent pushes Star raster to TCP 9100.
#   escpos_lan   - print-agent pushes ESC/POS to TCP 9100 (Epson).
# Everything except 'cloudprnt' needs the local agent RUNNING to print.
VALID_DRIVERS = ("cloudprnt", "cups_agent", "starprnt_lan", "escpos_lan")


@cloudprnt_bp.route("/cloudprnt", methods=["POST"])
def cloudprnt_poll():
    """Printer heartbeat + job availability. Kept FAST: no rendering here."""
    if not _cloudprnt_auth_ok():
        return jsonify({"jobReady": False}), 403
    db = _db()
    _ensure_tables(db)
    _sweep_stuck_jobs(db)
    body = request.get_json(silent=True) or {}
    mac = _norm_mac(
        body.get("printerMAC") or body.get("printerMac") or request.args.get("mac")
    )
    if not mac:
        return jsonify({"jobReady": False})
    try:
        cur = db.cursor()
        cur.execute("SELECT * FROM printers WHERE mac_address = %s", (mac,))
        printer = _row_to_dict(cur, cur.fetchone())
        status_json = json.dumps(
            {
                "statusCode": body.get("statusCode"),
                "status": body.get("status"),
                "printingInProgress": body.get("printingInProgress"),
            }
        )
        if printer is None:
            # Zero-touch onboarding: register DISABLED; operator enables
            # + assigns a station in the Support print panel.
            cur.execute(
                "INSERT INTO printers (name, mac_address, enabled, last_poll_at, last_status) "
                "VALUES (%s, %s, FALSE, NOW(), %s)",
                (f"New printer {mac[-4:]}", mac, status_json),
            )
            db.commit()
            logger.info(f"cloudprnt: auto-registered new printer MAC {mac} (disabled)")
            return jsonify({"jobReady": False})
        cur.execute(
            "UPDATE printers SET last_poll_at = NOW(), last_status = %s WHERE id = %s",
            (status_json, printer["id"]),
        )
        db.commit()
        if not printer.get("enabled"):
            return jsonify({"jobReady": False})
        cur.execute(
            # HEAD-OF-LINE BLOCKING.
            #
            # This was strictly oldest-first, so a job the printer cannot
            # collect is offered again on every poll -- twice a second --
            # and every label queued behind it waits for a drink that has
            # already been made. Steve's queue showed exactly that: #12
            # stuck at 09:26 with a fetch timeout, and #30 sitting behind
            # it at 09:40 with zero attempts, never once offered.
            #
            # Ordering by attempts first lets a failing job stand aside for
            # fresh work while still being retried whenever nothing newer
            # is waiting. It is not dropped, just no longer allowed to hold
            # the queue shut -- and a label is worthless once its coffee is
            # on the counter, so newer work is the more valuable work.
            "SELECT id FROM print_jobs WHERE printer_id = %s AND status = 'queued' "
            "ORDER BY attempts ASC, created_at ASC LIMIT 1",
            (printer["id"],),
        )
        job = cur.fetchone()
        if not job:
            return jsonify({"jobReady": False})
        token = job[0] if not isinstance(job, dict) else job.get("id")
        return jsonify(
            {
                "jobReady": True,
                "mediaTypes": ["image/png"],
                "jobToken": token,
                "deleteMethod": "DELETE",
            }
        )
    except Exception as e:
        logger.error(f"cloudprnt poll error: {e}")
        try:
            db.rollback()
        except Exception:
            pass
        return jsonify({"jobReady": False})


@cloudprnt_bp.route("/cloudprnt", methods=["GET"])
def cloudprnt_fetch():
    """Printer fetches the job body. Render the PNG from the snapshot."""
    if not _cloudprnt_auth_ok():
        return Response(status=403)
    db = _db()
    _ensure_tables(db)
    token = request.args.get("token") or ""
    mac = _norm_mac(request.args.get("mac"))

    # Recover the shared connection before touching it.
    #
    # This is the ONE request in the print path with a hard deadline on
    # it: the printer is holding an HTTP GET open and will report
    # "520 Download failed" if we do not answer. Everything else can
    # retry quietly; this cannot.
    #
    # The connection is a process-wide singleton, so an unrelated failed
    # query elsewhere leaves it in "current transaction is aborted" and
    # every statement here raises until someone rolls back. The rest of
    # this codebase does this defensively; the fetch path never did.
    try:
        db.rollback()
    except Exception:
        pass
    try:
        cur = db.cursor()
        cur.execute(
            "SELECT j.*, p.mac_address, p.width_dots, p.offset_dots "
            "FROM print_jobs j "
            "JOIN printers p ON p.id = j.printer_id WHERE j.id = %s",
            (token,),
        )
        job = _row_to_dict(cur, cur.fetchone())
        # The token is an unguessable capability, but a job for printer A
        # must never print on printer B: the MAC has to match too.
        if not job or (mac and _norm_mac(job.get("mac_address")) != mac):
            return Response(status=404)
        payload = {}
        try:
            payload = json.loads(job.get("payload") or "{}")
        except Exception:
            pass
        from services.label_printer import (
            render_label,
            render_ticket,
            render_banner,
            render_sticker,
        )

        renderer = {
            "ticket": render_ticket,
            "banner": render_banner,
            "sticker": render_sticker,
        }.get(job.get("type"), render_label)
        # A settings read must not be able to stop a label printing.
        # Options control appearance; failing to read them is a reason to
        # print a plainer label, not to fail the download and leave the
        # barista waiting on a coffee with no ticket.
        try:
            opts = _label_options(db)
        except Exception as opt_err:
            logger.warning(f"cloudprnt fetch: label options unreadable ({opt_err}); using defaults")
            try:
                db.rollback()
            except Exception:
                pass
            opts = {}
        png = renderer(payload, job.get("width_dots"), options=opts)
        png = _shift_right(png, job.get("offset_dots"))
        cur.execute(
            "UPDATE print_jobs SET status = 'fetched', fetched_at = NOW() WHERE id = %s",
            (token,),
        )
        db.commit()
        return Response(png, mimetype="image/png")
    except Exception as e:
        # Record WHY on the job itself. The printer only ever reports
        # "520 Download failed", which says a download failed and nothing
        # about the cause -- and Railway's logs are not to hand at a cart
        # in a function room. Steve had a job sit queued for nine minutes
        # against a printer polling every second, with no way to see why.
        logger.error(f"cloudprnt fetch error for job {token}: {e}", exc_info=True)
        try:
            db.rollback()
        except Exception:
            pass
        try:
            cur2 = db.cursor()
            cur2.execute(
                "UPDATE print_jobs SET error = COALESCE(error,'') || %s "
                "WHERE id = %s",
                (f" [fetch failed: {str(e)[:120]}]", token),
            )
            db.commit()
        except Exception:
            try:
                db.rollback()
            except Exception:
                pass
        return Response(status=500)


@cloudprnt_bp.route("/cloudprnt", methods=["DELETE"])
def cloudprnt_confirm():
    """Printer reports the print result."""
    if not _cloudprnt_auth_ok():
        return Response(status=403)
    db = _db()
    _ensure_tables(db)
    token = request.args.get("token") or ""
    code = str(request.args.get("code") or "")
    try:
        cur = db.cursor()
        cur.execute(
            "SELECT attempts, printer_id FROM print_jobs WHERE id = %s", (token,)
        )
        row = cur.fetchone()
        if not row:
            return jsonify({"success": True})
        if isinstance(row, dict):
            attempts, printer_id = row.get("attempts") or 0, row.get("printer_id")
        else:
            attempts, printer_id = (row[0] or 0), row[1]
        ok = _cloudprnt_success(code)
        # Method and status are not in the app log (only Railway's HTTP log),
        # so this single line is what makes a protocol argument diagnosable.
        logger.info(
            "cloudprnt result token=%s mac=%s code=%r -> %s",
            token,
            _norm_mac(request.args.get("mac")),
            code,
            "OK" if ok else "FAIL",
        )
        if ok:
            cur.execute(
                "UPDATE print_jobs SET status = 'printed', printed_at = NOW() WHERE id = %s",
                (token,),
            )
        elif attempts + 1 < PRINT_RETRY_MAX:
            # Automatic retry: back to queued, next poll re-delivers.
            cur.execute(
                "UPDATE print_jobs SET status = 'queued', attempts = attempts + 1, "
                "error = %s WHERE id = %s",
                (f"printer result {code}", token),
            )
        else:
            cur.execute(
                "UPDATE print_jobs SET status = 'failed', attempts = attempts + 1, "
                "error = %s WHERE id = %s",
                (f"printer result {code} (retries exhausted)", token),
            )
            logger.error(f"print job {token} failed permanently (code {code})")
        db.commit()

        # HAND THE NEXT LABEL OVER NOW, rather than making the printer
        # wait for its next poll.
        #
        # Steve, on a real bench: "about 10 seconds ... between prints ...
        # not sure if this can be a bit faster in the fast paced cafe
        # space". Measured, the server is not the slow part -- a poll
        # answers in 0.65s and a label renders in 0.9s. The printer polls
        # every 5.0s exactly, so a second label waits for the next tick,
        # and lands anywhere up to two ticks after the first.
        #
        # CloudPRNT lets the job-completion response carry the same
        # jobReady/jobToken as a poll, which tells the printer to come
        # back for the next one immediately instead of sleeping. That
        # turns a queue of labels into a run rather than a series of
        # five-second pauses.
        #
        # Costs nothing if the firmware ignores it: the next ordinary poll
        # still collects the job exactly as before.
        try:
            if printer_id is not None:
                nxt = db.cursor()
                nxt.execute(
                    "SELECT id FROM print_jobs WHERE printer_id = %s "
                    "AND status = 'queued' ORDER BY created_at ASC LIMIT 1",
                    (printer_id,),
                )
                more = nxt.fetchone()
                if more:
                    next_token = (
                        more[0] if not isinstance(more, dict) else more.get("id")
                    )
                    logger.info(
                        "cloudprnt: chaining next job %s immediately", next_token
                    )
                    return jsonify(
                        {
                            "success": True,
                            "jobReady": True,
                            "mediaTypes": ["image/png"],
                            "jobToken": next_token,
                            "deleteMethod": "DELETE",
                        }
                    )
        except Exception as chain_err:
            # A failed look-ahead must never fail the confirmation -- the
            # job just printed, and the next poll will find the rest.
            logger.warning(f"cloudprnt chain lookahead skipped: {chain_err}")
            try:
                db.rollback()
            except Exception:
                pass
        return jsonify({"success": True})
    except Exception as e:
        logger.error(f"cloudprnt confirm error: {e}")
        try:
            db.rollback()
        except Exception:
            pass
        return jsonify({"success": False}), 500


# ---------------------------------------------------------------------------
# App-facing API
# ---------------------------------------------------------------------------


@bp.route("/label", methods=["POST"])
@jwt_required_with_demo()
@role_required_with_demo(["admin", "staff", "barista"])
def print_label():
    db = _db()
    _ensure_tables(db)
    data = request.get_json(silent=True) or {}
    order_id = data.get("order_id")
    station_id = data.get("station_id")
    if not order_id:
        return jsonify({"success": False, "message": "order_id is required"}), 400
    try:
        cur = db.cursor()
        if not station_id:
            # Callers usually don't know the station — take it from the order.
            cur.execute(
                "SELECT station_id FROM orders WHERE order_number = %s",
                (str(order_id),),
            )
            row = cur.fetchone()
            if row:
                station_id = (
                    row[0] if not isinstance(row, dict) else row.get("station_id")
                )
        cur.execute(
            "SELECT * FROM printers WHERE enabled = TRUE AND station_id = %s "
            "ORDER BY id LIMIT 1",
            (station_id,),
        )
        printer = _row_to_dict(cur, cur.fetchone())
        if not printer:
            return (
                jsonify(
                    {"success": False, "message": "No enabled printer for this station"}
                ),
                404,
            )
        payload = _snapshot_order(db, order_id, station_id)
        if not payload:
            return (
                jsonify({"success": False, "message": f"Order {order_id} not found"}),
                404,
            )
        job_id, created = _enqueue(db, printer["id"], payload, order_id=order_id)
        body = {"success": True, "job_id": job_id, "duplicate": not created}
        warning = _offline_note(db, printer["id"])
        if warning:
            body["warning"] = warning
        return jsonify(body)
    except Exception as e:
        logger.error(f"print_label error: {e}")
        try:
            db.rollback()
        except Exception:
            pass
        return jsonify({"success": False, "message": str(e)}), 500


# How many labels one press may queue. A roll is finite and a mis-tap
# should not eat it. Anything beyond this is reported as truncated rather
# than silently dropped, so the barista knows there is more to print.
QUEUE_PRINT_CAP = 40


@bp.route("/queue", methods=["POST"])
@jwt_required_with_demo()
@role_required_with_demo(["admin", "staff", "barista"])
def print_queue():
    """Print a label for every waiting order at once.

    Steve, watching his own video of the event: "they were hitting print
    and pulling sticker out, print and sticker. Maybe a print all in
    queue and they can just pluck sticker and it will print and then they
    can stick, while next one is auto printing."

    Body (all optional):
      station_id  which station's queue; taken from the orders otherwise
      order_ids   an explicit list instead of the whole pending queue
      force       reprint orders whose label already went out
      limit       override the cap, up to QUEUE_PRINT_CAP

    Labels are queued OLDEST FIRST, matching the order the barista will
    work through them, so the stickers come off the printer in the same
    sequence as the cups get made. Any other order turns a time-saver
    into a sorting exercise.

    An order whose label has already printed is skipped unless `force`.
    _enqueue on its own only de-duplicates jobs still sitting in the
    queue, so without this check a second press would produce a second
    full set of stickers.
    """
    db = _db()
    _ensure_tables(db)
    data = request.get_json(silent=True) or {}
    station_id = data.get("station_id")
    order_ids = data.get("order_ids")
    force = bool(data.get("force"))
    try:
        limit = int(data.get("limit") or QUEUE_PRINT_CAP)
    except (TypeError, ValueError):
        limit = QUEUE_PRINT_CAP
    limit = max(1, min(QUEUE_PRINT_CAP, limit))

    try:
        cur = db.cursor()

        if order_ids:
            wanted = [str(o) for o in order_ids][:limit]
            truncated = len(order_ids) > len(wanted)
        else:
            if not station_id:
                return (
                    jsonify(
                        {
                            "success": False,
                            "message": "station_id or order_ids required",
                        }
                    ),
                    400,
                )
            cur.execute(
                "SELECT order_number FROM orders WHERE status = 'pending' "
                "AND station_id = %s ORDER BY queue_priority, created_at ASC",
                (station_id,),
            )
            rows = cur.fetchall() or []
            allids = [
                (r[0] if not isinstance(r, dict) else r.get("order_number"))
                for r in rows
            ]
            wanted = allids[:limit]
            truncated = len(allids) > len(wanted)

        if not wanted:
            return jsonify(
                {
                    "success": True,
                    "queued": 0,
                    "already_printed": 0,
                    "already_queued": 0,
                    "failed": 0,
                    "truncated": False,
                    "message": "Nothing waiting to print",
                }
            )

        if not station_id:
            cur.execute(
                "SELECT station_id FROM orders WHERE order_number = %s",
                (str(wanted[0]),),
            )
            row = cur.fetchone()
            if row:
                station_id = (
                    row[0] if not isinstance(row, dict) else row.get("station_id")
                )

        cur.execute(
            "SELECT * FROM printers WHERE enabled = TRUE AND station_id = %s "
            "ORDER BY id LIMIT 1",
            (station_id,),
        )
        printer = _row_to_dict(cur, cur.fetchone())
        if not printer:
            return (
                jsonify(
                    {"success": False, "message": "No enabled printer for this station"}
                ),
                404,
            )

        queued = already_printed = already_queued = failed = 0
        job_ids = []
        for order_id in wanted:
            try:
                if not force:
                    # A label job of ANY status means this order's sticker
                    # has already gone out, or is about to. Skip it --
                    # _enqueue alone only de-duplicates jobs still sitting
                    # in the queue, so without this a second press would
                    # produce a second full set of stickers.
                    cur.execute(
                        "SELECT 1 FROM print_jobs WHERE printer_id = %s "
                        "AND order_id = %s AND type = 'label' LIMIT 1",
                        (printer["id"], str(order_id)),
                    )
                    if cur.fetchone():
                        already_printed += 1
                        continue
                payload = _snapshot_order(db, order_id, station_id)
                if not payload:
                    failed += 1
                    continue
                job_id, created = _enqueue(
                    db, printer["id"], payload, order_id=order_id
                )
                if created:
                    queued += 1
                    job_ids.append(job_id)
                else:
                    # Still waiting in the queue. Reported separately from
                    # "already printed" because they mean different things
                    # to a barista: one sticker is coming, the other
                    # already came out. Note this also stops `force` from
                    # duplicating a label that simply has not printed yet.
                    already_queued += 1
            except Exception as one_err:
                # One bad order must not stop the rest of the queue.
                logger.error(f"print_queue: order {order_id} failed: {one_err}")
                failed += 1
                try:
                    db.rollback()
                except Exception:
                    pass

        body = {
            "success": True,
            "queued": queued,
            "already_printed": already_printed,
            "already_queued": already_queued,
            "failed": failed,
            "truncated": truncated,
            "job_ids": job_ids,
            "printer": printer.get("name"),
        }
        if truncated:
            body["message"] = (
                f"Queued {queued}. More are waiting - press again "
                f"once these have printed."
            )
        warning = _offline_note(db, printer["id"])
        if warning:
            body["warning"] = warning
        logger.info(
            f"print_queue station {station_id}: {queued} queued, "
            f"{already_printed} already printed, "
            f"{already_queued} still waiting, {failed} failed"
        )
        return jsonify(body)
    except Exception as e:
        logger.error(f"print_queue error: {e}")
        try:
            db.rollback()
        except Exception:
            pass
        return jsonify({"success": False, "message": str(e)}), 500


@bp.route("/ticket", methods=["POST"])
@jwt_required_with_demo()
@role_required_with_demo(["admin", "staff", "barista"])
def print_ticket():
    """Customer ticket stub (deli-counter number) for an order — the
    walk-up/kiosk take-away slip. Same routing as /label."""
    db = _db()
    _ensure_tables(db)
    data = request.get_json(silent=True) or {}
    order_id = data.get("order_id")
    station_id = data.get("station_id")
    if not order_id:
        return jsonify({"success": False, "message": "order_id is required"}), 400
    try:
        job_id, created = _enqueue_ticket(db, order_id, station_id)
        if not job_id:
            return (
                jsonify({"success": False, "message": created or "no enabled printer"}),
                404,
            )
        body = {"success": True, "job_id": job_id}
        cur = db.cursor()
        cur.execute("SELECT printer_id FROM print_jobs WHERE id = %s", (job_id,))
        prow = cur.fetchone()
        if prow:
            pid = prow[0] if not isinstance(prow, dict) else prow.get("printer_id")
            warning = _offline_note(db, pid)
            if warning:
                body["warning"] = warning
        return jsonify(body)
    except Exception as e:
        logger.error(f"print_ticket error: {e}")
        try:
            db.rollback()
        except Exception:
            pass
        return jsonify({"success": False, "message": str(e)}), 500


@bp.route("/banner", methods=["POST"])
@jwt_required_with_demo()
@role_required_with_demo(["admin", "staff", "barista"])
def print_banner():
    """Sideways banner on the label roll: free text, stock width becomes
    banner height (any roll 40-80mm — the printer row's width_dots
    drives it), length grows with the text up to ~30cm. Steve's express-
    table signage straight off the thermal printer."""
    db = _db()
    _ensure_tables(db)
    data = request.get_json(silent=True) or {}
    text = str(data.get("text") or "").strip()
    if not text:
        return jsonify({"success": False, "message": "text is required"}), 400
    printer_id = data.get("printer_id")
    station_id = data.get("station_id")
    try:
        cur = db.cursor()
        if printer_id:
            cur.execute(
                "SELECT * FROM printers WHERE id = %s AND enabled = TRUE",
                (int(printer_id),),
            )
        else:
            cur.execute(
                "SELECT * FROM printers WHERE enabled = TRUE AND station_id = %s "
                "ORDER BY id LIMIT 1",
                (station_id,),
            )
        printer = _row_to_dict(cur, cur.fetchone())
        if not printer:
            return (
                jsonify({"success": False, "message": "No enabled printer found"}),
                404,
            )
        job_id, _created = _enqueue(
            db,
            printer["id"],
            {"text": text[:60], "ts": datetime.now().isoformat()},
            job_type="banner",
        )
        body = {"success": True, "job_id": job_id}
        warning = _offline_note(db, printer["id"])
        if warning:
            body["warning"] = warning
        return jsonify(body)
    except Exception as e:
        logger.error(f"print_banner error: {e}")
        try:
            db.rollback()
        except Exception:
            pass
        return jsonify({"success": False, "message": str(e)}), 500


def _enqueue_ticket(db, order_id, station_id=None, job_type="ticket"):
    """Snapshot + queue a job on the station's enabled printer.

    Returns (job_id, created) or (None, reason). Shared by the manual
    endpoint and the auto-print-on-arrival hooks. `job_type` picks which
    piece of paper: 'ticket' is the customer's number stub, 'label' is the
    barista's coffee label. Everything else about getting it to a printer
    is identical, which is why this takes an argument rather than being
    copied."""
    cur = db.cursor()
    if not station_id:
        cur.execute(
            "SELECT station_id FROM orders WHERE order_number = %s", (str(order_id),)
        )
        row = cur.fetchone()
        if row:
            station_id = row[0] if not isinstance(row, dict) else row.get("station_id")
    cur.execute(
        "SELECT * FROM printers WHERE enabled = TRUE AND station_id = %s "
        "ORDER BY id LIMIT 1",
        (station_id,),
    )
    printer = _row_to_dict(cur, cur.fetchone())
    if not printer:
        return None, "No enabled printer for this station"
    payload = _snapshot_order(db, order_id, station_id)
    if not payload:
        return None, f"Order {order_id} not found"
    return _enqueue(db, printer["id"], payload, order_id=order_id, job_type=job_type)


AUTO_PRINT_MODES = ("off", "arrival", "start")


def _auto_print_mode(db, device_fallback=None):
    """When should the coffee label print: 'off', 'arrival' or 'start'.

    While nobody has chosen, fall back to whatever the DEVICE was already
    doing (its old `autoPrintLabels` flag, passed in by the caller). That
    keeps a station that had auto-print working printing exactly as it
    did, without writing anything on its behalf -- the setting only starts
    to exist once somebody sets it deliberately.
    """
    try:
        from routes.consolidated_api_routes import _kv_get

        stored = _kv_get(db, "label_settings", default={}) or {}
        mode = str(stored.get("auto_print_mode") or "").lower()
        if mode in AUTO_PRINT_MODES:
            return mode
    except Exception as e:
        logger.warning(f"auto_print_mode lookup failed, assuming off: {e}")
        return "off"
    return "start" if device_fallback else "off"


@bp.route("/auto-print-mode", methods=["GET"])
def get_auto_print_mode():
    """What this station should do on Start. Read by the barista screen,
    which is where the decision is acted on."""
    try:
        db = _db()
        device = request.args.get("device_auto_print") == "true"
        return jsonify(
            {"success": True, "mode": _auto_print_mode(db, device_fallback=device)}
        )
    except Exception as e:
        logger.warning(f"auto-print-mode: {e}")
        return jsonify({"success": True, "mode": "off"})


def maybe_print_ticket(db, order_id, station_id=None):
    """Auto-ticket hook for walk-up/kiosk order creation. Fires only when
    the designer's ticket_on_walkup toggle is ON and the station has an
    enabled printer. Never raises — printing must never block an order."""
    try:
        from routes.consolidated_api_routes import _kv_get

        stored = _kv_get(db, "label_settings", default={}) or {}
        # Two independent things can print the moment an order arrives,
        # and they are different pieces of paper:
        #   the customer's number stub  (ticket_on_walkup)
        #   the barista's coffee label  (auto_print_mode == 'arrival')
        if stored.get("ticket_on_walkup"):
            _enqueue_ticket(db, order_id, station_id)
        if _auto_print_mode(db) == "arrival":
            _enqueue_ticket(db, order_id, station_id, job_type="label")
    except Exception as e:
        logger.warning(f"auto print on arrival skipped (non-fatal): {e}")
        try:
            db.rollback()
        except Exception:
            pass


@bp.route("/reprint", methods=["POST"])
@jwt_required_with_demo()
@role_required_with_demo(["admin", "staff", "barista"])
def reprint():
    db = _db()
    _ensure_tables(db)
    data = request.get_json(silent=True) or {}
    job_id = data.get("job_id")
    order_id = data.get("order_id")
    try:
        cur = db.cursor()
        if job_id:
            cur.execute("SELECT * FROM print_jobs WHERE id = %s", (str(job_id),))
        elif order_id:
            # Barista cards know the order, not the job — clone the most
            # recent label job for that order.
            cur.execute(
                "SELECT * FROM print_jobs WHERE order_id = %s AND type = 'label' "
                "ORDER BY created_at DESC LIMIT 1",
                (str(order_id),),
            )
        else:
            return (
                jsonify({"success": False, "message": "job_id or order_id required"}),
                400,
            )
        job = _row_to_dict(cur, cur.fetchone())
        if not job:
            return (
                jsonify(
                    {"success": False, "message": "no previous label for this order"}
                ),
                404,
            )
        payload = {}
        try:
            payload = json.loads(job.get("payload") or "{}")
        except Exception:
            pass

        # SEND IT TO THE PRINTER THIS STATION USES NOW, not the one the
        # original job happened to go to.
        #
        # Reprint cloned job['printer_id'] verbatim. That is defensible
        # for "print that exact job again", and it is not what the button
        # means: a barista pressing print on a card wants the label at
        # THEIR station. So after swapping the printers over, every
        # already-in-the-system order kept printing on the old machine,
        # faithfully, forever (Steve).
        #
        # The station comes from the caller if it sent one, otherwise
        # from the order itself. The original job's printer is the last
        # resort -- if no station printer can be found, reprinting
        # somewhere is better than refusing.
        target_printer = job.get("printer_id")
        station_id = data.get("station_id")
        if not station_id and job.get("order_id"):
            try:
                c2 = db.cursor()
                c2.execute(
                    "SELECT station_id FROM orders WHERE order_number = %s",
                    (str(job.get("order_id")),),
                )
                row = c2.fetchone()
                if row:
                    station_id = (
                        row[0] if not isinstance(row, dict) else row.get("station_id")
                    )
            except Exception:
                try:
                    db.rollback()
                except Exception:
                    pass
        if station_id:
            try:
                c3 = db.cursor()
                c3.execute(
                    "SELECT id FROM printers WHERE enabled = TRUE AND station_id = %s "
                    "ORDER BY id LIMIT 1",
                    (station_id,),
                )
                row = c3.fetchone()
                if row:
                    current = row[0] if not isinstance(row, dict) else row.get("id")
                    if current:
                        if current != target_printer:
                            logger.info(
                                "reprint: station %s now uses printer %s (was %s)",
                                station_id,
                                current,
                                target_printer,
                            )
                        target_printer = current
            except Exception as pe:
                logger.warning(f"reprint: could not resolve station printer: {pe}")
                try:
                    db.rollback()
                except Exception:
                    pass

        # The order id lives on the ORIGINAL job -- the new job is
        # deliberately queued with order_id=None so the idempotency check
        # cannot refuse a wanted second copy. Supersede explicitly here,
        # because this is exactly the path a barista uses after swapping
        # a broken printer out.
        _supersede_older_labels(db, job.get("order_id"), target_printer)

        new_id, _ = _enqueue(
            db,
            target_printer,
            payload,
            order_id=None,
            job_type=job.get("type") or "label",
        )
        body = {"success": True, "job_id": new_id, "printer_id": target_printer}
        warning = _offline_note(db, target_printer)
        if warning:
            body["warning"] = warning
        return jsonify(body)
    except Exception as e:
        logger.error(f"reprint error: {e}")
        try:
            db.rollback()
        except Exception:
            pass
        return jsonify({"success": False, "message": str(e)}), 500


@bp.route("/test", methods=["POST"])
@jwt_required_with_demo()
@role_required_with_demo(["admin", "staff", "barista"])
def test_print():
    db = _db()
    _ensure_tables(db)
    data = request.get_json(silent=True) or {}
    printer_id = data.get("printer_id")
    if printer_id is None:
        # Was int(None) -> a raw TypeError in the response body.
        station_id = data.get("station_id")
        if station_id is not None:
            cur = db.cursor()
            cur.execute(
                "SELECT id FROM printers WHERE station_id = %s AND enabled "
                "ORDER BY id LIMIT 1",
                (int(station_id),),
            )
            row = cur.fetchone()
            printer_id = (
                (row[0] if not isinstance(row, dict) else row.get("id"))
                if row
                else None
            )
        if printer_id is None:
            return (
                jsonify(
                    {
                        "success": False,
                        "message": "printer_id is required (or station_id with an "
                        "enabled printer assigned to it).",
                    }
                ),
                400,
            )
    try:
        payload = {
            "test": True,
            "order_number": "000",
            "name": "Test Print",
            "drink": "Calibration",
            "size": "",
            "milk": "",
            "modifiers": ["width ruler below"],
            "station_name": "Setup",
            "ts": datetime.now().isoformat(),
        }
        job_id, _ = _enqueue(db, int(printer_id), payload, job_type="test")
        warning = _offline_note(db, printer_id)
        body = {"success": True, "job_id": job_id}
        if warning:
            body["warning"] = warning
        return jsonify(body)
    except Exception as e:
        logger.error(f"test_print error: {e}")
        try:
            db.rollback()
        except Exception:
            pass
        return jsonify({"success": False, "message": str(e)}), 500


@bp.route("/jobs", methods=["GET"])
@jwt_required_with_demo()
def print_jobs_list():
    db = _db()
    _ensure_tables(db)
    _sweep_stuck_jobs(db)
    status = request.args.get("status")
    station_id = request.args.get("station_id")
    try:
        cur = db.cursor()
        q = (
            "SELECT j.id, j.printer_id, j.order_id, j.type, j.status, j.attempts, "
            "j.error, j.created_at, j.printed_at, p.name AS printer_name, "
            "p.station_id FROM print_jobs j LEFT JOIN printers p ON p.id = j.printer_id "
            "WHERE 1=1"
        )
        params = []
        if status:
            q += " AND j.status = %s"
            params.append(status)
        if station_id:
            q += " AND p.station_id = %s"
            params.append(int(station_id))
        q += " ORDER BY j.created_at DESC LIMIT 20"
        cur.execute(q, params)
        cols = [d[0] for d in cur.description]
        jobs = []
        for row in cur.fetchall():
            d = dict(zip(cols, row)) if not isinstance(row, dict) else dict(row)
            for k in ("created_at", "printed_at"):
                if hasattr(d.get(k), "isoformat"):
                    d[k] = d[k].isoformat()
            jobs.append(d)
        return jsonify({"success": True, "jobs": jobs})
    except Exception as e:
        logger.error(f"print_jobs_list error: {e}")
        try:
            db.rollback()
        except Exception:
            pass
        return jsonify({"success": False, "message": str(e)}), 500


@bp.route("/jobs/<job_id>/retry", methods=["POST"])
@jwt_required_with_demo()
@role_required_with_demo(["admin", "staff"])
def retry_job(job_id):
    """Put a failed (or stuck-fetched) job back on the queue with a fresh
    retry budget. The printer picks it up on its next poll."""
    db = _db()
    _ensure_tables(db)
    try:
        cur = db.cursor()
        cur.execute(
            "UPDATE print_jobs SET status = 'queued', attempts = 0, error = NULL, "
            "fetched_at = NULL WHERE id = %s AND status IN ('failed', 'fetched', 'cancelled')",
            (job_id,),
        )
        if cur.rowcount == 0:
            db.commit()
            return (
                jsonify(
                    {"success": False, "message": "job not found or not retryable"}
                ),
                404,
            )
        db.commit()
        return jsonify({"success": True})
    except Exception as e:
        logger.error(f"retry_job error: {e}")
        try:
            db.rollback()
        except Exception:
            pass
        return jsonify({"success": False, "message": str(e)}), 500


@bp.route("/jobs/<job_id>/cancel", methods=["POST"])
@jwt_required_with_demo()
@role_required_with_demo(["admin", "staff"])
def cancel_job(job_id):
    """Remove a job from the queue before the printer takes it. A job the
    printer has already fetched can't be un-sent, so only queued jobs
    cancel."""
    db = _db()
    _ensure_tables(db)
    try:
        cur = db.cursor()
        cur.execute(
            "UPDATE print_jobs SET status = 'cancelled', error = 'cancelled by operator' "
            "WHERE id = %s AND status = 'queued'",
            (job_id,),
        )
        if cur.rowcount == 0:
            db.commit()
            return (
                jsonify(
                    {
                        "success": False,
                        "message": "job not found or already taken by the printer",
                    }
                ),
                404,
            )
        db.commit()
        return jsonify({"success": True})
    except Exception as e:
        logger.error(f"cancel_job error: {e}")
        try:
            db.rollback()
        except Exception:
            pass
        return jsonify({"success": False, "message": str(e)}), 500


@bp.route("/roll", methods=["GET"])
@jwt_required_with_demo()
@role_required_with_demo(["admin", "staff", "barista"])
def label_roll_status():
    """Roughly how many labels are left on each printer's roll.

    Counts labels actually PRINTED since the roll was fitted -- not
    queued, because a job that never printed consumed no paper and
    over-counting sends someone to change a roll that is half full.

    Query: printer_id (optional; all enabled printers otherwise).
    """
    db = _db()
    _ensure_tables(db)
    try:
        from routes.consolidated_api_routes import _kv_get

        state = _kv_get(db, ROLL_SETTING_KEY, default={}) or {}
        cur = db.cursor()
        printer_id = request.args.get("printer_id")
        if printer_id:
            cur.execute("SELECT * FROM printers WHERE id = %s", (printer_id,))
        else:
            cur.execute("SELECT * FROM printers WHERE enabled = TRUE ORDER BY id")
        printers = [_row_to_dict(cur, r) for r in (cur.fetchall() or [])]

        out = []
        for pr in printers:
            if not pr:
                continue
            cfg = roll_for(state, pr["id"])
            c2 = db.cursor()
            if cfg.get("reset_at"):
                c2.execute(
                    "SELECT COUNT(*) FROM print_jobs WHERE printer_id = %s "
                    "AND printed_at IS NOT NULL AND printed_at >= %s",
                    (pr["id"], cfg["reset_at"]),
                )
            else:
                # Never recorded a roll change: count everything. That
                # reads LOW, which prompts a change and a reset -- erring
                # towards warning rather than towards silence.
                c2.execute(
                    "SELECT COUNT(*) FROM print_jobs WHERE printer_id = %s "
                    "AND printed_at IS NOT NULL",
                    (pr["id"],),
                )
            row = c2.fetchone()
            used = (row[0] if not isinstance(row, dict) else list(row.values())[0]) or 0
            info = assess(cfg["capacity"], used, cfg["warn_at"])
            info.update(
                {
                    "printer_id": pr["id"],
                    "printer": pr.get("name"),
                    "station_id": pr.get("station_id"),
                    "reset_at": cfg.get("reset_at"),
                }
            )
            out.append(info)
        return jsonify({"success": True, "rolls": out})
    except Exception as e:
        logger.error(f"label_roll_status error: {e}")
        try:
            db.rollback()
        except Exception:
            pass
        return jsonify({"success": False, "message": str(e)}), 500


@bp.route("/roll", methods=["POST"])
@jwt_required_with_demo()
@role_required_with_demo(["admin", "staff", "barista"])
def label_roll_update():
    """Record a new roll, or change a printer's roll settings.

    Body: {printer_id, capacity?, warn_at?, reset?}

    `reset: true` is the "I have just fitted a new roll" button. It
    stamps now, and everything printed from this moment counts against
    the new roll.
    """
    db = _db()
    _ensure_tables(db)
    data = request.get_json(silent=True) or {}
    printer_id = data.get("printer_id")
    if not printer_id:
        return jsonify({"success": False, "message": "printer_id is required"}), 400
    try:
        from routes.consolidated_api_routes import _kv_get, _kv_put

        state = _kv_get(db, ROLL_SETTING_KEY, default={}) or {}
        reset_at = datetime.now().isoformat() if data.get("reset") else None
        state = set_roll(
            state,
            printer_id,
            capacity=data.get("capacity"),
            warn_at=data.get("warn_at"),
            reset_at=reset_at,
        )
        _kv_put(db, ROLL_SETTING_KEY, state)
        if reset_at:
            logger.info(f"Printer {printer_id}: new label roll recorded")
        cfg = roll_for(state, printer_id)
        return jsonify({"success": True, "printer_id": printer_id, **cfg})
    except Exception as e:
        logger.error(f"label_roll_update error: {e}")
        try:
            db.rollback()
        except Exception:
            pass
        return jsonify({"success": False, "message": str(e)}), 500


@bp.route("/printers", methods=["GET"])
@jwt_required_with_demo()
def printers_list():
    db = _db()
    _ensure_tables(db)
    try:
        cur = db.cursor()
        cur.execute("SELECT * FROM printers ORDER BY id")
        cols = [d[0] for d in cur.description]
        out = []
        now = datetime.now()
        for row in cur.fetchall():
            d = dict(zip(cols, row)) if not isinstance(row, dict) else dict(row)
            lp = d.get("last_poll_at")
            online = bool(lp and (now - lp).total_seconds() <= CLOUDPRNT_POLL_TIMEOUT_S)
            d["online"] = online
            d["seconds_since_poll"] = int((now - lp).total_seconds()) if lp else None
            # What the printer says is wrong with it, in words. Stored on
            # every poll and, until now, never shown to anybody.
            d["fault"] = printer_fault(d.get("last_status"))
            for k in ("last_poll_at", "created_at"):
                if hasattr(d.get(k), "isoformat"):
                    d[k] = d[k].isoformat()
            try:
                d["last_status"] = json.loads(d.get("last_status") or "{}")
            except Exception:
                pass
            out.append(d)
        return jsonify({"success": True, "printers": out})
    except Exception as e:
        logger.error(f"printers_list error: {e}")
        try:
            db.rollback()
        except Exception:
            pass
        return jsonify({"success": False, "message": str(e)}), 500


@bp.route("/printers/<int:printer_id>", methods=["PATCH"])
@jwt_required_with_demo()
@role_required_with_demo(["admin", "staff"])
def update_printer(printer_id):
    """Enable/assign a printer from the Support panel (onboarding step)."""
    db = _db()
    _ensure_tables(db)
    data = request.get_json(silent=True) or {}
    sets, params = [], []
    if "driver" in data and data["driver"] not in VALID_DRIVERS:
        # Silently storing a typo would leave the UI describing a transport
        # that doesn't exist, which is worse than refusing the change.
        return (
            jsonify(
                {
                    "success": False,
                    "message": f"Unknown driver '{data['driver']}'. "
                    f"Valid: {', '.join(VALID_DRIVERS)}",
                }
            ),
            400,
        )
    for field in (
        "name",
        "station_id",
        "enabled",
        "width_dots",
        "ip_address",
        "driver",
        "offset_dots",
    ):
        if field in data:
            sets.append(f"{field} = %s")
            params.append(data[field])
    if not sets:
        return jsonify({"success": False, "message": "nothing to update"}), 400
    try:
        cur = db.cursor()
        params.append(printer_id)
        cur.execute(f"UPDATE printers SET {', '.join(sets)} WHERE id = %s", params)
        db.commit()
        return jsonify({"success": True})
    except Exception as e:
        logger.error(f"update_printer error: {e}")
        try:
            db.rollback()
        except Exception:
            pass
        return jsonify({"success": False, "message": str(e)}), 500


DEFAULT_LABEL_SETTINGS = {
    # Minimum label LENGTH in dots (the cutter cuts at image end, so this
    # is media consumed per cup). 380 = 47.5mm was leaving 14mm blank on
    # short labels. Tune against the real cutter.
    "min_height_dots": 380,
    "show_event_name": False,
    "show_logo": False,
    "show_station_time": True,
    "show_name": True,
    "align": "left",
    "rule_below_logo": False,
    "rule_below_number": False,
    "rule_below_drink": False,
    "rule_above_station": True,
    "rule_above_footer": False,
    "rule_between_footer_lines": False,
    "ticket_on_walkup": False,
    # WHEN the barista's coffee label prints, in one place.
    #
    # Before this there were two similar-sounding settings in two
    # different screens and neither of them was the whole answer:
    #   * `ticket_on_walkup` prints the CUSTOMER's number stub (the
    #     deli-counter slip) when a walk-up order is submitted. It has
    #     never printed the coffee label.
    #   * `autoPrintLabels` printed the coffee label on Start, but it
    #     lived in localStorage PER DEVICE -- so swapping the tablet
    #     mid-event silently stopped auto-printing, and it could not be
    #     set from the organiser's side at all.
    # And there was no way to print the coffee label on arrival.
    #
    # '' (absent) means "nobody has chosen yet", which is what makes the
    # migration in _auto_print_mode() safe.
    "auto_print_mode": "",
    "label_scale_mode": "compact",
    "banner_scale_mode": "grow",
    "footer_text": "",
    "instructions_text": "",
    # Station ids whose labels carry a milk shape. Empty = off, which is
    # what every event gets until a barista asks for it.
    "milk_symbol_stations": [],
}


def _label_options(db):
    """label_settings KV + live data (event name from branding, logo from
    the branding blob) → the renderer's options dict."""
    from routes.consolidated_api_routes import _kv_get

    stored = _kv_get(db, "label_settings", default={}) or {}
    opts = {**DEFAULT_LABEL_SETTINGS, **stored}
    try:
        cs = current_app.config.get("coffee_system")
        opts.setdefault("event_name", getattr(cs, "event_name", "") or "")
        if not (opts.get("event_name") or "").strip():
            opts["event_name"] = getattr(cs, "event_name", "") or ""
    except Exception:
        pass
    if opts.get("show_logo"):
        try:
            branding = _kv_get(db, "branding_settings", default={}) or {}
            # A LABEL logo is not the same asset as the screen logo.
            #
            # The screen logo is shown big on the login and display screens
            # and can be detailed and full-colour. The label prints at about
            # 7mm on a 1-bit thermal head, so it needs to be simple and high
            # contrast — Steve's current one is a sponsor-plus-event banner
            # made for the sticker, which is legible on a cup and turns to
            # mush anywhere small.
            #
            # labelLogo wins when set; otherwise fall back to the screen logo
            # exactly as before, so events that only ever upload one image
            # behave identically.
            opts["logo_data"] = (
                branding.get("labelLogo")
                or branding.get("clientLogo")
                or branding.get("logo")
                or ""
            )
        except Exception:
            opts["logo_data"] = ""
    return opts


@bp.route("/label-settings", methods=["GET"])
@jwt_required_with_demo()
def get_label_settings():
    db = _db()
    from routes.consolidated_api_routes import _kv_get

    stored = _kv_get(db, "label_settings", default={}) or {}
    merged = {**DEFAULT_LABEL_SETTINGS, **stored}
    try:
        cs = current_app.config.get("coffee_system")
        merged["event_name_effective"] = (
            merged.get("event_name") or getattr(cs, "event_name", "") or ""
        )
        branding = _kv_get(db, "branding_settings", default={}) or {}
        merged["logo_available"] = bool(
            branding.get("clientLogo") or branding.get("logo")
        )
    except Exception:
        pass
    return jsonify({"success": True, "settings": merged})


@bp.route("/label-settings", methods=["PUT"])
@jwt_required_with_demo()
@role_required_with_demo(["admin", "staff"])
def put_label_settings():
    """Save the label design options. Presentation-only — applied at
    render time, so the next fetch of any queued job already uses them."""
    db = _db()
    body = request.get_json(silent=True) or {}
    from routes.consolidated_api_routes import _kv_get, _kv_put

    stored = _kv_get(db, "label_settings", default={}) or {}
    for key in (
        "show_event_name",
        "show_logo",
        "show_station_time",
        "show_name",
        "rule_below_logo",
        "rule_below_number",
        "rule_below_drink",
        "rule_above_station",
        "rule_above_footer",
        "rule_between_footer_lines",
        "ticket_on_walkup",
    ):
        if key in body:
            stored[key] = bool(body[key])
    if "auto_print_mode" in body:
        mode = str(body.get("auto_print_mode") or "").lower()
        if mode in AUTO_PRINT_MODES:
            stored["auto_print_mode"] = mode
    if body.get("align") in ("left", "center"):
        stored["align"] = body["align"]
    # 'lid' = the half-height sticker for a cup lid (58 x ~40mm).
    if body.get("label_scale_mode") in ("compact", "grow", "lid"):
        stored["label_scale_mode"] = body["label_scale_mode"]
    if body.get("banner_scale_mode") in ("compact", "grow"):
        stored["banner_scale_mode"] = body["banner_scale_mode"]
    # 400 chars: enough for a full sentence in GROW mode (the label
    # lengthens to hold it); compact mode still truncates at render.
    if "footer_text" in body:
        stored["footer_text"] = str(body["footer_text"] or "").strip()[:400]
    if "instructions_text" in body:
        stored["instructions_text"] = str(body["instructions_text"] or "").strip()[:400]
    if "event_name" in body:
        # Blank = follow the system event name; non-blank = override.
        stored["event_name"] = str(body["event_name"] or "").strip()[:40]
    if "milk_symbol_stations" in body:
        from utils.milk_glyph import stations_from

        stored["milk_symbol_stations"] = sorted(
            stations_from(body["milk_symbol_stations"])
        )
    _kv_put(db, "label_settings", stored)
    return jsonify({"success": True, "settings": {**DEFAULT_LABEL_SETTINGS, **stored}})


# A typo is the real risk here, not a malicious request: "300" meant as
# "30" is most of a roll fed onto the floor before anyone looks up. The
# cap is low enough that the mistake is cheap and high enough that a
# realistic batch still goes in one go.
STICKER_MAX_BATCH = 200


@bp.route("/stickers", methods=["POST"])
@jwt_required_with_demo()
@role_required_with_demo(["admin", "staff", "barista"])
def print_stickers():
    """Batch-print branded stickers for plain house cups.

    Steve: "for smaller events with no custom cup run". A custom cup run
    has a minimum order and a lead time a fifty-person morning cannot
    justify, so the cups stay plain and the branding goes on the night
    before, in a batch, when there is time to do it.

    Each sticker is its own job because each is its own cut label. They
    queue like any other job, so an offline printer holds them rather
    than losing them, and the roll counter sees them as the paper they
    genuinely are.
    """
    db = _db()
    _ensure_tables(db)
    data = request.get_json(silent=True) or {}
    try:
        count = int(data.get("count") or 0)
    except (TypeError, ValueError):
        count = 0
    if count < 1:
        return (
            jsonify(
                {
                    "success": False,
                    "message": "How many stickers? Give a count of 1 or more.",
                }
            ),
            400,
        )
    if count > STICKER_MAX_BATCH:
        return (
            jsonify(
                {
                    "success": False,
                    "message": (
                        f"{count} is more than one batch — the most at a time is "
                        f"{STICKER_MAX_BATCH}. Run it again for the rest."
                    ),
                }
            ),
            400,
        )

    headline = str(data.get("headline") or "").strip()[:40]
    printer_id = data.get("printer_id")
    station_id = data.get("station_id")
    try:
        cur = db.cursor()
        if printer_id:
            cur.execute(
                "SELECT * FROM printers WHERE id = %s AND enabled = TRUE",
                (int(printer_id),),
            )
        else:
            cur.execute(
                "SELECT * FROM printers WHERE enabled = TRUE AND station_id = %s "
                "ORDER BY id LIMIT 1",
                (station_id,),
            )
        printer = _row_to_dict(cur, cur.fetchone())
        if not printer:
            return (
                jsonify({"success": False, "message": "No enabled printer found"}),
                404,
            )

        job_ids = []
        for _ in range(count):
            job_id, _created = _enqueue(
                db,
                printer["id"],
                {"headline": headline, "ts": datetime.now().isoformat()},
                job_type="sticker",
            )
            job_ids.append(job_id)

        body = {"success": True, "queued": len(job_ids), "job_ids": job_ids}
        notes = []
        offline = _offline_note(db, printer["id"])
        if offline:
            notes.append(offline)
        # WARN ABOUT THE ROLL, DO NOT REFUSE ON IT.
        #
        # The remaining count is an estimate from jobs printed since the
        # roll was recorded, and it is deliberately built to read low.
        # Blocking a batch on an approximation would stop real work over
        # a guess; saying "this is more than I think is left" lets the
        # operator put a fresh roll on first, which is all they need.
        try:
            left = _roll_remaining(db, printer["id"])
            if left is not None and count > left:
                notes.append(
                    f"That is more than the roll is likely to hold — about "
                    f"{left} labels left. Fit a fresh roll before it runs out "
                    f"mid-batch, or the last cups go unstickered."
                )
        except Exception as roll_err:
            logger.debug(f"sticker roll check skipped: {roll_err}")
        if notes:
            body["warning"] = " ".join(notes)
        return jsonify(body)
    except Exception as e:
        logger.error(f"print_stickers error: {e}")
        try:
            db.rollback()
        except Exception:
            pass
        return jsonify({"success": False, "message": str(e)}), 500


def _roll_remaining(db, printer_id):
    """Roughly how many labels this printer's roll still holds, or None.

    Same arithmetic as the /roll endpoint, kept to one helper so the
    batch warning and the status dot can never disagree about a roll.
    """
    from routes.consolidated_api_routes import _kv_get

    state = _kv_get(db, ROLL_SETTING_KEY, default={}) or {}
    cfg = roll_for(state, printer_id)
    cur = db.cursor()
    if cfg.get("reset_at"):
        cur.execute(
            "SELECT COUNT(*) FROM print_jobs WHERE printer_id = %s "
            "AND printed_at IS NOT NULL AND printed_at >= %s",
            (printer_id, cfg["reset_at"]),
        )
    else:
        cur.execute(
            "SELECT COUNT(*) FROM print_jobs WHERE printer_id = %s "
            "AND printed_at IS NOT NULL",
            (printer_id,),
        )
    row = cur.fetchone()
    used = (row[0] if not isinstance(row, dict) else list(row.values())[0]) or 0
    return assess(cfg["capacity"], used, cfg["warn_at"]).get("remaining")


@bp.route("/milk-symbols", methods=["GET"])
@jwt_required_with_demo()
@role_required_with_demo(["admin", "staff", "barista"])
def get_milk_symbols():
    """Is this station printing milk shapes, and what are they?

    Barista-reachable on purpose. The label DESIGN belongs to whoever
    runs the event, but which shorthand helps at the machine is a call
    for the person standing at it — Steve: "an option baristas could
    choose in menu". Handing back the shape table too means the barista
    menu can show the actual marks rather than describing them.
    """
    db = _db()
    from routes.consolidated_api_routes import _kv_get
    from utils.milk_glyph import MILK_GLYPHS, stations_from

    stored = _kv_get(db, "label_settings", default={}) or {}
    stations = stations_from(stored.get("milk_symbol_stations"))
    try:
        sid = int(request.args.get("station_id"))
    except (TypeError, ValueError):
        sid = None
    return jsonify(
        {
            "success": True,
            "station_id": sid,
            "enabled": sid in stations if sid is not None else False,
            "stations": sorted(stations),
            "glyphs": MILK_GLYPHS,
        }
    )


@bp.route("/milk-symbols", methods=["PUT", "POST"])
@jwt_required_with_demo()
@role_required_with_demo(["admin", "staff", "barista"])
def put_milk_symbols():
    """Turn milk shapes on or off for ONE station.

    Reads the list, changes one id, writes it back — so two stations
    flipping their own switch a second apart cannot erase each other,
    which a whole-list PUT from each barista would.
    """
    db = _db()
    body = request.get_json(silent=True) or {}
    try:
        sid = int(body.get("station_id"))
    except (TypeError, ValueError):
        return jsonify({"success": False, "message": "station_id required"}), 400
    enabled = bool(body.get("enabled"))
    from routes.consolidated_api_routes import _kv_get, _kv_put
    from utils.milk_glyph import stations_from

    stored = _kv_get(db, "label_settings", default={}) or {}
    stations = stations_from(stored.get("milk_symbol_stations"))
    stations.add(sid) if enabled else stations.discard(sid)
    stored["milk_symbol_stations"] = sorted(stations)
    _kv_put(db, "label_settings", stored)
    return jsonify(
        {
            "success": True,
            "station_id": sid,
            "enabled": enabled,
            "stations": sorted(stations),
        }
    )


@bp.route("/preview", methods=["GET"])
@jwt_required_with_demo()
def preview_label():
    """Browser-viewable label preview — iterate the design without paper.
    ?order_id=... renders that order's snapshot; no order_id renders the
    calibration test label; ?sample=1 renders a realistic (non-test)
    sample order for the designer. ?width= overrides PRINT_WIDTH_DOTS."""
    db = _db()
    _ensure_tables(db)
    order_id = request.args.get("order_id")
    width = request.args.get("width")
    try:
        if order_id:
            payload = _snapshot_order(db, order_id)
            if not payload:
                return jsonify({"success": False, "message": "order not found"}), 404
        else:
            payload = {
                "order_number": "047",
                "name": "Stephanie Routley",
                "drink": "flat white",
                "size": "medium",
                "milk": "oat",
                "modifiers": ["Extra hot", "1 sugar"],
                "station_name": "Coffee Station 1",
                "station_id": 1,
                "ts": datetime.now().isoformat(),
            }
            if request.args.get("sample") != "1":
                payload["test"] = True
        from services.label_printer import (
            render_label,
            render_ticket,
            render_banner,
            render_sticker,
        )

        banner_text = request.args.get("banner")
        if banner_text:
            renderer = render_banner
            payload = {"text": banner_text}
        elif request.args.get("sticker") == "1":
            # Nobody should commit three hundred stickers to a roll
            # without having seen one.
            renderer = render_sticker
            payload = {"headline": request.args.get("headline") or ""}
        else:
            renderer = (
                render_ticket if request.args.get("ticket") == "1" else render_label
            )
        opts = _label_options(db)
        # ?milk_symbols=1|0 previews the shapes without committing to
        # them, so a barista can look at a real label before deciding.
        # It overrides the stored per-station list for this render only.
        forced = request.args.get("milk_symbols")
        if forced in ("0", "1"):
            opts = dict(opts)
            sid = payload.get("station_id")
            opts["milk_symbol_stations"] = (
                [sid] if (forced == "1" and sid is not None) else []
            )
        png = renderer(payload, int(width) if width else None, options=opts)
        return Response(png, mimetype="image/png")
    except Exception as e:
        logger.error(f"preview_label error: {e}")
        return jsonify({"success": False, "message": str(e)}), 500
