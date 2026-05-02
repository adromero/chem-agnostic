"""Smoke tests proving the chemag Python plugin can import every compound."""
import importlib

COMPOUNDS = [
    "settings",
    "errors",
    "auth",
    "observability",
    "repositories",
    "services",
    "routers",
    "integrations",
    "tasks",
    "healthcheck",
]


def test_every_compound_imports_cleanly() -> None:
    for name in COMPOUNDS:
        module = importlib.import_module(f"src.compounds.{name}")
        assert module is not None


def test_main_app_factory() -> None:
    from src.main import create_app

    app = create_app()
    assert app.title == "chemag reference api"
