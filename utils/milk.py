"""Milk names that mean "no milk at all".

Milk names are compared shortened ("oat milk" -> "oat"), and shortened the
same way "no milk" becomes "no". Every check that asks "can this station
make this milk?" must treat all of these as black: a black coffee needs no
milk, so any station can make it.
"""

BLACK_MILKS = frozenset({"", "no", "no milk", "none", "black"})
