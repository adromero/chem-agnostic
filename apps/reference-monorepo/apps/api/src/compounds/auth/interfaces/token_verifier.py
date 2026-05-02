"""Auto-scaffolded port. Adapters in this compound implement this protocol."""
from typing import Protocol

from ..public import AuthToken, Principal


class TokenVerifier(Protocol):
    def describe(self) -> str: ...
