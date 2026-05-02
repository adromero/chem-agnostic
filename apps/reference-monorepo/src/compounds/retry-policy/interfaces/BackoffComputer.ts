// Auto-scaffolded port. Adapters in this compound implement this contract.
import type { RetrySpec } from "../public.js";
export interface BackoffComputer {
  describe(): string;
  readonly _retryspec?: RetrySpec;
}
