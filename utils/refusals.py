"""Demand we turned away, as rows.

An order refused for stock -- "we've run out of oat", "no decaf today", a
mocha with the chocolate gone -- used to be a logger.info line and a text
back to the customer, and then nothing. The report counted what we sold and
was silent about what we could not, which is the number a caterer plans the
next event on (finding 4 in docs/FINDINGS_ROADMAP.md).

Every refusal is now one row in client_events with code ORDER_REFUSED -- the
same table the ordering screen's UNAVAILABLE_TAP already lands in, so the
report reads both from one place. The payload names the channel, the reason
and the item asked for. It never carries a phone number or a name.

    note_refusal(db, channel='sms', reason='no_milk', item='oat',
                 drink='latte', milk='oat')

Never raises: a failure to count a refusal must not turn into a second
failure for the customer.
"""
import json
import logging

logger = logging.getLogger(__name__)

CODE = 'ORDER_REFUSED'
REASONS = ('no_drink', 'no_milk', 'no_bean', 'no_sweetener', 'stock', '86', 'other')


def note_refusal(db, channel, reason, item='', drink='', milk='', message=''):
    """Record one refusal. Commits on its own; rolls back on failure so the
    shared connection is never left aborted."""
    try:
        payload = {
            'channel': str(channel or 'unknown')[:20],
            'reason': reason if reason in REASONS else 'other',
            'item': str(item or '')[:80],
            'drink': str(drink or '')[:80],
            'milk': str(milk or '')[:40],
            'message': str(message or '')[:200],
        }
        cur = db.cursor()
        cur.execute(
            "INSERT INTO client_events (code, payload, url, user_id, user_agent) "
            "VALUES (%s, %s::jsonb, %s, %s, %s)",
            (CODE, json.dumps(payload), None, None, f'server:{payload["channel"]}'),
        )
        db.commit()
    except Exception as e:
        logger.warning(f"could not record a refusal ({reason} {item}): {e}")
        try:
            db.rollback()
        except Exception:
            pass


def summary(cur, d0, d1, limit=12):
    """Refusals in a window, grouped by reason and item, biggest first, plus
    a total and a by-channel split. Shape for the report."""
    out = {'total': 0, 'items': [], 'by_channel': {}}
    try:
        cur.execute(
            "SELECT payload->>'reason', COALESCE(NULLIF(payload->>'item', ''), payload->>'drink', '?'), "
            "       payload->>'channel', COUNT(*) "
            "FROM client_events WHERE code = %s AND occurred_at >= %s AND occurred_at < %s "
            "GROUP BY 1, 2, 3 ORDER BY 4 DESC",
            (CODE, d0, d1))
        grouped = {}
        for r in cur.fetchall():
            reason, item, channel, n = (r[0], r[1], r[2], int(r[3])) if not isinstance(r, dict) else (
                list(r.values())[0], list(r.values())[1], list(r.values())[2], int(list(r.values())[3]))
            key = (reason or 'other', item or '?')
            grouped[key] = grouped.get(key, 0) + n
            out['by_channel'][channel or 'unknown'] = out['by_channel'].get(channel or 'unknown', 0) + n
            out['total'] += n
        out['items'] = [{'reason': k[0], 'item': k[1], 'count': v}
                        for k, v in sorted(grouped.items(), key=lambda kv: -kv[1])[:limit]]
    except Exception as e:
        logger.warning(f"refusal summary failed: {e}")
    return out


LABELS = {
    'no_drink': 'not on the menu today',
    'no_milk': 'milk not offered',
    'no_bean': 'bean not offered',
    'no_sweetener': 'sweetener not offered',
    'stock': 'ran out',
    '86': 'barista marked unavailable',
    'other': 'refused',
}
