"""Auto-scaffolded port. Adapters in this compound implement this protocol."""
from typing import Protocol

from ..public import TraceId


class Logger(Protocol):
    def describe(self) -> str: ...
