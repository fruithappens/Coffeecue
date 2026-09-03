"""Customer-facing station naming, shared by every SMS path."""
import logging

logger = logging.getLogger("expresso.station_label")


def station_label(db, station_id, default_prefix='Station',
                  with_location=True):
    """What to call a station in customer-facing text.

    SMS said "Station 3" while the operator had named it "Coffee Cart 2" or
    "East Wing" - so the text sent someone to a place with a different name
    on the sign. Uses the configured name, falling back to the old wording
    only when a station has none.

    Appends the station's LOCATION when it has one, because at a venue
    with two rooms "ready at Coffee Station 2" does not tell someone
    standing in the concourse to walk into the Ferguson Room. Pass
    with_location=False where only the bare name is wanted.

    Kept short deliberately: this lands inside SMS bodies, where a long
    name can push a message over 160 characters and double its cost.
    Name is capped at 28 characters and the location at 24.

    Never raises. A name lookup must not be able to stop a ready-message
    going out; if the read fails, the caller gets the old wording.
    """
    if not station_id:
        return ''
    try:
        cur = db.cursor()
        cur.execute(
            "SELECT name, notes, location, equipment_notes FROM station_stats "
            "WHERE station_id = %s", (station_id,))
        row = cur.fetchone()
        name = notes_name = location = notes = None
        if row:
            if isinstance(row, dict):
                name = row.get('name')
                notes_name = row.get('notes')
                location = row.get('location')
                notes = row.get('equipment_notes')
            else:
                name, notes_name, location, notes = row[0], row[1], row[2], row[3]

        # WHERE the customer-facing NAME actually lives.
        #
        # station_stats stores the operator's station name in `notes`, NOT
        # the `name` column (which is usually empty): the stations API maps
        # name<-notes (station_api_routes.py:88), so displays and signage
        # show "Coffee Station 2". Reading only `name` here made the SMS say
        # a bare "Station 2" while every screen said "Coffee Station 2".
        # Prefer whichever is set, and never surface stray capabilities JSON.
        name = (name or '').strip()
        if not name:
            cand = (notes_name or '').strip()
            if cand and not cand.startswith('{'):
                name = cand

        # WHERE the location actually lives.
        #
        # station_stats has a real `location` column, AND the Organiser UI
        # writes its "Location" field into `equipment_notes` -- the
        # stations API even overwrites location with equipment_notes on
        # the way out (station_api_routes.py:89). Two places for one
        # fact, so read both and prefer the real column.
        #
        # An old save bug dumped capabilities JSON into equipment_notes;
        # those rows look like '{"coffee_types": ...'. Never put that in
        # front of a customer.
        place = (location or '').strip()
        if not place:
            candidate = (notes or '').strip()
            if candidate and not candidate.startswith('{'):
                place = candidate

        if name and place and with_location:
            # Don't repeat yourself: a station already called "Ferguson
            # Room" should not become "Ferguson Room - Ferguson Room".
            if place.lower() not in name.lower():
                return f"{name[:28]} - {place[:24]}"
        if name:
            return name[:28]
        if place and with_location:
            return f"{default_prefix} {station_id} - {place[:24]}"
    except Exception:
        try:
            db.rollback()
        except Exception:
            pass
    return f"{default_prefix} {station_id}"
