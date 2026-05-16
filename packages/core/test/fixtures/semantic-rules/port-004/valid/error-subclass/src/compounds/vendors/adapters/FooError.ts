import { BaseError } from "./BaseError";

// Transitive: FooError → BaseError → Error. With `allowErrorSubclasses: true`
// (the default), this is exempt; the reaction below can `throw new FooError()`
// without violating PORT-004.
export class FooError extends BaseError {
  constructor() {
    super("foo failed");
  }
}
