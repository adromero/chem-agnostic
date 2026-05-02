// stub PaymentGateway interface
import type { Money } from "../elements/Money.ts";
export interface PaymentGateway {
  charge(amount: Money, customerId: string): Promise<string>;
}
