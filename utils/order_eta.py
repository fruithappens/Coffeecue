"""How long until this coffee is ready.

Shown on the customer's own phone while they wait, so it has to be
honest rather than flattering. An optimistic estimate is worse than no
estimate at all: quote five minutes, take twelve, and you have
manufactured a complaint at minute six that would never have existed.

Three rules follow from that, and they are the whole design:

  1. Round UP and quote conservatively. Being early is a pleasant
     surprise; being late is the only failure mode that matters.
  2. Never count below zero. Once the estimate elapses the page says
     "any moment now" -- a countdown going negative reads as broken and
     destroys trust in every other number on the screen.
  3. Past a ceiling, stop pretending to be precise. "20+ min" is honest;
     "47 min" implies an accuracy nobody has.

The throughput figure is measured from the station's own recent
completions, not assumed. CTN26 gives the sanity check: one cart held a
5-7 minute wait at 27 orders an hour and blew out to 23 minutes at 41,
so anything near 2.2 seconds-per-coffee is a busy-but-coping cart.
"""

# Fallback pace when a station has not completed enough orders to measure.
# 150s = 24/hour, a little slower than CTN26's comfortable 27/hour,
# because over-quoting is the safe direction.
DEFAULT_SECONDS_PER_COFFEE = 150

# Guard rails on the measured figure, so one freak gap or one burst of
# batch completions cannot produce a nonsense pace.
MIN_SECONDS_PER_COFFEE = 45
MAX_SECONDS_PER_COFFEE = 420

# Completions needed before we trust a measurement over the default.
MIN_SAMPLE = 3

# A gap longer than this between two completions means the barista was
# not working -- no queue, a break, the session was in. Counting idle
# time as "pace" is the trap: a cart that made three coffees in a quiet
# half hour is not slow, it is unbusy, and dividing 30 minutes by 3 says
# seven minutes a coffee and scares the next customer off.
IDLE_GAP_SECONDS = 600

# What each EXTRA drink in a batch costs, as a fraction of a full one.
# Eight flat whites with the same milk are steamed in one jug and pulled
# back to back; they are not eight times one flat white. This is the
# "if it's been batched" part -- without it the board over-quotes badly
# on exactly the rush where the estimate matters most.
BATCH_EXTRA_COST = 0.4

MIN_ETA_MINUTES = 1
MAX_ETA_MINUTES = 20


def batch_key(details):
    """What makes two drinks batchable: same drink, same milk.

    Milk is part of it. A chai brewed into oat cannot share a jug with a
    chai brewed into full cream, which is why the barista board groups
    on both -- and the estimate has to agree with the board.
    """
    if not isinstance(details, dict):
        return ("", "")
    drink = str(details.get("type") or details.get("coffee_type") or "").strip().lower()
    milk = str(details.get("milk") or details.get("milk_type") or "").strip().lower()
    return (drink, milk)


def effective_coffee_count(orders_ahead):
    """Orders ahead of you, discounted for batching.

    Returns a float: the first drink in each batch costs a full coffee,
    every additional one costs BATCH_EXTRA_COST.
    """
    groups = {}
    for details in orders_ahead or []:
        key = batch_key(details)
        groups[key] = groups.get(key, 0) + 1
    return sum(1 + (n - 1) * BATCH_EXTRA_COST for n in groups.values())


def seconds_per_coffee(completion_epochs):
    """How fast this station works, from the gaps between completions.

    Takes a list of completion times as epoch seconds. Measures the gaps
    between consecutive completions and takes the MEDIAN of the working
    ones -- gaps under IDLE_GAP_SECONDS.

    Measuring gaps rather than dividing a window by a count is the whole
    point. The window method cannot tell a slow cart from a quiet one:
    three coffees in a quiet half hour comes out as seven minutes each,
    and the next customer is told twenty-plus minutes for a queue that
    will actually clear in nine. Testing caught exactly that.

    The median, not the mean, so one long gap inside an otherwise busy
    stretch does not drag the estimate out.

    Clamped at both ends: a batch marked off in the same second would
    otherwise imply a pace of nothing and promise instant coffee.
    """
    try:
        times = sorted(float(t) for t in (completion_epochs or []))
    except (TypeError, ValueError):
        return DEFAULT_SECONDS_PER_COFFEE
    if len(times) < MIN_SAMPLE:
        return DEFAULT_SECONDS_PER_COFFEE

    gaps = [b - a for a, b in zip(times, times[1:]) if 0 <= (b - a) <= IDLE_GAP_SECONDS]
    if len(gaps) < MIN_SAMPLE - 1:
        return DEFAULT_SECONDS_PER_COFFEE

    gaps.sort()
    mid = len(gaps) // 2
    median = gaps[mid] if len(gaps) % 2 else (gaps[mid - 1] + gaps[mid]) / 2.0
    return max(MIN_SECONDS_PER_COFFEE, min(MAX_SECONDS_PER_COFFEE, median))


def estimate_minutes(
    status, orders_ahead=None, in_progress=0, pace_seconds=DEFAULT_SECONDS_PER_COFFEE
):
    """Minutes until this order is ready, or None when the question does
    not apply (it is already made, or cancelled).

    `orders_ahead` is a list of order_details dicts for the pending
    orders in front of this one, so batching can be taken into account.
    `in_progress` is how many are on the bench right now -- counted at
    full cost, deliberately, because a half-made coffee still has to be
    finished before yours is started.
    """
    state = str(status or "").strip().lower().replace("_", "-")
    if state in ("completed", "picked-up", "ready", "cancelled"):
        return None

    pace = (
        pace_seconds
        if pace_seconds and pace_seconds > 0
        else DEFAULT_SECONDS_PER_COFFEE
    )

    if state == "in-progress":
        # Yours is on the bench: roughly one coffee's work left.
        seconds = pace
    else:
        ahead = effective_coffee_count(orders_ahead)
        try:
            bench = max(0, int(in_progress or 0))
        except (TypeError, ValueError):
            bench = 0
        # Everything in front of you, plus your own coffee.
        seconds = (ahead + bench + 1) * pace

    minutes = int(seconds // 60) + (1 if seconds % 60 else 0)  # round up
    return max(MIN_ETA_MINUTES, min(MAX_ETA_MINUTES, minutes))


def describe(minutes, capped_at=MAX_ETA_MINUTES):
    """The words the customer actually reads.

    None means there is nothing to promise. At the ceiling it stops
    quoting a number, because past twenty minutes the estimate is a
    guess wearing a uniform.
    """
    if minutes is None:
        return ""
    if minutes >= capped_at:
        return f"{capped_at}+ min"
    if minutes <= 1:
        return "about a minute"
    return f"about {minutes} min"
