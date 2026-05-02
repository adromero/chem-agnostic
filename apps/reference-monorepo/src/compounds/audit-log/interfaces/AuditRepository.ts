// Auto-scaffolded port. Adapters in this compound implement this contract.
import type { AuditEntry } from "../public.js";
export interface AuditRepository {
  describe(): string;
  readonly _auditentry?: AuditEntry;
}
