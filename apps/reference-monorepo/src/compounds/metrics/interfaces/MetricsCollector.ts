// Auto-scaffolded port. Adapters in this compound implement this contract.
import type { MetricSample } from "../public.js";
export interface MetricsCollector {
  describe(): string;
  readonly _metricsample?: MetricSample;
}
