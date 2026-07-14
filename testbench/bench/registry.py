"""
Suite registry — the single import point for runners/UIs.

Aggregates the base suites, the deep business-logic suites, and the scenario
matrix. Kept separate so the suite modules can share helpers (suites.py is
the common dependency) without circular imports.
"""
from .suites import BASE_SUITES, CATALOG                # noqa: F401
from .suites_deep import DEEP_SUITES
from .suites_matrix import MATRIX_SUITES

ALL_SUITES = BASE_SUITES + DEEP_SUITES + MATRIX_SUITES
