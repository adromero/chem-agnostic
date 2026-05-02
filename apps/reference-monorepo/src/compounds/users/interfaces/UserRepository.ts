// Auto-scaffolded port. Adapters in this compound implement this contract.
import type { User, UserId } from "../public.js";
export interface UserRepository {
  describe(): string;
  readonly _user?: User;
  readonly _userid?: UserId;
}
