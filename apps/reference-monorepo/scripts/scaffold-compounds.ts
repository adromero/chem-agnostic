/**
 * Bootstrap script for the WP-018 reference monorepo. Generates each compound
 * directory (elements, interfaces, adapters, reactions, public.ts,
 * compound.yaml) for the TS workspace plus the Python compounds under
 * apps/api/. Run with `tsx scripts/scaffold-compounds.ts` from the
 * reference-monorepo root. Idempotent — re-running overwrites stub files
 * with the same content.
 *
 * The scaffold is hand-tuned (not generated via `chemag scaffold`) because
 * we need the descriptions to drive the `where_should_this_go` MCP tool's
 * TF-IDF scoring deterministically — particularly for the "add a Stripe
 * payment flow" acceptance test which must surface the `billing` compound.
 */

import * as fs from "node:fs";
import * as path from "node:path";

const repoRoot = path.dirname(path.dirname(new URL(import.meta.url).pathname));

type Role = "element" | "molecule" | "reaction" | "interface" | "adapter" | "buffer";

interface UnitSpec {
  role: Role;
  name: string;
  /** Names this unit depends on (resolved within the compound + its imports). */
  dependsOn?: string[];
  /** Interfaces this adapter implements. */
  implements?: string[];
  /** TS body. Only used when the default stub is not enough. */
  body?: string;
}

interface CompoundSpec {
  name: string;
  description: string;
  /** Names of OTHER compounds we import (their public surfaces). */
  importsFrom?: { compound: string; units: string[] }[];
  units: UnitSpec[];
  /** Type for compound_types. Defaults to "compound". */
  type?: "compound" | "solvent";
}

// ---------------------------------------------------------------------------
// TypeScript stub renderers
// ---------------------------------------------------------------------------

function tsExtensionless(name: string): string {
  return name.replace(/\.ts$/, "");
}

/**
 * Group cross-compound dependencies by their owning compound. Returns a
 * list of `import type { ... } from "..." ` lines suitable for placement at
 * the top of a unit stub.
 *
 *   - Names that live in the SAME compound resolve through `../public.js`.
 *   - Names that live in DIFFERENT compounds (declared in `importsFrom` of
 *     the current compound) resolve through `../../<other>/public.js`.
 *
 * Unknown names are dropped silently so the stub still type-checks even if
 * a future scaffold spec lists a dep that doesn't ship yet.
 */
function importLinesForUnit(deps: string[], ctx: { ownerByName: Map<string, string>; selfCompound: string }): string {
  if (deps.length === 0) return "";
  const groups = new Map<string, string[]>();
  for (const d of deps) {
    const owner = ctx.ownerByName.get(d);
    if (!owner) continue;
    const target = owner === ctx.selfCompound ? "../public.js" : `../../${owner}/public.js`;
    if (!groups.has(target)) groups.set(target, []);
    groups.get(target)!.push(d);
  }
  return [...groups.entries()]
    .map(([target, names]) => `import type { ${names.join(", ")} } from "${target}";`)
    .join("\n") + (groups.size ? "\n" : "");
}

interface RenderCtx {
  ownerByName: Map<string, string>;
  selfCompound: string;
}

function elementBody(name: string): string {
  return `// Auto-scaffolded element. Replace with the real value object.
export type ${name} = { readonly value: string };
`;
}

function moleculeBody(name: string, deps: string[], ctx: RenderCtx): string {
  const importLines = importLinesForUnit(deps, ctx);
  const fieldLines = deps
    .filter((d) => ctx.ownerByName.has(d))
    .map((d) => `  readonly ${d.charAt(0).toLowerCase() + d.slice(1)}: ${d};`)
    .join("\n");
  return `// Auto-scaffolded molecule.
${importLines}export type ${name} = {
${fieldLines || "  readonly id: string;"}
};
`;
}

function interfaceBody(name: string, deps: string[], ctx: RenderCtx): string {
  const importLines = importLinesForUnit(deps, ctx);
  // Reference each imported type in a phantom field so `verbatimModuleSyntax`
  // tsconfig setups don't strip the import. The body still passes strict.
  const phantom = deps
    .filter((d) => ctx.ownerByName.has(d))
    .map((d) => `  readonly _${d.toLowerCase()}?: ${d};`)
    .join("\n");
  return `// Auto-scaffolded port. Adapters in this compound implement this contract.
${importLines}export interface ${name} {
  describe(): string;
${phantom}
}
`;
}

function adapterBody(
  name: string,
  ifaceName: string | undefined,
  deps: string[],
  ctx: RenderCtx,
): string {
  const allRefs = new Set<string>(deps);
  if (ifaceName) allRefs.add(ifaceName);
  const importLines = importLinesForUnit([...allRefs], ctx);
  const implClause = ifaceName ? ` implements ${ifaceName}` : "";
  return `// Auto-scaffolded adapter.
${importLines}export class ${name}${implClause} {
  describe(): string {
    return "${name}";
  }
}
`;
}

