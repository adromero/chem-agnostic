"""Auto-scaffolded port. Adapters in this compound implement this protocol."""
from typing import Protocol

from ..public import Record, RecordId


class Repository(Protocol):
    def describe(self) -> str: ...
