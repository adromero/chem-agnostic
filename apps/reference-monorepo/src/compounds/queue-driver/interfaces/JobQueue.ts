// Auto-scaffolded port. Adapters in this compound implement this contract.
import type { JobId, JobName } from "../public.js";
export interface JobQueue {
  describe(): string;
  readonly _jobid?: JobId;
  readonly _jobname?: JobName;
}
