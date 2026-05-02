"""Auto-scaffolded port. Adapters in this compound implement this protocol."""
from typing import Protocol

from ..public import IntegrationKey


class IntegrationClient(Protocol):
    def describe(self) -> str: ...
