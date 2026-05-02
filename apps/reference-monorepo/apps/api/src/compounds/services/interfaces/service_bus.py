"""Auto-scaffolded port. Adapters in this compound implement this protocol."""
from typing import Protocol

from ..public import ServiceResult


class ServiceBus(Protocol):
    def describe(self) -> str: ...
