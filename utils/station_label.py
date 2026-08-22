"""Customer-facing station naming, shared by every SMS path."""
import logging

logger = logging.getLogger("expresso.station_label")


def station_label(db, station_id, default_prefix='Station'):
    """What to call a station in customer-facing text.

    SMS said "Station 3" while the operator had named it "Coffee Cart 2" or
    "East Wing" - so the text sent someone to a place with a different name
    on the sign. Uses the configured name, falling back to the old wording
    only when a station has none.

    Kept short deliberately: this lands inside SMS bodies, where a long
    name can push a message over 160 characters and double its cost.

    Never raises. A name lookup must not be able to stop a ready-message
    going out; if the read fails, the caller gets the old wording.
    """
    if not station_id:
        return ''
    try:
        cur = db.cursor()
        cur.execute("SELECT name FROM station_stats WHERE station_id = %s",
                    (station_id,))
        row = cur.fetchone()
        name = None
        if row:
            name = row['name'] if isinstance(row, dict) else row[0]
        name = (name or '').strip()
        if name:
            return name[:28]
    except Exception:
        try:
            db.rollback()
        except Exception:
            pass
    return f"{default_prefix} {station_id}"
