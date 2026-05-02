"""Auto-scaffolded reaction (use case workflow)."""
from typing import Any

from ..public import IntegrationKey, IntegrationClient


async def call_integration(input: Any) -> dict[str, Any]:
    _ = input
    return {"ok": True, "reaction": "call_integration"}
