// Auto-scaffolded port. Adapters in this compound implement this contract.
import type { Subscription, Invoice } from "../public.js";
export interface BillingRepository {
  describe(): string;
  readonly _subscription?: Subscription;
  readonly _invoice?: Invoice;
}
