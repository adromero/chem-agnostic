// Auto-scaffolded port. Adapters in this compound implement this contract.
import type { SupportTicket, TicketId } from "../public.js";
export interface TicketRepository {
  describe(): string;
  readonly _supportticket?: SupportTicket;
  readonly _ticketid?: TicketId;
}
