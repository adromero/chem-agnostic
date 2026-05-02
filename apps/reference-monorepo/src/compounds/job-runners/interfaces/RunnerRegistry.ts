// Auto-scaffolded port. Adapters in this compound implement this contract.
import type { RunnerHandle } from "../public.js";
import type { JobName } from "../../queue-driver/public.js";
export interface RunnerRegistry {
  describe(): string;
  readonly _runnerhandle?: RunnerHandle;
  readonly _jobname?: JobName;
}
