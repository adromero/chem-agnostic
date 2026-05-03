// INTENTIONAL VIOLATION (WP-022 fixture): cross-sub-tree import.
// `web/orders/reactions/CreateOrder.ts` imports a unit that lives in
// the `web-shared` sub-tree. This triggers CHEM-IMPORT-CROSS-LANG-001
// with language_id = "web" at `chemag check` / `chemag analyze` time.
import { AdminId } from "../../../../../web-shared/src/compounds/admin/elements/AdminId";
import { OrderId } from "../elements/OrderId";

export async function CreateOrder(_admin: AdminId): Promise<OrderId> {
  return new OrderId("stub");
}
