"""Auto-scaffolded reaction (use case workflow)."""
from typing import Any

from .. import RouteSpec, RouteRegistry
from ...services import ServiceBus
from ...auth import Principal


async def mount_routes(input: Any) -> dict[str, Any]:
    _ = input
    return {"ok": True, "reaction": "mount_routes"}