function reactionBody(name: string, deps: string[], ctx: RenderCtx): string {
  // The stub doesn't actually USE the imports; it just needs to declare the
  // architectural dependency in the compound.yaml manifest. We still emit
  // type-only imports + reference each in a `void` so the imports survive
  // any verbatim-module-syntax tsconfig later.
  const importLines = importLinesForUnit(deps, ctx);
  const voidRefs = deps
    .filter((d) => ctx.ownerByName.has(d))
    .map((d) => `  void {} as ${d} | undefined;`)
    .join("\n");
  return `// Auto-scaffolded reaction (use case workflow).
${importLines}export async function ${name}(input: unknown): Promise<unknown> {
  void input;
${voidRefs}
  return { ok: true, reaction: "${name}" };
}
`;
}

function bufferBody(name: string, deps: string[], ctx: RenderCtx): string {
  const importLines = importLinesForUnit(deps, ctx);
  const voidRefs = deps
    .filter((d) => ctx.ownerByName.has(d))
    .map((d) => `    void {} as ${d} | undefined;`)
    .join("\n");
  return `// Auto-scaffolded buffer (cross-cutting middleware).
${importLines}export function ${name}<T>(reaction: (i: T) => Promise<unknown>): (i: T) => Promise<unknown> {
  return async (i) => {
${voidRefs}
    return reaction(i);
  };
}
`;
}

function rendererFor(role: Role, ctx: RenderCtx) {
  switch (role) {
    case "element":
      return (u: UnitSpec) => elementBody(u.name);
    case "molecule":
      return (u: UnitSpec) => moleculeBody(u.name, u.dependsOn ?? [], ctx);
    case "interface":
      return (u: UnitSpec) => interfaceBody(u.name, u.dependsOn ?? [], ctx);
    case "adapter":
      return (u: UnitSpec) => adapterBody(u.name, u.implements?.[0], u.dependsOn ?? [], ctx);
    case "reaction":
      return (u: UnitSpec) => reactionBody(u.name, u.dependsOn ?? [], ctx);
    case "buffer":
      return (u: UnitSpec) => bufferBody(u.name, u.dependsOn ?? [], ctx);
  }
}

function roleFolder(role: Role): string {
  // Plural convention used in workspace.yaml.
  return `${role}s`;
}

// ---------------------------------------------------------------------------
// compound.yaml + public.ts emission
// ---------------------------------------------------------------------------

function writeCompound(
  compoundsDir: string,
  c: CompoundSpec,
  ownerByName: Map<string, string>,
): void {
  const dir = path.join(compoundsDir, c.name);
  fs.mkdirSync(dir, { recursive: true });

  const ctx: RenderCtx = { ownerByName, selfCompound: c.name };

  const exportBuckets: Record<string, string[]> = {};
  for (const u of c.units) {
    const key = roleFolder(u.role);
    if (!exportBuckets[key]) exportBuckets[key] = [];
    exportBuckets[key].push(u.name);

    const folder = path.join(dir, roleFolder(u.role));
    fs.mkdirSync(folder, { recursive: true });
    const body = u.body ?? rendererFor(u.role, ctx)(u);
    fs.writeFileSync(path.join(folder, `${u.name}.ts`), body);
  }

  // public.ts re-exports every unit from its role folder.
  const publicLines: string[] = [];
  for (const u of c.units) {
    if (u.role === "element" || u.role === "molecule" || u.role === "interface") {
      publicLines.push(`export type { ${u.name} } from "./${roleFolder(u.role)}/${u.name}.js";`);
    } else {
      publicLines.push(`export { ${u.name} } from "./${roleFolder(u.role)}/${u.name}.js";`);
    }
  }
  fs.writeFileSync(path.join(dir, "public.ts"), publicLines.join("\n") + "\n");

  // compound.yaml
  const yaml: string[] = [];
  yaml.push(`compound: ${c.name}`);
  // Quote descriptions because they often contain colons, which YAML 1.2
  // would otherwise parse as nested mappings inside a compact mapping.
  yaml.push(`description: ${JSON.stringify(c.description)}`);
  if (c.type) yaml.push(`type: ${c.type}`);
  yaml.push(`exports:`);
  for (const [key, names] of Object.entries(exportBuckets)) {
    yaml.push(`  ${key}: [${names.join(", ")}]`);
  }
  yaml.push(`imports:`);
  if (!c.importsFrom || c.importsFrom.length === 0) {
    yaml[yaml.length - 1] = `imports: []`;
  } else {
    for (const i of c.importsFrom) {
      yaml.push(`  - compound: ${i.compound}`);
      yaml.push(`    units: [${i.units.join(", ")}]`);
    }
  }
  yaml.push(`units:`);
  for (const u of c.units) {
    yaml.push(`  - role: ${u.role}`);
    yaml.push(`    name: ${u.name}`);
    yaml.push(`    file: ./${roleFolder(u.role)}/${u.name}.ts`);
    if (u.implements && u.implements.length) {
      yaml.push(`    implements: [${u.implements.join(", ")}]`);
    }
    if (u.dependsOn && u.dependsOn.length) {
      yaml.push(`    depends_on: [${u.dependsOn.join(", ")}]`);
    }
  }
  fs.writeFileSync(path.join(dir, "compound.yaml"), yaml.join("\n") + "\n");
}

