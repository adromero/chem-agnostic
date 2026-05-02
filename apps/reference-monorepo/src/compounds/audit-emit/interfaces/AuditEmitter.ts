// Auto-scaffolded port. Adapters in this compound implement this contract.
import type { AuditEvent } from "../public.js";
export interface AuditEmitter {
  describe(): string;
  readonly _auditevent?: AuditEvent;
}
