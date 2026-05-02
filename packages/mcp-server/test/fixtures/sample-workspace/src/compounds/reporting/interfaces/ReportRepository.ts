// stub ReportRepository interface
import type { ReportId } from "../elements/ReportId.ts";
export interface ReportRepository {
  save(id: ReportId): Promise<void>;
}