// ---------------------------------------------------------------------------
// TypeScript compounds
// ---------------------------------------------------------------------------

const TS_COMPOUNDS: CompoundSpec[] = [
  // Web compounds (12)
  {
    name: "auth",
    description:
      "Authentication: login, logout, password reset, JWT issuance and verification for the admin web console.",
    units: [
      { role: "element", name: "Credential" },
      { role: "element", name: "Token" },
      { role: "interface", name: "AuthGateway", dependsOn: ["Credential", "Token"] },
      {
        role: "adapter",
        name: "JwtAuthGateway",
        implements: ["AuthGateway"],
        dependsOn: ["AuthGateway", "Credential", "Token"],
      },
      { role: "reaction", name: "loginUser", dependsOn: ["Credential", "AuthGateway"] },
      { role: "reaction", name: "logoutUser", dependsOn: ["Token", "AuthGateway"] },
    ],
  },
  {
    name: "sessions",
    description:
      "Session lifecycle: creation, refresh, revocation, idle expiry. Backed by a key-value session store.",
    importsFrom: [{ compound: "auth", units: ["Token"] }],
    units: [
      { role: "element", name: "SessionId" },
      { role: "molecule", name: "Session", dependsOn: ["SessionId"] },
      { role: "interface", name: "SessionStore", dependsOn: ["Session", "SessionId"] },
      {
        role: "adapter",
        name: "RedisSessionStore",
        implements: ["SessionStore"],
        dependsOn: ["SessionStore", "Session", "SessionId"],
      },
      { role: "reaction", name: "createSession", dependsOn: ["Session", "SessionStore"] },
      { role: "reaction", name: "revokeSession", dependsOn: ["SessionId", "SessionStore"] },
    ],
  },
  {
    name: "dashboard",
    description:
      "Dashboard widgets and metrics overview — KPI cards, recent-activity feed, and configurable layouts.",
    units: [
      { role: "element", name: "WidgetSpec" },
      { role: "molecule", name: "DashboardLayout", dependsOn: ["WidgetSpec"] },
      { role: "interface", name: "DashboardLoader", dependsOn: ["DashboardLayout"] },
      {
        role: "adapter",
        name: "HttpDashboardLoader",
        implements: ["DashboardLoader"],
        dependsOn: ["DashboardLoader", "DashboardLayout"],
      },
      { role: "reaction", name: "loadDashboard", dependsOn: ["DashboardLayout", "DashboardLoader"] },
    ],
  },
  {
    name: "users",
    description:
      "User management: create, edit, deactivate, list. The canonical owner of the User entity.",
    units: [
      { role: "element", name: "UserId" },
      { role: "element", name: "Email" },
      { role: "molecule", name: "User", dependsOn: ["UserId", "Email"] },
      { role: "interface", name: "UserRepository", dependsOn: ["User", "UserId"] },
      {
        role: "adapter",
        name: "PostgresUserRepository",
        implements: ["UserRepository"],
        dependsOn: ["UserRepository", "User", "UserId"],
      },
      { role: "reaction", name: "createUser", dependsOn: ["User", "Email", "UserRepository"] },
      { role: "reaction", name: "deactivateUser", dependsOn: ["UserId", "UserRepository"] },
    ],
  },
  {
    name: "billing",
    description:
      "Subscription billing — Stripe payment flows, invoicing, refunds, and webhook reconciliation. Owns Money, Invoice, and Subscription value objects.",
    units: [
      { role: "element", name: "PriceId" },
      { role: "element", name: "BillingMoney" },
      { role: "molecule", name: "Subscription", dependsOn: ["PriceId", "BillingMoney"] },
      { role: "molecule", name: "Invoice", dependsOn: ["BillingMoney"] },
      { role: "interface", name: "PaymentGateway", dependsOn: ["BillingMoney"] },
      { role: "interface", name: "BillingRepository", dependsOn: ["Subscription", "Invoice"] },
      {
        role: "adapter",
        name: "StripeGateway",
        implements: ["PaymentGateway"],
        dependsOn: ["PaymentGateway", "BillingMoney"],
      },
      {
        role: "adapter",
        name: "PostgresBillingRepository",
        implements: ["BillingRepository"],
        dependsOn: ["BillingRepository", "Subscription", "Invoice"],
      },
      { role: "reaction", name: "chargeCustomer", dependsOn: ["BillingMoney", "PaymentGateway"] },
      { role: "reaction", name: "processRefund", dependsOn: ["BillingMoney", "PaymentGateway"] },
      {
        role: "reaction",
        name: "createSubscription",
        dependsOn: ["Subscription", "PriceId", "BillingRepository"],
      },
    ],
  },
  {
    name: "integrations",
    description:
      "Third-party connectors: Slack, Stripe webhook receivers, GitHub. Verifies signatures and dispatches into domain reactions.",
    importsFrom: [{ compound: "billing", units: ["BillingMoney"] }],
    units: [
      { role: "element", name: "WebhookEvent" },
      { role: "interface", name: "SlackClient" },
      { role: "interface", name: "WebhookVerifier", dependsOn: ["WebhookEvent"] },
      {
        role: "adapter",
        name: "SlackHttpClient",
        implements: ["SlackClient"],
        dependsOn: ["SlackClient"],
      },
      {
        role: "adapter",
        name: "StripeWebhookVerifier",
        implements: ["WebhookVerifier"],
        dependsOn: ["WebhookVerifier", "WebhookEvent"],
      },
      {
        role: "reaction",
        name: "handleStripeWebhook",
        dependsOn: ["WebhookEvent", "WebhookVerifier"],
      },
      { role: "reaction", name: "postSlackMessage", dependsOn: ["SlackClient"] },
    ],
  },
  {
    name: "settings",
    description: "Workspace and per-user preferences (feature flags, themes, locale).",
    units: [
      { role: "element", name: "SettingKey" },
      { role: "element", name: "SettingValue" },
      { role: "interface", name: "SettingsRepository", dependsOn: ["SettingKey", "SettingValue"] },
      {
        role: "adapter",
        name: "PostgresSettingsRepository",
        implements: ["SettingsRepository"],
        dependsOn: ["SettingsRepository", "SettingKey", "SettingValue"],
      },
      {
        role: "reaction",
        name: "updateSetting",
        dependsOn: ["SettingKey", "SettingValue", "SettingsRepository"],
      },
    ],
  },
  {
    name: "audit-log",
    description: "Audit trail recording who did what when, with diff context for sensitive actions.",
    units: [
      { role: "element", name: "AuditEntry" },
      { role: "interface", name: "AuditRepository", dependsOn: ["AuditEntry"] },
      {
        role: "adapter",
        name: "PostgresAuditRepository",
        implements: ["AuditRepository"],
        dependsOn: ["AuditRepository", "AuditEntry"],
      },
      { role: "reaction", name: "recordAuditEntry", dependsOn: ["AuditEntry", "AuditRepository"] },
    ],
  },
  {
    name: "search",
    description:
      "Full-text search over users, tickets, and audit entries via an external search index.",
    units: [
      { role: "element", name: "SearchQuery" },
      { role: "element", name: "SearchHit" },
      { role: "interface", name: "SearchIndex", dependsOn: ["SearchQuery", "SearchHit"] },
      {
        role: "adapter",
        name: "MeilisearchIndex",
        implements: ["SearchIndex"],
        dependsOn: ["SearchIndex", "SearchQuery", "SearchHit"],
      },
      {
        role: "reaction",
        name: "searchEntries",
        dependsOn: ["SearchQuery", "SearchHit", "SearchIndex"],
      },
    ],
  },
  {
    name: "notifications",
    description: "User-facing notifications — email, in-app toasts, push deliverability.",
    units: [
      { role: "element", name: "NotificationPayload" },
      { role: "interface", name: "EmailClient", dependsOn: ["NotificationPayload"] },
      {
        role: "adapter",
        name: "PostmarkClient",
        implements: ["EmailClient"],
        dependsOn: ["EmailClient", "NotificationPayload"],
      },
      {
        role: "reaction",
        name: "sendEmailNotification",
        dependsOn: ["NotificationPayload", "EmailClient"],
      },
    ],
  },
  {
    name: "support",
    description: "Help center and customer support tickets — open, comment, close.",
    units: [
      { role: "element", name: "TicketId" },
      { role: "element", name: "TicketStatus" },
      { role: "molecule", name: "SupportTicket", dependsOn: ["TicketId", "TicketStatus"] },
      { role: "interface", name: "TicketRepository", dependsOn: ["SupportTicket", "TicketId"] },
      {
        role: "adapter",
        name: "PostgresTicketRepository",
        implements: ["TicketRepository"],
        dependsOn: ["TicketRepository", "SupportTicket", "TicketId"],
      },
      { role: "reaction", name: "openTicket", dependsOn: ["SupportTicket", "TicketRepository"] },
      { role: "reaction", name: "closeTicket", dependsOn: ["TicketId", "TicketRepository"] },
    ],
  },
  {
    name: "profile",
    description: "User profile editing — display name, avatar, time-zone, notification preferences.",
    importsFrom: [{ compound: "users", units: ["UserId", "User", "UserRepository"] }],
    units: [
      { role: "element", name: "DisplayName" },
      { role: "element", name: "Avatar" },
      {
        role: "reaction",
        name: "updateProfile",
        dependsOn: ["DisplayName", "Avatar", "UserId", "UserRepository"],
      },
    ],
  },

  // Worker compounds (6)
  {
    name: "queue-driver",
    description: "pg-boss queue driver — connects to Postgres, enqueues and dequeues background jobs.",
    units: [
      { role: "element", name: "JobId" },
      { role: "element", name: "JobName" },
      { role: "interface", name: "JobQueue", dependsOn: ["JobId", "JobName"] },
      {
        role: "adapter",
        name: "PgBossJobQueue",
        implements: ["JobQueue"],
        dependsOn: ["JobQueue", "JobId", "JobName"],
      },
      { role: "reaction", name: "enqueueJob", dependsOn: ["JobName", "JobQueue"] },
      { role: "reaction", name: "dequeueJob", dependsOn: ["JobId", "JobQueue"] },
    ],
  },
  {
    name: "job-runners",
    description: "Job runner registry and per-name dispatch into domain reactions.",
    importsFrom: [{ compound: "queue-driver", units: ["JobId", "JobName", "JobQueue"] }],
    units: [
      { role: "element", name: "RunnerHandle" },
      { role: "interface", name: "RunnerRegistry", dependsOn: ["RunnerHandle", "JobName"] },
      {
        role: "adapter",
        name: "InMemoryRunnerRegistry",
        implements: ["RunnerRegistry"],
        dependsOn: ["RunnerRegistry", "RunnerHandle", "JobName"],
      },
      { role: "reaction", name: "runJob", dependsOn: ["JobId", "JobName", "RunnerRegistry"] },
    ],
  },
  {
    name: "retry-policy",
    description: "Retry strategy with exponential backoff and configurable jitter for failed jobs.",
    units: [
      { role: "element", name: "RetrySpec" },
      { role: "interface", name: "BackoffComputer", dependsOn: ["RetrySpec"] },
      {
        role: "adapter",
        name: "ExponentialBackoff",
        implements: ["BackoffComputer"],
        dependsOn: ["BackoffComputer", "RetrySpec"],
      },
      { role: "reaction", name: "computeRetryDelay", dependsOn: ["RetrySpec", "BackoffComputer"] },
    ],
  },
  {
    name: "metrics",
    description: "Prometheus-style worker metrics — job counts, latency histograms, error rates.",
    units: [
      { role: "element", name: "MetricSample" },
      { role: "interface", name: "MetricsCollector", dependsOn: ["MetricSample"] },
      {
        role: "adapter",
        name: "PrometheusCollector",
        implements: ["MetricsCollector"],
        dependsOn: ["MetricsCollector", "MetricSample"],
      },
      {
        role: "reaction",
        name: "recordJobMetric",
        dependsOn: ["MetricSample", "MetricsCollector"],
      },
    ],
  },
  {
    name: "audit-emit",
    description: "Emits audit events to the central audit-log service via HTTP.",
    units: [
      { role: "element", name: "AuditEvent" },
      { role: "interface", name: "AuditEmitter", dependsOn: ["AuditEvent"] },
      {
        role: "adapter",
        name: "HttpAuditEmitter",
        implements: ["AuditEmitter"],
        dependsOn: ["AuditEmitter", "AuditEvent"],
      },
      { role: "reaction", name: "emitAuditEvent", dependsOn: ["AuditEvent", "AuditEmitter"] },
    ],
  },
  {
    name: "lifecycle",
    description: "Worker lifecycle — startup, graceful shutdown, health probes, signal handling.",
    units: [
      { role: "element", name: "LifecyclePhase" },
      { role: "interface", name: "HealthProbe", dependsOn: ["LifecyclePhase"] },
      {
        role: "adapter",
        name: "DefaultHealthProbe",
        implements: ["HealthProbe"],
        dependsOn: ["HealthProbe", "LifecyclePhase"],
      },
      { role: "reaction", name: "startWorker", dependsOn: ["LifecyclePhase", "HealthProbe"] },
      { role: "reaction", name: "shutdownWorker", dependsOn: ["LifecyclePhase", "HealthProbe"] },
    ],
  },

  // Shared packages — declared as solvent compounds (implicit imports allowed)
  {
    name: "shared-domain",
    type: "solvent",
    description:
      "Cross-cutting shared value objects — Money, EmailAddress, Slug, ISO timestamp helpers.",
    units: [
      { role: "element", name: "MoneyAmount" },
      { role: "element", name: "EmailAddress" },
      { role: "element", name: "Slug" },
    ],
  },
  {
    name: "contracts",
    type: "solvent",
    description: "Generated OpenAPI request/response shapes shared between web, worker, and api.",
    units: [
      { role: "element", name: "ApiResponse" },
      { role: "element", name: "ApiError" },
    ],
  },
  {
    name: "ui-kit",
    type: "solvent",
    description: "Shared React UI components — Button, Card, Modal — published via the design system.",
    units: [
      { role: "element", name: "ButtonProps" },
      { role: "element", name: "CardProps" },
      { role: "element", name: "ModalProps" },
    ],
  },
];

