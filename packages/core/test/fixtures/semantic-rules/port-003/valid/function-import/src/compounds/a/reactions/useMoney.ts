import { formatMoney } from "../../b/public";

export function useMoney(): string {
  return formatMoney(42);
}
