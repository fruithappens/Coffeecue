"""'Ready about 10:42' on the phone page (24 Nov 2026): the estimate for an
order already in the queue, and no estimate without real make-times."""
import services.coffee_system  # noqa: F401  (loads the mixins in order)
from services.coffee.wait_times import WaitTimesMixin


class Fake(WaitTimesMixin):
    def __init__(self, per=2.0, position=3, lanes=1, declared=None):
        self.per, self.position, self.lanes, self.declared = per, position, lanes, declared

    def _get_recent_completion_avg_minutes(self, station_id, *a, **k):
        return self.per

    def _get_station_declared_throughput(self, station_id):
        return self.declared

    def _get_queue_position(self, station_id, order_number):
        return self.position

    def _get_station_capacity(self, station_id):
        return self.lanes


def test_third_in_line_one_lane():
    assert Fake(per=2, position=3)._estimate_ready_minutes(1, "5", "pending") == 6


def test_two_lanes_halve_the_queue_ahead():
    assert Fake(per=2, position=5, lanes=2)._estimate_ready_minutes(1, "5", "pending") == 6


def test_being_made_is_about_one_drink():
    assert Fake(per=3, position=9)._estimate_ready_minutes(1, "5", "in-progress") == 3


def test_declared_throughput_when_no_history():
    assert Fake(per=None, position=2, declared=60)._estimate_ready_minutes(1, "5", "pending") == 2


def test_no_data_no_time():
    assert Fake(per=None, declared=None)._estimate_ready_minutes(1, "5", "pending") is None
    assert Fake(position=None)._estimate_ready_minutes(1, "5", "pending") is None