// ---------------------------------------------------------------------------
// Python compounds (apps/api/)
// ---------------------------------------------------------------------------

interface PyCompoundSpec {
  name: string;
  description: string;
  importsFrom?: { compound: string; units: string[] }[];
  units: UnitSpec[];
  type?: "compound" | "solvent";
}

const PY_COMPOUNDS: PyCompoundSpec[] = [
  {
    name: "settings",
    description: "Application configuration loaded from environment variables and config files.",
    units: [
      { role: "element", name: "AppSettings" },
      { role: "interface", name: "SettingsLoader", dependsOn: ["AppSettings"] },
      {
        role: "adapter",
        name: "EnvSettingsLoader",
        implements: ["SettingsLoader"],
        dependsOn: ["SettingsLoader", "AppSettings"],
      },
      { role: "reaction", name: "load_settings", dependsOn: ["AppSettings", "SettingsLoader"] },
    ],
  },
  {
    name: "errors",
    description: "Domain error types and FastAPI exception handlers.",
    units: [
      { role: "element", name: "DomainError" },
      { role: "element", name: "ValidationError" },
    ],
  },
  {
    name: "auth",
    description: "JWT auth middleware, request principal extraction, role-based access checks.",
    units: [
      { role: "element", name: "Principal" },
      { role: "element", name: "AuthToken" },
      { role: "interface", name: "TokenVerifier", dependsOn: ["AuthToken", "Principal"] },
      {
        role: "adapter",
        name: "JwtTokenVerifier",
        implements: ["TokenVerifier"],
        dependsOn: ["TokenVerifier", "AuthToken", "Principal"],
      },
      { role: "reaction", name: "verify_request", dependsOn: ["AuthToken", "TokenVerifier"] },
    ],
  },
  {
    name: "observability",
    description: "Structured logging, OpenTelemetry tracing, request-scoped correlation IDs.",
    units: [
      { role: "element", name: "TraceId" },
      { role: "interface", name: "Logger", dependsOn: ["TraceId"] },
      { role: "adapter", name: "JsonLogger", implements: ["Logger"], dependsOn: ["Logger", "TraceId"] },
      { role: "reaction", name: "with_trace", dependsOn: ["TraceId", "Logger"] },
    ],
  },
  {
    name: "repositories",
    description: "Postgres-backed repositories — users, billing entries, support tickets.",
    units: [
      { role: "element", name: "RecordId" },
      { role: "molecule", name: "Record", dependsOn: ["RecordId"] },
      { role: "interface", name: "Repository", dependsOn: ["Record", "RecordId"] },
      {
        role: "adapter",
        name: "PostgresRepository",
        implements: ["Repository"],
        dependsOn: ["Repository", "Record", "RecordId"],
      },
    ],
  },
  {
    name: "services",
    description: "Application services that orchestrate repositories and external integrations.",
    importsFrom: [
      { compound: "repositories", units: ["Record", "Repository", "RecordId"] },
    ],
    units: [
      { role: "element", name: "ServiceResult" },
      { role: "interface", name: "ServiceBus", dependsOn: ["ServiceResult"] },
      {
        role: "adapter",
        name: "InMemoryServiceBus",
        implements: ["ServiceBus"],
        dependsOn: ["ServiceBus", "ServiceResult"],
      },
      {
        role: "reaction",
        name: "execute_service",
        dependsOn: ["ServiceResult", "ServiceBus", "Repository"],
      },
    ],
  },
  {
    name: "routers",
    description: "FastAPI route definitions exposing services over HTTP.",
    importsFrom: [
      { compound: "services", units: ["ServiceResult", "ServiceBus"] },
      { compound: "auth", units: ["Principal"] },
    ],
    units: [
      { role: "element", name: "RouteSpec" },
      { role: "interface", name: "RouteRegistry", dependsOn: ["RouteSpec"] },
      {
        role: "adapter",
        name: "FastapiRouteRegistry",
        implements: ["RouteRegistry"],
        dependsOn: ["RouteRegistry", "RouteSpec"],
      },
      {
        role: "reaction",
        name: "mount_routes",
        dependsOn: ["RouteSpec", "RouteRegistry", "ServiceBus", "Principal"],
      },
    ],
  },
  {
    name: "integrations",
    description: "External service clients — Stripe, Postmark, Slack — used from services.",
    units: [
      { role: "element", name: "IntegrationKey" },
      { role: "interface", name: "IntegrationClient", dependsOn: ["IntegrationKey"] },
      {
        role: "adapter",
        name: "HttpIntegrationClient",
        implements: ["IntegrationClient"],
        dependsOn: ["IntegrationClient", "IntegrationKey"],
      },
      {
        role: "reaction",
        name: "call_integration",
        dependsOn: ["IntegrationKey", "IntegrationClient"],
      },
    ],
  },
  {
    name: "tasks",
    description: "Background async tasks scheduled by the API process — cron-like recurring jobs.",
    units: [
      { role: "element", name: "TaskSpec" },
      { role: "interface", name: "Scheduler", dependsOn: ["TaskSpec"] },
      {
        role: "adapter",
        name: "AsyncioScheduler",
        implements: ["Scheduler"],
        dependsOn: ["Scheduler", "TaskSpec"],
      },
      { role: "reaction", name: "schedule_task", dependsOn: ["TaskSpec", "Scheduler"] },
    ],
  },
  {
    name: "healthcheck",
    description: "Liveness and readiness probes — DB ping, queue ping, Stripe ping.",
    units: [
      { role: "element", name: "ProbeResult" },
      { role: "interface", name: "Probe", dependsOn: ["ProbeResult"] },
      {
        role: "adapter",
        name: "DbPingProbe",
        implements: ["Probe"],
        dependsOn: ["Probe", "ProbeResult"],
      },
      { role: "reaction", name: "run_health_checks", dependsOn: ["ProbeResult", "Probe"] },
    ],
  },
];

