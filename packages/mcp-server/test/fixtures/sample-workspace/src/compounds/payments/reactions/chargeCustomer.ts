// stub chargeCustomer reaction
import type { Money } from "../elements/Money.ts";
import type { PaymentGateway } from "../interfaces/PaymentGateway.ts";
export async function chargeCustomer(
  amount: Money,
  customerId: string,
  gateway: PaymentGateway,
): Promise<string> {
  return gateway.charge(amount, customerId);
}
