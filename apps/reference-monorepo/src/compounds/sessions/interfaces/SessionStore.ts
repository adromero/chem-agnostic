// Auto-scaffolded port. Adapters in this compound implement this contract.
import type { Session, SessionId } from "../public.js";
export interface SessionStore {
  describe(): string;
  readonly _session?: Session;
  readonly _sessionid?: SessionId;
}
