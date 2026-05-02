// Auto-scaffolded port. Adapters in this compound implement this contract.
import type { SearchQuery, SearchHit } from "../public.js";
export interface SearchIndex {
  describe(): string;
  readonly _searchquery?: SearchQuery;
  readonly _searchhit?: SearchHit;
}