// Python stub renderers — mirror the TS ones but emit Python source.
function pyName(name: string): string {
  return name
    .replace(/([a-z])([A-Z])/g, "$1_$2")
    .replace(/([A-Z]+)([A-Z][a-z])/g, "$1_$2")
    .toLowerCase();
}

interface PyRenderCtx {
  ownerByName: Map<string, string>;
  selfCompound: string;
}

/**
 * Group cross-compound dependencies by their owning compound and emit
 * Python-style relative imports. Same-compound deps go through `..public`
 * (the compound's `__init__.py`); cross-compound deps go through
 * `..<other_compound>` directly (treating each compound as a sibling
 * package — Python doesn't need a public.py wrapper because `__init__.py`
 * IS the surface).
 */
function pyImportLines(deps: string[], ctx: PyRenderCtx): string {
  if (!deps.length) return "";
  const groups = new Map<string, string[]>();
  for (const d of deps) {
    const owner = ctx.ownerByName.get(d);
    if (!owner) continue;
    const target =
      owner === ctx.selfCompound ? ".." : `...${owner.replace(/-/g, "_")}`;
    if (!groups.has(target)) groups.set(target, []);
    groups.get(target)!.push(d);
  }
  return [...groups.entries()]
    .map(([target, names]) => `from ${target} import ${names.join(", ")}`)
    .join("\n") + (groups.size ? "\n" : "");
}

