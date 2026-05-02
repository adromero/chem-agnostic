"""Auto-scaffolded port. Adapters in this compound implement this protocol."""
from typing import Protocol

from .. import IntegrationKey


class IntegrationClient(Protocol):
    def describe(self) -> str: ...
