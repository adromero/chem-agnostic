// stub UserRepository interface
import type { UserId } from "../elements/UserId.ts";
export interface UserRepository {
  findById(id: UserId): Promise<unknown>;
}
