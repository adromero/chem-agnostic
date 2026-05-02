"""Auto-scaffolded port. Adapters in this compound implement this protocol."""
from typing import Protocol

from .. import RouteSpec


class RouteRegistry(Protocol):
    def describe(self) -> str: ...
