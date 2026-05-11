import { CustomBigNum } from "../../b/public";

export function useBigNum(): CustomBigNum {
  return new CustomBigNum(123n);
}
