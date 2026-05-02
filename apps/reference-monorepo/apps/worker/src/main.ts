// Worker entrypoint. Wires the queue-driver, runner registry, retry policy,
// metrics, audit emission, and lifecycle compounds. The actual job
// implementations live as `reactions` inside their respective compounds —
// this file is just the composition root.

import { startWorker } from "../../../src/compounds/lifecycle/public.js";
import { runJob } from "../../../src/compounds/job-runners/public.js";

async function main(): Promise<void> {
  // The reference repo ships these as scaffolded stubs, but a real worker
  // would compose them like this:
  //
  //   await connectQueue();
  //   const registry = createRunnerRegistry();
  //   await startWorker({ phase: "starting", probes: [...] });
  //   await runJob({ id: "...", name: "send-email", registry });
  //
  // We skip actual execution in the demo. The intent is to demonstrate the
  // chemag-validated import wiring.
  void startWorker;
  void runJob;
}

main().catch((err) => {
  process.stderr.write(`worker failed: ${String(err)}\n`);
  process.exitCode = 1;
});