function pyElementBody(name: string): string {
  return `"""Auto-scaffolded element. Replace with the real value object."""
from dataclasses import dataclass


@dataclass(frozen=True)
class ${name}:
    value: str
`;
}

function pyMoleculeBody(name: string, deps: string[], ctx: PyRenderCtx): string {
  return `"""Auto-scaffolded molecule."""
from dataclasses import dataclass

${pyImportLines(deps, ctx)}

@dataclass(frozen=True)
class ${name}:
    id: str
`;
}

function pyInterfaceBody(name: string, deps: string[], ctx: PyRenderCtx): string {
  return `"""Auto-scaffolded port. Adapters in this compound implement this protocol."""
from typing import Protocol

${pyImportLines(deps, ctx)}

class ${name}(Protocol):
    def describe(self) -> str: ...
`;
}

function pyAdapterBody(
  name: string,
  ifaceName: string | undefined,
  deps: string[],
  ctx: PyRenderCtx,
): string {
  const allDeps = new Set(deps);
  if (ifaceName) allDeps.add(ifaceName);
  return `"""Auto-scaffolded adapter."""
${pyImportLines([...allDeps], ctx)}

class ${name}:
    def describe(self) -> str:
        return "${name}"
`;
}

function pyReactionBody(name: string, deps: string[], ctx: PyRenderCtx): string {
  return `"""Auto-scaffolded reaction (use case workflow)."""
from typing import Any

${pyImportLines(deps, ctx)}

async def ${pyName(name)}(input: Any) -> dict[str, Any]:
    _ = input
    return {"ok": True, "reaction": "${name}"}
`;
}

