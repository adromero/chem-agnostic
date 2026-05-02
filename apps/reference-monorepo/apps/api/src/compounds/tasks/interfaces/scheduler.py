"""Auto-scaffolded port. Adapters in this compound implement this protocol."""
from typing import Protocol

from ..public import TaskSpec


class Scheduler(Protocol):
    def describe(self) -> str: ...
