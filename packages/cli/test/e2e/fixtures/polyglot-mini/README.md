## polyglot-mini — multi-language E2E fixture (WP-022)

A four-sub-tree workspace used by `multi-language.test.ts` to exercise
the full chemag command surface against three languages simultaneously.

### Sub-trees

| id           | language   | path                              |
|--------------|------------|-----------------------------------|
| `web`        | typescript | `apps/web/src/compounds`          |
| `web-shared` | typescript | `apps/web-shared/src/compounds`   |
| `api`        | python     | `apps/api/src/compounds`          |
| `worker`     | go         | `apps/worker/src/compounds`       |

The fixture has THREE distinct LANGUAGES (TS / Python / Go) per the
WP-022 spec. The fourth sub-tree (`web-shared`, also TypeScript) exists
for one specific reason: the `CHEM-IMPORT-CROSS-LANG-001` diagnostic
fires when a source file's `plugin.resolveModulePath` returns an absolute
path that the global file index identifies as living in another sub-tree
— in practice this means the cross-sub-tree import has to be resolvable
by the source plugin's own resolver. Cross-language resolution (a `.ts`
file resolving into a `.py` file) does not occur with the real plugins;
only same-language cross-sub-tree resolution does. So we add a second TS
sub-tree to provide a realistic cross-sub-tree import target.

### Intentional violation

The reaction `CreateOrder` in compound `orders` (sub-tree `web`) imports
from a unit inside compound `admin` (sub-tree `web-shared`):

```ts
// apps/web/src/compounds/orders/reactions/CreateOrder.ts
import { AdminId } from "../../../../../web-shared/src/compounds/admin/elements/AdminId";
```

This triggers `CHEM-IMPORT-CROSS-LANG-001` at `chemag check` /
`chemag analyze` time, with `language_id = "web"`. The companion test
asserts the diagnostic fires and is tagged with the source sub-tree id.

### Compounds

| sub-tree   | compound | units                                               |
|------------|----------|-----------------------------------------------------|
| web        | orders   | element OrderId, interface OrderRepo, reaction CreateOrder |
| web-shared | admin    | element AdminId                                     |
| api        | billing  | element InvoiceId, interface InvoiceRepo, reaction GenerateInvoice |
| worker     | jobs     | element JobId, reaction RunJob                      |

Total file count is well under the 30-file budget.
