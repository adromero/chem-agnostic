// stub StripeGateway adapter
import type { PaymentGateway } from "../interfaces/PaymentGateway.ts";
import type { Money } from "../elements/Money.ts";
export class StripeGateway implements PaymentGateway {
  async charge(_amount: Money, _customerId: string): Promise<string> {
    return "stub";
  }
}
