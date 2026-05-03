"""InvoiceId — value object."""

from dataclasses import dataclass


@dataclass(frozen=True)
class InvoiceId:
    value: str
