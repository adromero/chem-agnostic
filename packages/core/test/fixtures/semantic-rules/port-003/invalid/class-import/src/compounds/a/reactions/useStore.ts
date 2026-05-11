import { VendorRepository } from "../../b/public";

export function useStore(): VendorRepository {
  return new VendorRepository();
}
