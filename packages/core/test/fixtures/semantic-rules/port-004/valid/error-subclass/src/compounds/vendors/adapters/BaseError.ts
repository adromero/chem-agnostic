// Intermediate error class — extends the built-in Error, two levels up
// from FooError. Exercises the transitive-extends walk.
export class BaseError extends Error {}
