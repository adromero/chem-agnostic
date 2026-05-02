"""Auto-scaffolded reaction (use case workflow)."""
from typing import Any

from .. import TraceId, Logger


async def with_trace(input: Any) -> dict[str, Any]:
    _ = input
    return {"ok": True, "reaction": "with_trace"}
