"""Auto-scaffolded port. Adapters in this compound implement this protocol."""
from typing import Protocol

from ..public import AppSettings


class SettingsLoader(Protocol):
    def describe(self) -> str: ...
