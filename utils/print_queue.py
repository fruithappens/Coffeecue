"""Stopping a dead printer from printing yesterday's labels.

Two ways a cup label goes stale in the queue, both seen on Steve's
system:

1. THE PRINTER WAS SWAPPED OUT. A label is queued to printer A, printer
   A dies, a spare is put on that station, and the barista presses print
   again. The new job goes to the new printer -- but the old job is
   still sitting in printer A's queue. Plug printer A back in next week
   and it cheerfully prints a label for a coffee that was drunk days
   ago.

2. THE PRINTER NEVER CAME BACK AT ALL. Station 1's printer had not
   checked in for two days while still enabled, so everything printed at
   that station queued into nothing. The existing sweep did not catch
   these: it only handles jobs a printer FETCHED and then died holding.
   A job nobody ever fetched just waits, indefinitely.

The rule underneath both: **a cup label's usefulness expires with the
drink.** Nobody wants the label half an hour later, and printing it is
worse than not printing it -- it puts a name on a cup that no longer
corresponds to anything.
"""

# NO TIMESTAMPS IN HERE, ON PURPOSE.
#
# The first version of this compared created_at against
# datetime.now(timezone.utc). print_jobs.created_at is `timestamp
# WITHOUT time zone` holding the DATABASE server's local clock, so on a
# UTC host it happened to work and anywhere else it silently did
# nothing -- the job looked like it was created in the future, so it was
# never stale, so the sweep cancelled nothing. It passed its unit tests
# the whole time, because the tests supplied both timestamps.
#
# So this module does arithmetic on AGES IN SECONDS and the caller gets
# them from SQL, where NOW() and created_at share one clock and the
# question of which timezone anything is in cannot arise.


# How long a job may sit unfetched before it is not worth printing.
#
# Generous on purpose: a printer that drops off venue wifi for a few
# minutes should keep its queue, because those labels ARE still wanted
# when it comes back. Half an hour is past the point where any barista
# would still want the sticker.
DEFAULT_STALE_SECONDS = 30 * 60


def is_stale(
    job_age_seconds, printer_silent_seconds, stale_seconds=DEFAULT_STALE_SECONDS
):
    """Should this queued job be given up on?

    Both ages come from SQL. `printer_silent_seconds` is None when the
    printer has never polled at all.

    Stale means BOTH: the job has waited longer than the window, AND the
    printer has been silent at least that long. Both halves matter -- a
    busy printer with a long queue is not stale, and a job queued a
    moment ago for a printer having a wifi blip is not stale either.

    Anything unreadable returns False. A number we cannot parse is not
    evidence that a label should be thrown away, and the cost of getting
    that wrong is a barista's label vanishing for no visible reason.
    """
    try:
        job_age = float(job_age_seconds)
    except (TypeError, ValueError):
        return False
    if job_age <= stale_seconds:
        return False

    # Never polled at all is not a blip, it is a printer that is not there.
    if printer_silent_seconds is None:
        return True
    try:
        silent = float(printer_silent_seconds)
    except (TypeError, ValueError):
        return False
    return silent > stale_seconds


def supersedes(new_printer_id, old_printer_id):
    """Does queuing this job make an existing queued job pointless?

    Only when the printer CHANGED. Re-printing to the same printer is
    the operator asking for a second copy -- a genuine thing to want,
    and _enqueue already de-duplicates the accidental double-tap case.
    A different printer means the station moved, and the label on the
    old machine is now something nobody will collect.
    """
    if new_printer_id is None or old_printer_id is None:
        return False
    return str(new_printer_id) != str(old_printer_id)
