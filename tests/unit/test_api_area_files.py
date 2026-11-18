"""The /api endpoints split into routes/api/ (roadmap X7-11) all register.

consolidated_api_routes.py loads each area file by name at its end. A file
added to routes/api/ but not to that list would register nothing, and its
addresses would quietly 404.
"""
import ast
from pathlib import Path

ROUTES = Path(__file__).resolve().parents[2] / "routes"


def _loaded_areas():
    tree = ast.parse((ROUTES / "consolidated_api_routes.py").read_text())
    for node in tree.body:
        if isinstance(node, ast.For) and getattr(node.target, "id", "") == "_area":
            return {e.value for e in node.iter.elts}
    return set()


def test_every_area_file_is_loaded():
    files = {p.stem for p in (ROUTES / "api").glob("*.py") if p.stem != "__init__"}
    assert files, "routes/api/ is empty"
    assert _loaded_areas() == files


def test_area_files_register_on_the_one_blueprint():
    # Same blueprint = same endpoint names as before the split.
    for p in (ROUTES / "api").glob("*.py"):
        src = p.read_text()
        if p.stem == "__init__":
            continue
        assert "Blueprint(" not in src, f"{p.name} makes its own blueprint"
        assert "from routes.consolidated_api_routes import" in src, p.name
