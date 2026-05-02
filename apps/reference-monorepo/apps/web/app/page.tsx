// Minimal landing page wired through a few of the chemag compounds. The
// actual production code would compose these reactions into route handlers,
// server components, etc. For the reference monorepo we only need to prove
// that web/ depends on src/compounds/* through their public surfaces.

import { loadDashboard } from "../../../src/compounds/dashboard/public.js";
import { chargeCustomer } from "../../../src/compounds/billing/public.js";

export default async function Page() {
  // We do not actually invoke the reactions in this stub — Next.js' build
  // step would error in a real environment without infrastructure. The
  // reference is to demonstrate the import wiring through public surfaces.
  void loadDashboard;
  void chargeCustomer;

  return (
    <main>
      <h1>chemag reference admin</h1>
      <p>
        This is the canonical demo monorepo for the chemag toolkit. See the
        repository README for the directory tour.
      </p>
    </main>
  );
}
