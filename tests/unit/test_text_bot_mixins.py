"""The text bot's methods split into services/coffee/ (roadmap X7-11) are all
inherited, and none hides another.

CoffeeOrderSystem inherits one mixin per file. A file not on its list
would add nothing; a method defined in two places would make which one
runs depend on the order of the list, which nobody would expect.
"""
import inspect
from pathlib import Path

from services import coffee_system
from services.coffee_system import CoffeeOrderSystem

COFFEE = Path(coffee_system.__file__).resolve().parent / "coffee"


def _mixins():
    return [k for k in CoffeeOrderSystem.__mro__[1:] if k is not object]


def test_every_file_is_inherited():
    files = {p.stem for p in COFFEE.glob("*.py") if p.stem != "__init__"}
    inherited = {Path(inspect.getfile(k)).stem for k in _mixins()}
    assert files and inherited == files


def test_no_method_is_defined_twice():
    seen = {}
    for k in [CoffeeOrderSystem] + _mixins():
        for name in vars(k):
            if name.startswith("__"):
                continue
            assert name not in seen, f"{name} is in both {seen[name]} and {k.__name__}"
            seen[name] = k.__name__


def test_mixins_are_plain():
    # No state or setup of their own: the class keeps __init__ and constants.
    for k in _mixins():
        assert k.__bases__ == (object,), k.__name__
        assert "__init__" not in vars(k), k.__name__
