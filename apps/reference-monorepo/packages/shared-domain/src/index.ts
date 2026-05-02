// Cross-cutting domain primitives shared across web/worker/api.

export interface MoneyAmount {
  readonly amount: number;
  readonly currency: string;
}

export type EmailAddress = string & { readonly __brand: "EmailAddress" };

export function emailAddress(raw: string): EmailAddress {
  return raw as EmailAddress;
}

export type Slug = string & { readonly __brand: "Slug" };

export function slug(raw: string): Slug {
  return raw.toLowerCase().replace(/\s+/g, "-") as Slug;
}
