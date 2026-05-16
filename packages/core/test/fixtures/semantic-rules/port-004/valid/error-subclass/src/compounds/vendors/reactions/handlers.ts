import { FooError } from "../adapters/FooError";

export function doWork(): void {
  throw new FooError();
}
