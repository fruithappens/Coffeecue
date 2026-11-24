"""Queue position and wait-time estimates.

Methods of CoffeeOrderSystem, moved here unchanged from
services/coffee_system.py (roadmap X7-11). CoffeeOrderSystem inherits
WaitTimesMixin, so self.<method>() reaches them exactly as before.
"""
import json
import sqlite3
from services.coffee_system import (  # noqa: F401  (defined above the mixin imports)
    logger,
)


class WaitTimesMixin:
    def _get_queue_position(self, station_id, order_number):
        """Return this order's 1-based position in the station queue.

        Counts non-completed, non-cancelled orders at the same station that
        were created at or before the given order. Used to tell the
        customer "you're #3 in line" in their confirmation SMS so they
        don't think the bot just dropped their order into the void.

        Returns None if the order isn't found yet (race) or on error -
        the caller treats None as "skip the position line".
        """
        try:
            is_sqlite = isinstance(self.db, sqlite3.Connection)
            cursor = self.db.cursor()
            placeholder = "?" if is_sqlite else "%s"
            cursor.execute(
                f"""
                SELECT COUNT(*)
                FROM orders
                WHERE station_id = {placeholder}
                  AND status IN ('pending', 'in-progress')
                  AND created_at <= (
                      SELECT created_at FROM orders WHERE order_number = {placeholder}
                  )
                """,
                (station_id, order_number),
            )
            row = cursor.fetchone()
            if not row:
                return None
            count = row[0] if not isinstance(row, dict) else list(row.values())[0]
            return int(count) if count is not None else None
        except Exception as e:
            logger.error(f"Error computing queue position: {str(e)}")
            return None

    def _get_recent_completion_avg_minutes(
        self, station_id, window_minutes=60, sample_size=20
    ):
        """Compute a moving-average prep time from real recent orders.

        Looks at orders completed at this station within the last
        `window_minutes`, takes up to `sample_size` of them, and
        averages the delta from created_at → updated_at. Returns None
        if there's not enough data (caller falls back to a heuristic).

        Used by _get_station_wait_time() — gives a much more honest
        "your drink in ~7 min" estimate than the static 10-minute
        default that was previously displayed.
        """
        try:
            cursor = self.db.cursor()
            cursor.execute(
                """
                SELECT EXTRACT(EPOCH FROM (COALESCE(completed_at, updated_at) - started_at)) / 60.0 AS minutes
                FROM orders
                WHERE station_id = %s
                  AND status IN ('completed', 'picked_up')
                  AND updated_at >= NOW() - (%s || ' minutes')::interval
                  AND started_at IS NOT NULL
                  -- MAKE time only (start → complete). The old metric was
                  -- created → updated: the order's WHOLE LIFETIME including
                  -- however long it sat in the queue, so a backlog that
                  -- cleared poisoned the average for the next hour (Steve:
                  -- empty station claiming a 10-minute walk-up wait).
                  -- Discard outliers: sub-10s ghosts and >15 min = the
                  -- barista walked away, not a drink's make-time.
                  AND EXTRACT(EPOCH FROM (COALESCE(completed_at, updated_at) - started_at)) BETWEEN 10 AND 900
                ORDER BY updated_at DESC
                LIMIT %s
                """,
                (station_id, str(window_minutes), sample_size),
            )
            rows = cursor.fetchall()
            if not rows:
                return None
            # Clamp individual samples to [0.5, 30] min so a single
            # outlier (e.g. an order someone left to ferment in
            # "in-progress" for hours) doesn't poison the average.
            samples = []
            for row in rows:
                v = row[0] if not isinstance(row, dict) else list(row.values())[0]
                try:
                    m = float(v)
                except (TypeError, ValueError):
                    continue
                if 0.5 <= m <= 30:
                    samples.append(m)
            if not samples:
                return None
            return sum(samples) / len(samples)
        except Exception as e:
            logger.warning(f"_get_recent_completion_avg_minutes failed: {e}")
            try:
                self.db.rollback()
            except Exception:
                pass
            return None

    def _get_station_pending_count(self, station_id):
        """How many orders are queued/in-progress at this station right now."""
        try:
            cursor = self.db.cursor()
            cursor.execute(
                "SELECT COUNT(*) FROM orders "
                "WHERE station_id = %s AND status IN ('pending', 'in-progress')",
                (station_id,),
            )
            row = cursor.fetchone()
            return int(row[0]) if row else 0
        except Exception:
            try:
                self.db.rollback()
            except Exception:
                pass
            return 0

    def _get_station_capacity(self, station_id):
        """How many drinks this station can make at once - its parallelism,
        a proxy for steam wands / group heads / number of baristas. Stored in
        station_stats.capabilities JSON as 'concurrent'. Defaults to 1 (serial)
        so the estimate stays conservative until an operator configures it.

        NOTE: deliberately does NOT fall back to capabilities.capacity — that
        field is the MAX QUEUE size (default 10), a different concept; using it
        as the divisor would make every wait ~10× too short."""
        try:
            cursor = self.db.cursor()
            cursor.execute(
                "SELECT capabilities FROM station_stats WHERE station_id = %s",
                (station_id,),
            )
            row = cursor.fetchone()
            caps = row[0] if row else None
            if isinstance(caps, str):
                try:
                    caps = json.loads(caps)
                except Exception:
                    caps = {}
            if isinstance(caps, dict):
                c = caps.get("concurrent")
                if c:
                    return max(1, int(c))
        except Exception:
            try:
                self.db.rollback()
            except Exception:
                pass
        return 1

    def _get_station_declared_throughput(self, station_id):
        """The team's self-declared orders/hour for a station, set in station
        capabilities as 'throughput_per_hour' (e.g. 'we can do ~120/hour').
        Returns int orders/hour, or None if not set."""
        try:
            cursor = self.db.cursor()
            cursor.execute(
                "SELECT capabilities FROM station_stats WHERE station_id = %s",
                (station_id,),
            )
            row = cursor.fetchone()
            caps = row[0] if row else None
            if isinstance(caps, str):
                try:
                    caps = json.loads(caps)
                except Exception:
                    caps = {}
            if isinstance(caps, dict):
                t = caps.get("throughput_per_hour") or caps.get("throughput")
                if t:
                    return max(1, int(float(t)))
        except Exception:
            try:
                self.db.rollback()
            except Exception:
                pass
        return None

    def _estimate_wait_from_throughput(self, station_id):
        """Fallback estimate from the team's DECLARED orders/hour - useful
        before any drinks have completed (no real data yet). A new order is
        #(queue+1) in line; at `rate` per hour that's this many minutes."""
        rate = self._get_station_declared_throughput(station_id)
        if not rate or rate <= 0:
            return None
        queue = self._get_station_pending_count(station_id)  # pending + in-progress
        est = ((queue + 1) / float(rate)) * 60.0
        return max(1, min(int(round(est)), 60))

    def _get_per_drink_avgs(self, station_id, window_minutes=120):
        """Recent average make-time per drink type at this station, from real
        completions. Returns {drink_lower: minutes}; empty if no data."""
        out = {}
        try:
            cursor = self.db.cursor()
            cursor.execute(
                """
                SELECT LOWER(order_details->>'type') AS drink,
                       AVG(EXTRACT(EPOCH FROM (COALESCE(completed_at, updated_at) - started_at)) / 60.0) AS m
                FROM orders
                WHERE station_id = %s
                  AND started_at IS NOT NULL
                  AND EXTRACT(EPOCH FROM (COALESCE(completed_at, updated_at) - started_at)) BETWEEN 10 AND 900
                  AND status IN ('completed', 'picked_up')
                  AND updated_at >= NOW() - (%s || ' minutes')::interval
                  AND created_at IS NOT NULL AND updated_at IS NOT NULL
                  AND order_details ? 'type'
                GROUP BY drink
                """,
                (station_id, str(window_minutes)),
            )
            for row in cursor.fetchall():
                if row[0] and row[1] is not None:
                    out[row[0]] = float(row[1])
        except Exception:
            try:
                self.db.rollback()
            except Exception:
                pass
        return out

    def _get_queue_drinks(self, station_id):
        """Drink types of orders currently pending/in-progress at the station.

        RECENT ONLY (last 8 hours): a crashed flow can strand an order in
        pending/in-progress forever, and without this window those ghosts
        inflated queue counts and wait estimates for days (Steve's S2-pill
        report: header said Q5 while the real queue was 2)."""
        out = []
        try:
            cursor = self.db.cursor()
            cursor.execute(
                "SELECT LOWER(order_details->>'type') FROM orders "
                "WHERE station_id = %s AND status IN ('pending', 'in-progress', 'in_progress') "
                "AND created_at > NOW() - INTERVAL '8 hours'",
                (station_id,),
            )
            for row in cursor.fetchall():
                out.append(row[0] or "")
        except Exception:
            try:
                self.db.rollback()
            except Exception:
                pass
        return out

    def _estimate_wait_from_queue(self, station_id):
        """Smart wait estimate for a NEW order: real per-drink make-times × the
        actual current queue (pending + in-progress), divided by the station's
        concurrent capacity, plus one drink's own make-time. Returns int minutes
        or None when there's not enough recent data (caller falls back)."""
        overall = self._get_recent_completion_avg_minutes(station_id)
        if overall is None:
            return None
        per_drink = self._get_per_drink_avgs(station_id)
        queue = self._get_queue_drinks(station_id)
        capacity = self._get_station_capacity(station_id)
        # Total queued work = sum of each waiting drink's expected make-time
        # (fall back to the station overall avg for drinks with no history).
        work_ahead = sum(per_drink.get(d, overall) for d in queue)
        # A new order waits for the queue ahead to clear across `capacity`
        # parallel lanes, then takes ~one drink's time itself.
        est = (work_ahead / max(1, capacity)) + overall
        return max(1, min(int(round(est)), 60))

    def _estimate_ready_minutes(self, station_id, order_number, status="pending"):
        """Minutes until THIS order is likely ready, or None.

        For the customer's phone page ("Ready about 10:42"). The estimates
        above are for a NEW order joining the back of the queue; this one
        is for an order already in it: the drinks ahead of it across the
        station's lanes, plus its own make-time. An order already being
        made needs about one drink's time. None without real or declared
        make-times -- better no time than a made-up one.
        """
        per = self._get_recent_completion_avg_minutes(station_id)
        if per is None:
            rate = self._get_station_declared_throughput(station_id)
            per = (60.0 / rate) if rate else None
        if per is None:
            return None
        if status in ("in-progress", "in_progress"):
            return max(1, min(int(round(per)), 15))
        position = self._get_queue_position(station_id, order_number)
        if not position:
            return None
        lanes = max(1, int(self._get_station_capacity(station_id) or 1))
        est = ((position - 1) / lanes) * per + per
        return max(1, min(int(round(est)), 60))

    def _get_station_wait_time(self, station_id):
        """Get estimated wait time for a station.

        Updated May 2026: now uses a moving-average prep time
        (last hour, up to 20 orders) × queue depth to produce a
        realistic "your drink should be ready in ~X minutes" number,
        rather than the static 10-minute default that was previously
        shown to every customer.

        Order of precedence:
          1. Moving average × queue depth (best — real data)
          2. station_stats.avg_completion_time × current_load (legacy)
          3. station_stats.wait_time (operator override)
          4. waitTime from `stations` table (older schema)
          5. Static fallback (10 min)
        """
        try:
            # 0. EMPTY queue = "walk up now, wait one drink's worth" — the
            # recent per-station average if we have one, else ~2 minutes.
            # Without this, an empty station fell through to the operator
            # override / static default and told walk-ups 5-10 minutes for
            # a coffee nobody is ahead of (Steve's report: 'starts at 5 min
            # with no orders in the queue').
            queue_now = self._get_queue_drinks(station_id)
            if not queue_now:
                # Empty queue = one drink's MAKE time, hard-capped at 5:
                # whatever history says, an empty station can never honestly
                # tell a walk-up more than a few minutes.
                overall = self._get_recent_completion_avg_minutes(station_id)
                return max(1, min(int(round(overall)), 5)) if overall else 2

            # 1. Best signal: per-drink make-times × the real queue (pending +
            # in-progress), divided by the station's concurrent capacity. One
            # source of truth for the barista header AND the SMS estimate.
            est = self._estimate_wait_from_queue(station_id)
            if est is not None:
                return est

            # 1b. No real completion data yet → use the team's DECLARED
            # throughput (orders/hour, set in station capabilities) if any.
            # Gives a sensible estimate from the very first order, before the
            # per-drink history exists.
            est = self._estimate_wait_from_throughput(station_id)
            if est is not None:
                return est

            # 1c. Queue is BUSY but we have neither completion history nor a
            # declared throughput: scale by queue depth at ~2 min/drink
            # rather than falling through to a static number that ignores
            # the queue entirely (Steve's report: 'when there is a lot of
            # orders then it does not go up').
            capacity = self._get_station_capacity(station_id)
            est = (len(queue_now) * 2.0) / max(1, capacity) + 2
            return max(1, min(int(round(est)), 60))
            db_type = (
                "sqlite" if isinstance(self.db, sqlite3.Connection) else "postgres"
            )
            cursor = self.db.cursor()

            # First check if the station_stats table exists
            if db_type == "sqlite":
                cursor.execute(
                    """
                    SELECT 1 FROM sqlite_master WHERE type='table' AND name='station_stats'
                """
                )
            else:
                cursor.execute(
                    """
                    SELECT 1 FROM information_schema.tables 
                    WHERE table_schema = 'public' AND table_name = 'station_stats'
                """
                )

            if cursor.fetchone() is None:
                # Table doesn't exist, return default wait time
                logger.info(
                    "station_stats table doesn't exist, using default wait time"
                )
                return 10  # Default wait time

            # Get station wait time
            if db_type == "sqlite":
                cursor.execute(
                    """
                    SELECT current_load, avg_completion_time, wait_time
                    FROM station_stats
                    WHERE station_id = ?
                """,
                    (station_id,),
                )
            else:
                cursor.execute(
                    """
                    SELECT current_load, avg_completion_time, wait_time
                    FROM station_stats
                    WHERE station_id = %s
                """,
                    (station_id,),
                )

            result = cursor.fetchone()

            if not result:
                # No statistics for this station, check if it has a configured wait time in stations table
                try:
                    # Check if the stations table exists
                    if db_type == "sqlite":
                        cursor.execute(
                            """
                            SELECT 1 FROM sqlite_master WHERE type='table' AND name='stations'
                        """
                        )
                    else:
                        cursor.execute(
                            """
                            SELECT 1 FROM information_schema.tables 
                            WHERE table_schema = 'public' AND table_name = 'stations'
                        """
                        )

                    if cursor.fetchone() is not None:
                        # Try to get waitTime from stations table
                        if db_type == "sqlite":
                            cursor.execute(
                                """
                                SELECT waitTime FROM stations WHERE id = ?
                            """,
                                (station_id,),
                            )
                        else:
                            cursor.execute(
                                """
                                SELECT waitTime FROM stations WHERE id = %s
                            """,
                                (station_id,),
                            )

                        wait_time_result = cursor.fetchone()
                        if wait_time_result and wait_time_result[0]:
                            return wait_time_result[0]
                except Exception as e:
                    logger.error(
                        f"Error getting wait time from stations table: {str(e)}"
                    )

                # If we couldn't get a wait time from the stations table either, use default
                return 10  # Default wait time

            current_load, avg_completion_time, wait_time = result

            # If station has set a specific wait time, use that
            if wait_time:
                return wait_time

            # Otherwise calculate based on load and avg completion time
            if avg_completion_time:
                # Calculate wait time in minutes
                calculated_wait = max(1, (current_load * avg_completion_time) // 60)
                return min(calculated_wait, 30)  # Cap at 30 minutes

            # Default fallback
            return max(5, min(current_load * 2, 20))

        except Exception as e:
            logger.error(f"Error getting station wait time: {str(e)}")
            return 10  # Default wait time
