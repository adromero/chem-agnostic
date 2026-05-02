"""Auto-scaffolded port. Adapters in this compound implement this protocol."""
from typing import Protocol

from .. import ProbeResult


class Probe(Protocol):
    def describe(self) -> str: ...
