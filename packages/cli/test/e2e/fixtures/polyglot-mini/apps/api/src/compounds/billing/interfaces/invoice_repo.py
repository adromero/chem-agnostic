"""InvoiceRepo — port contract."""

from abc import ABC, abstractmethod

from ..elements.invoice_id import InvoiceId


class InvoiceRepo(ABC):
    @abstractmethod
    def save(self, invoice_id: InvoiceId) -> None: ...
