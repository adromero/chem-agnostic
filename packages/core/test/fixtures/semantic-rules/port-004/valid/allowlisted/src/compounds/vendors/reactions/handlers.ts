import { Money } from "../adapters/Money";

export function priceOf(): Money {
  return new Money(100);
}
