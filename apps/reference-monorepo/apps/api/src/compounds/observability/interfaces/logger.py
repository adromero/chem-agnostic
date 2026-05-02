"""Auto-scaffolded port. Adapters in this compound implement this protocol."""
from typing import Protocol

from .. import TraceId


class Logger(Protocol):
    def describe(self) -> str: ...
