"""The EventsAir VIP rule: who counts, and what happens to them."""
import os
import sys

sys.path.insert(0, os.path.abspath(os.path.join(os.path.dirname(__file__), "..", "..")))

from services.vip_rule import (  # noqa: E402
    DEFAULT_RULE, allowed_stations, attendee_signals, match, read_rule, resolve,
)


class TestReadRule:
    def test_missing_is_no_rule(self):
        assert read_rule(None) == DEFAULT_RULE
        assert read_rule("") == DEFAULT_RULE
        assert read_rule("not json") == DEFAULT_RULE

    def test_markers_from_a_comma_string_or_a_list(self):
        assert read_rule({"markers": "Speaker, VIP ,, "})["markers"] == ["Speaker", "VIP"]
        assert read_rule('{"markers": ["a", " b "]}')["markers"] == ["a", "b"]

    def test_station_and_vip_only_are_ints(self):
        r = read_rule({"station_id": "3", "vip_only_stations": ["3", 1, "x"]})
        assert r["station_id"] == 3
        assert r["vip_only_stations"] == [1, 3]
        assert read_rule({"station_id": 0})["station_id"] is None


class TestMatch:
    SPEAKER = {"registration_category": "Speaker", "tags": ["Keynote"],
               "custom_fields": {"VIP": "Yes"}, "udf": {"udf1": "Gold"}}

    def test_category_case_insensitive(self):
        assert match(read_rule({"markers": ["speaker"]}), self.SPEAKER) == "speaker"

    def test_tag(self):
        assert match(read_rule({"markers": ["Keynote"]}), self.SPEAKER) == "Keynote"

    def test_custom_field_value_and_name_value(self):
        assert match(read_rule({"markers": ["yes"]}), self.SPEAKER) == "yes"
        assert match(read_rule({"markers": ["vip=yes"]}), self.SPEAKER) == "vip=yes"
        assert match(read_rule({"markers": ["vip=no"]}), self.SPEAKER) == ""

    def test_user_defined_field(self):
        assert match(read_rule({"markers": ["Gold"]}), self.SPEAKER) == "Gold"

    def test_delegate_does_not_match(self):
        delegate = {"registration_category": "Delegate", "tags": [], "custom_fields": None, "udf": None}
        assert match(read_rule({"markers": ["Speaker", "VIP"]}), delegate) == ""

    def test_no_markers_matches_nobody(self):
        assert match(read_rule({}), self.SPEAKER) == ""

    def test_custom_fields_as_ea_list_shape(self):
        row = {"custom_fields": [{"name": "Access", "value": "VIP Lounge"}]}
        plain, named = attendee_signals(row)
        assert "vip lounge" in plain and "access=vip lounge" in named


class _Cur:
    """A cursor that answers the two queries resolve() makes."""
    def __init__(self, rule_json, row):
        self.rule_json, self.row, self.description = rule_json, row, None
        self._next = None

    def execute(self, sql, params=None):
        if "FROM settings" in sql:
            self._next = (self.rule_json,) if self.rule_json is not None else None
            self.description = [("value",)]
        else:
            self._next = self.row
            self.description = [(c,) for c in ("ea_contact_id", "first_name", "registration_category",
                                                "tags", "custom_fields", "udf")]

    def fetchone(self):
        return self._next


class TestResolve:
    ROW = ("c1", "Ada", "Speaker", None, None, None)

    def test_speaker_jumps_the_queue_and_goes_to_the_station(self):
        cur = _Cur('{"markers": ["Speaker"], "station_id": 3}', self.ROW)
        hit = resolve(cur, ea_contact_id="c1")
        assert hit["vip"] and hit["reason"] == "Speaker" and hit["station_id"] == 3

    def test_station_only_rule_routes_without_priority(self):
        cur = _Cur('{"markers": ["Speaker"], "jump_queue": false, "station_id": 3}', self.ROW)
        hit = resolve(cur, ea_contact_id="c1")
        assert hit["vip"] and hit["jump_queue"] is False and hit["station_id"] == 3

    def test_unknown_person_is_not_a_vip(self):
        cur = _Cur('{"markers": ["Speaker"]}', None)
        assert resolve(cur, phone="+61400000000")["vip"] is False

    def test_no_rule_is_never_a_vip(self):
        cur = _Cur(None, self.ROW)
        assert resolve(cur, ea_contact_id="c1")["vip"] is False

    def test_nothing_known_about_the_person(self):
        cur = _Cur('{"markers": ["Speaker"]}', self.ROW)
        assert resolve(cur)["vip"] is False

    def test_a_broken_cursor_never_blocks_an_order(self):
        class Boom:
            def execute(self, *a): raise RuntimeError("db gone")
        assert resolve(Boom(), phone="+61400000000") == {"vip": False, "reason": "", "station_id": None}


class TestAllowedStations:
    def test_non_vip_never_sees_a_vip_only_station(self):
        cur = _Cur('{"markers": ["Speaker"], "vip_only_stations": [3]}', None)
        assert allowed_stations(cur, [1, 2, 3], is_vip=False) == [1, 2]

    def test_vip_sees_everything(self):
        cur = _Cur('{"markers": ["Speaker"], "vip_only_stations": [3]}', None)
        assert allowed_stations(cur, [1, 2, 3], is_vip=True) == [1, 2, 3]

    def test_filter_stands_down_rather_than_leave_nowhere(self):
        cur = _Cur('{"markers": ["Speaker"], "vip_only_stations": [3]}', None)
        assert allowed_stations(cur, [3], is_vip=False) == [3]
