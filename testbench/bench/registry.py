"""
Suite registry — the single import point for runners/UIs.

Aggregates the base suites, the deep business-logic suites, and the scenario
matrix. Kept separate so the suite modules can share helpers (suites.py is
the common dependency) without circular imports.
"""
from .suites import BASE_SUITES, CATALOG                # noqa: F401
from .suites_deep import DEEP_SUITES
from .suites_matrix import MATRIX_SUITES
from .suites_journeys import JOURNEY_SUITES
from .suites_coverage import COVERAGE_SUITES
from .suites_lifecycle import LIFECYCLE_SUITES
from .suites_customer import CUSTOMER_SUITES
from .suites_stress import STRESS_SUITES
from .suites_pipeline import PIPELINE_SUITES
from .suites_print import PRINT_SUITES
from .suites_ea import EA_SUITES

ALL_SUITES = (BASE_SUITES + DEEP_SUITES + MATRIX_SUITES
              + JOURNEY_SUITES + COVERAGE_SUITES + LIFECYCLE_SUITES
              + CUSTOMER_SUITES + STRESS_SUITES + PIPELINE_SUITES
              + PRINT_SUITES + EA_SUITES)
