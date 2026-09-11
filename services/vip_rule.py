"""VIPs and speakers go where the organiser says.

An organiser wants the keynote speaker through the coffee line faster, or
sent to the sponsor's cart that only serves VIPs and has no queue. Until now
the only way to be a VIP was to type the VIP code. This is the rule that
does it from the EventsAir registration instead: "anyone whose registration
category is Speaker, or who carries the tag VIP, jumps the queue and is
sent to station 3".

One rule, applied in one place, so every door behaves the same -- a text,
the phone form, the kiosk, the barista's walk-up, a scanned badge. Each
order path calls `resolve()` with whatever it knows about the person (the
phone number, or the EventsAir contact id) and gets back: is this a VIP,
why, and which station if the rule names one. The station picker then
honours `vip_only_stations` so nobody else is ever routed to the sponsor's
cart.

What counts as a marker is deliberately loose. EventsAir has never been
synced against a live event from here, so which of its fields an organiser
will actually use is unknown: the registration category, a tag, a custom
field ("VIP: Yes"), or one of the four user-defined fields. A marker
matches any of them, case-insensitively; "name=value" matches a custom
field by name. The organiser types what they see on the EA record.

The rule lives in the settings KV under `vip_rule`:
  {"markers": ["Speaker", "VIP"], "jump_queue": true,
   "station_id": 3, "vip_only_stations": [3]}
"""

import json
import logging

logger = logging.getLogger("expresso.vip_rule")

RULE_KEY = "vip_rule"

DEFAULT_RULE = {
    "markers": [],
    "jump_queue": True,
    "station_id": None,
    "vip_only_stations": [],
}

NOT_VIP = {"vip": False, "reason": "", "station_id": None}


def _norm(value):
    try:
        return " ".join(str(value or "").strip().lower().split())
    except Exception:
        return ""


def read_rule(raw):
    """The rule with safe defaults. A missing or broken setting means
    "no rule" -- an event that never configured this must keep routing
    exactly as before."""
    rule = dict(DEFAULT_RULE)
    try:
        if isinstance(raw, (bytes, str)):
            raw = json.loads(raw) if str(raw).strip() else {}
        if not isinstance(raw, dict):
            return rule
        markers = raw.get("markers") or []
        if isinstance(markers, str):
            markers = [m for m in markers.replace("\n", ",").split(",")]
        rule["markers"] = [m.strip() for m in markers if str(m or "").strip()][:50]
        rule["jump_queue"] = bool(raw.get("jump_queue", True))
        sid = raw.get("station_id")
        rule["station_id"] = int(sid) if sid not in (None, "", 0, "0") else None
        only = raw.get("vip_only_stations") or []
        rule["vip_only_stations"] = sorted({int(s) for s in only if str(s).strip().isdigit()})
    except Exception as e:
        logger.warning(f"vip_rule: unreadable setting ({e}); treating as no rule")
        return dict(DEFAULT_RULE)
    return rule


def load_rule(cursor):
    """Read the rule from the settings table. Never raises."""
    try:
        cursor.execute("SELECT value FROM settings WHERE key = %s", (RULE_KEY,))
        row = cursor.fetchone()
        if not row:
            return dict(DEFAULT_RULE)
        return read_rule(row[0] if not isinstance(row, dict) else row.get("value"))
    except Exception as e:
        logger.warning(f"vip_rule: could not load ({e})")
        return dict(DEFAULT_RULE)


def attendee_signals(row):
    """Everything on a mirrored attendee that a marker could match.

    Returns (plain_values, named_pairs): plain values are the category,
    each tag, each custom-field value and each user-defined field; named
    pairs are "name=value" for custom fields so a marker can be specific
    ("vip=yes") when the value alone ("yes") would be too loose.
    """
    plain, named = set(), set()
    if not row:
        return plain, named
    get = (lambda k: row.get(k)) if isinstance(row, dict) else (lambda k: None)
    cat = _norm(get("registration_category"))
    if cat:
        plain.add(cat)
    for t in (get("tags") or []):
        if _norm(t):
            plain.add(_norm(t))
    cf = get("custom_fields")
    try:
        if isinstance(cf, str):
            cf = json.loads(cf) if cf.strip() else {}
    except Exception:
        cf = {}
    if isinstance(cf, dict):
        for k, v in cf.items():
            if _norm(v):
                plain.add(_norm(v))
                named.add(f"{_norm(k)}={_norm(v)}")
    elif isinstance(cf, list):
        for item in cf:
            if isinstance(item, dict):
                k, v = item.get("name"), item.get("value")
                if _norm(v):
                    plain.add(_norm(v))
                    named.add(f"{_norm(k)}={_norm(v)}")
    udf = get("udf")
    try:
        if isinstance(udf, str):
            udf = json.loads(udf) if udf.strip() else {}
    except Exception:
        udf = {}
    if isinstance(udf, dict):
        for k, v in udf.items():
            if _norm(v):
                plain.add(_norm(v))
                named.add(f"{_norm(k)}={_norm(v)}")
    return plain, named


