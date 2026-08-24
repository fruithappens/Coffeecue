"""A shape per milk, for a printer that only has black.

Colour coding works on the barista board and dies at the printer: a
thermal head has one ink. Steve: "a symbol, shape, icon that can show
oat, almond, skim etc ... like how there is colour ID in the batching
process".

The rule that makes these work is that they must be distinguishable
BLURRED. A label is read at arm's length, upside down, on a cup someone
is already carrying. Glyphs that differ only in fine detail all look
like a smudge at that distance, so these differ in silhouette: filled
versus hollow, round versus square, one mark versus two.

They are also deliberately NOT letters. "O" for oat and "A" for almond
is the obvious idea and the wrong one -- it fails exactly when it
matters, because the drink name is right there in words and a letter
adds nothing a glance can use.
"""

# Shape per milk. ASCII only: Railway has no system fonts and labels
# render through Pillow's embedded face, so a glyph that face lacks
# prints as a box -- which is worse than no glyph at all.
#
# Chosen so no two share a silhouette:
#   full cream  (())  double round, the "standard" and the busiest
#   skim        ( )   the same round, hollowed -- lighter, literally
#   oat         [#]   square and filled: the most-ordered alternative,
#                     so it gets the most distinct shape
#   soy         [/]   square, striped
#   almond      <>    diamond
#   lactose free (X)  round with a cross: "milk, minus something"
#   coconut     (*)   round, starred
#   macadamia   <*>   diamond, starred
MILK_GLYPHS = {
    "full cream": "(())",
    "skim": "(  )",
    "oat": "[##]",
    "soy": "[//]",
    "almond": "<>",
    "lactose free": "(X)",
    "coconut": "(*)",
    "macadamia": "<*>",
    "rice": "[..]",
    "a2": "(A2)",
}

# Drinks with no milk get nothing. A glyph meaning "none" is a mark the
# barista has to decode to learn there is nothing to decode.
NO_MILK = ("no milk", "none", "black", "")


def normalise(milk):
    """Lowercased, trailing ' milk' removed: 'Oat Milk' -> 'oat'."""
    text = str(milk or "").strip().lower()
    if text.endswith(" milk"):
        text = text[:-5].strip()
    return text


def glyph_for(milk):
    """The shape for this milk, or '' when there is nothing to mark.

    An unknown milk returns '' rather than a fallback shape. A glyph
    that means "some milk we have no symbol for" is worse than none:
    the barista learns to trust the marks, then meets one that does not
    tell them anything, and stops trusting all of them.
    """
    key = normalise(milk)
    if key in NO_MILK:
        return ""
    return MILK_GLYPHS.get(key, "")


def label_prefix(milk, enabled):
    """What to put in front of the milk name on a label.

    Off by default. Steve: "think it would only be a option baristas
    could choose in menu" -- a station running one milk gains nothing
    from a symbol and loses the width.
    """
    if not enabled:
        return ""
    g = glyph_for(milk)
    return f"{g} " if g else ""


# The setting is a LIST OF STATIONS, not a global switch.
#
# Steve: "think it would only be a option baristas could choose in menu".
# A station pouring one milk gains nothing from a symbol and loses the
# width, while the station running six alternatives wants them badly --
# and at a real event those two stations are three metres apart, printing
# from the same server. A single global flag makes one barista's
# preference everyone else's label.
SYMBOL_STATIONS_KEY = "milk_symbol_stations"


def stations_from(value):
    """Coerce a stored setting into a set of int station ids.

    Junk in any form yields an EMPTY set, which means symbols OFF. That
    is the safe direction here: an unexpected mark on a label is a
    barista pausing to work out what it means, whereas the absence of one
    is simply the labels they have printed all along.
    """
    out = set()
    if isinstance(value, (list, tuple, set)):
        for item in value:
            try:
                out.add(int(item))
            except (TypeError, ValueError):
                continue
    return out


def enabled_for(options, station_id):
    """Should this label carry milk symbols?

    `options` is the label_settings blob and `station_id` comes from the
    frozen job payload, so the station is whatever it was when the job
    was queued while the on/off choice is read fresh at render time --
    the same split every other label option already uses.

    A payload with no station_id at all (an old queued job, a test
    label) gets no symbols rather than an arbitrary station's setting.
    """
    if station_id is None:
        return False
    try:
        sid = int(station_id)
    except (TypeError, ValueError):
        return False
    return sid in stations_from((options or {}).get(SYMBOL_STATIONS_KEY))
