"""Auto-scaffolded reaction (use case workflow)."""
from typing import Any

from ..public import TaskSpec, Scheduler


async def schedule_task(input: Any) -> dict[str, Any]:
    _ = input
    return {"ok": True, "reaction": "schedule_task"}
