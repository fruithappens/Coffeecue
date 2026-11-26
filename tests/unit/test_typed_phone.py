from utils.typed_phone import clean_typed_phone


def test_doubled_number_is_folded():
    assert clean_typed_phone("04001112220400111222") == "0400111222"
    assert clean_typed_phone("0400 111 222 0400 111 222") == "0400111222"


def test_normal_numbers_pass_through():
    assert clean_typed_phone("0400 555 666") == "0400555666"
    assert clean_typed_phone("+64 21 123 4567") == "+64211234567"


def test_unusable_numbers_are_dropped_not_failed():
    assert clean_typed_phone("") == ""
    assert clean_typed_phone("123") == ""
    assert clean_typed_phone("0400555666040055") == ""  # 16 digits, not a double


def test_short_repeats_are_not_folded():
    # 10 digits that happen to repeat a 5-digit block are a real number.
    assert clean_typed_phone("1234512345") == "1234512345"