function pyBufferBody(name: string, deps: string[], ctx: PyRenderCtx): string {
  return `"""Auto-scaffolded buffer (cross-cutting middleware)."""
from typing import Awaitable, Callable, Any

${pyImportLines(deps, ctx)}

def ${pyName(name)}(reaction: Callable[[Any], Awaitable[Any]]) -> Callable[[Any], Awaitable[Any]]:
    async def wrapped(i: Any) -> Any:
        return await reaction(i)
    return wrapped
`;
}

function pyRendererFor(role: Role, ctx: PyRenderCtx) {
  switch (role) {
    case "element":
      return (u: UnitSpec) => pyElementBody(u.name);
    case "molecule":
      return (u: UnitSpec) => pyMoleculeBody(u.name, u.dependsOn ?? [], ctx);
    case "interface":
      return (u: UnitSpec) => pyInterfaceBody(u.name, u.dependsOn ?? [], ctx);
    case "adapter":
      return (u: UnitSpec) =>
        pyAdapterBody(u.name, u.implements?.[0], u.dependsOn ?? [], ctx);
    case "reaction":
      return (u: UnitSpec) => pyReactionBody(u.name, u.dependsOn ?? [], ctx);
    case "buffer":
      return (u: UnitSpec) => pyBufferBody(u.name, u.dependsOn ?? [], ctx);
  }
}

