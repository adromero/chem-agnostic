"""Auto-scaffolded reaction (use case workflow)."""
from typing import Any

from .. import AuthToken, TokenVerifier


async def verify_request(input: Any) -> dict[str, Any]:
    _ = input
    return {"ok": True, "reaction": "verify_request"}
