"""FastAPI entrypoint that composes routers, services, and repositories."""
from fastapi import FastAPI

from .compounds.routers import RouteSpec, mount_routes
from .compounds.healthcheck import run_health_checks


def create_app() -> FastAPI:
    app = FastAPI(title="chemag reference api", version="0.0.0")

    @app.get("/healthz")
    async def healthz() -> dict[str, object]:
        result = await run_health_checks(None)
        return {"status": "ok", "result": result}

    # The actual route registration would call mount_routes with the
    # adapter-bound RouteRegistry; we keep this stub minimal.
    _ = RouteSpec
    _ = mount_routes
    return app


app = create_app()