function writePyCompound(
  compoundsDir: string,
  c: PyCompoundSpec,
  ownerByName: Map<string, string>,
): void {
  const dir = path.join(compoundsDir, c.name.replace(/-/g, "_"));
  fs.mkdirSync(dir, { recursive: true });

  const ctx: PyRenderCtx = { ownerByName, selfCompound: c.name };

  // Each compound directory is a Python package — needs an __init__.py.
  // Each role folder is also a package (needs __init__.py too) so relative
  // imports can resolve.
  const exportBuckets: Record<string, string[]> = {};
  for (const u of c.units) {
    const key = roleFolder(u.role);
    if (!exportBuckets[key]) exportBuckets[key] = [];
    exportBuckets[key].push(u.name);

    const folder = path.join(dir, roleFolder(u.role));
    fs.mkdirSync(folder, { recursive: true });
    // Touch role-folder __init__.py so role folders are real packages.
    const folderInit = path.join(folder, "__init__.py");
    if (!fs.existsSync(folderInit)) fs.writeFileSync(folderInit, "");

    const body = pyRendererFor(u.role, ctx)(u);
    fs.writeFileSync(path.join(folder, `${pyName(u.name)}.py`), body);
  }

  // Compound-level public surface is `public.py` so the import-check sees a
  // non-default surface. But the workspace.yaml here uses `__init__.py` as
  // the public surface convention — so we re-export everything from the
  // compound's __init__.py. Each unit's import line uses the relative
  // role-folder path.
  const publicLines: string[] = [];
  for (const u of c.units) {
    publicLines.push(
      `from .${roleFolder(u.role)}.${pyName(u.name)} import ${u.name}`,
    );
  }
  fs.writeFileSync(path.join(dir, "__init__.py"), publicLines.join("\n") + "\n");

  // compound.yaml
  const yaml: string[] = [];
  yaml.push(`compound: ${c.name}`);
  yaml.push(`description: ${JSON.stringify(c.description)}`);
  if (c.type) yaml.push(`type: ${c.type}`);
  yaml.push(`exports:`);
  for (const [key, names] of Object.entries(exportBuckets)) {
    yaml.push(`  ${key}: [${names.join(", ")}]`);
  }
  if (!c.importsFrom || c.importsFrom.length === 0) {
    yaml.push(`imports: []`);
  } else {
    yaml.push(`imports:`);
    for (const i of c.importsFrom) {
      yaml.push(`  - compound: ${i.compound}`);
      yaml.push(`    units: [${i.units.join(", ")}]`);
    }
  }
  yaml.push(`units:`);
  for (const u of c.units) {
    yaml.push(`  - role: ${u.role}`);
    yaml.push(`    name: ${u.name}`);
    yaml.push(`    file: ./${roleFolder(u.role)}/${pyName(u.name)}.py`);
    if (u.implements && u.implements.length) {
      yaml.push(`    implements: [${u.implements.join(", ")}]`);
    }
    if (u.dependsOn && u.dependsOn.length) {
      yaml.push(`    depends_on: [${u.dependsOn.join(", ")}]`);
    }
  }
  fs.writeFileSync(path.join(dir, "compound.yaml"), yaml.join("\n") + "\n");
}

// ---------------------------------------------------------------------------
// Run
// ---------------------------------------------------------------------------

/**
 * Build a name -> owning-compound map across every TS compound. The
 * scaffolded unit stubs use this to resolve cross-compound type imports
 * (e.g. `JobName` lives in `queue-driver`, not `job-runners`).
 */
function buildOwnerMap(compounds: { name: string; units: UnitSpec[] }[]): Map<string, string> {
  const map = new Map<string, string>();
  for (const c of compounds) {
    for (const u of c.units) {
      map.set(u.name, c.name);
    }
  }
  return map;
}

const tsOwnerByName = buildOwnerMap(TS_COMPOUNDS);
const pyOwnerByName = buildOwnerMap(PY_COMPOUNDS);

const tsCompoundsDir = path.join(repoRoot, "src", "compounds");
fs.mkdirSync(tsCompoundsDir, { recursive: true });
for (const c of TS_COMPOUNDS) {
  writeCompound(tsCompoundsDir, c, tsOwnerByName);
  process.stdout.write(`  ts: ${c.name}\n`);
}
process.stdout.write(`scaffolded ${TS_COMPOUNDS.length} TS compounds.\n`);

const pyCompoundsDir = path.join(repoRoot, "apps", "api", "src", "compounds");
fs.mkdirSync(pyCompoundsDir, { recursive: true });
fs.writeFileSync(path.join(repoRoot, "apps", "api", "src", "__init__.py"), "");
fs.writeFileSync(path.join(pyCompoundsDir, "__init__.py"), "");
for (const c of PY_COMPOUNDS) {
  writePyCompound(pyCompoundsDir, c, pyOwnerByName);
  process.stdout.write(`  py: ${c.name}\n`);
}
process.stdout.write(`scaffolded ${PY_COMPOUNDS.length} Python compounds.\n`);