def match(rule, row):
    """Which marker (if any) this attendee matches. Returns the marker as
    the organiser typed it, or ''."""
    markers = (rule or {}).get("markers") or []
    if not markers or not row:
        return ""
    plain, named = attendee_signals(row)
    for m in markers:
        nm = _norm(m)
        if not nm:
            continue
        if nm in plain or nm in named:
            return m
    return ""


def _lookup(cursor, phone="", ea_contact_id=""):
    """The mirrored attendee for a contact id or a phone. The contact id is
    exact; a phone matches either number EA holds (registered or local)."""
    cols = ("ea_contact_id, first_name, registration_category, tags, "
            "custom_fields, udf")
    try:
        if ea_contact_id:
            cursor.execute(
                f"SELECT {cols} FROM ea_attendees WHERE ea_contact_id = %s",
                (str(ea_contact_id).strip(),))
            row = cursor.fetchone()
            if row:
                return _as_dict(cursor, row)
        if phone:
            from services.eventsair.survey import normalize_phone_e164
            e164 = normalize_phone_e164(phone) or str(phone).strip()
            if e164:
                cursor.execute(
                    f"SELECT {cols} FROM ea_attendees "
                    "WHERE mobile_e164 = %s OR mobile_alt_e164 = %s LIMIT 1",
                    (e164, e164))
                row = cursor.fetchone()
                if row:
                    return _as_dict(cursor, row)
    except Exception as e:
        logger.warning(f"vip_rule: attendee lookup failed ({e})")
    return None


def _as_dict(cursor, row):
    if isinstance(row, dict):
        return row
    try:
        names = [d[0] for d in cursor.description]
        return dict(zip(names, row))
    except Exception:
        return None


def resolve(cursor, phone="", ea_contact_id="", rule=None):
    """Is this person a VIP under the event's rule?

    Returns {"vip": bool, "reason": marker, "station_id": int|None}.
    Never raises and never blocks an order: any failure means "not a VIP",
    which is exactly what happened before this existed.
    """
    try:
        rule = rule if rule is not None else load_rule(cursor)
        if not rule.get("markers"):
            return dict(NOT_VIP)
        if not (phone or ea_contact_id):
            return dict(NOT_VIP)
        row = _lookup(cursor, phone=phone, ea_contact_id=ea_contact_id)
        why = match(rule, row)
        if not why:
            return dict(NOT_VIP)
        return {
            "vip": bool(rule.get("jump_queue", True)) or bool(rule.get("station_id")),
            "reason": why,
            "station_id": rule.get("station_id"),
            "jump_queue": bool(rule.get("jump_queue", True)),
        }
    except Exception as e:
        logger.warning(f"vip_rule: resolve failed ({e}); not a VIP")
        return dict(NOT_VIP)


def vip_only_stations(cursor, rule=None):
    """Station ids that only VIPs may be routed to. Empty when no rule."""
    try:
        rule = rule if rule is not None else load_rule(cursor)
        return set(rule.get("vip_only_stations") or [])
    except Exception:
        return set()


def allowed_stations(cursor, station_ids, is_vip, rule=None):
    """Filter a candidate list: a non-VIP never lands on a VIP-only station.
    If that would leave nothing (every open station is VIP-only), the
    original list is returned -- a coffee still has to be made somewhere,
    and an empty queue is worse than a VIP cart taking one walk-up."""
    try:
        only = vip_only_stations(cursor, rule)
        if is_vip or not only:
            return list(station_ids)
        kept = [s for s in station_ids if int(s) not in only]
        return kept or list(station_ids)
    except Exception:
        return list(station_ids)
