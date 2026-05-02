"""Auto-scaffolded reaction (use case workflow)."""
from typing import Any

from ..public import RouteSpec, RouteRegistry, ServiceBus, Principal


async def mount_routes(input: Any) -> dict[str, Any]:
    _ = input
    return {"ok": True, "reaction": "mount_routes"}
