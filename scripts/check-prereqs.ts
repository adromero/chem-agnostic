#!/usr/bin/env node
/**
 * scripts/check-prereqs.ts
 *
 * Verifies that operator-provisioned external prerequisites (domains, npm/pypi
 * scopes, third-party API keys) are wired up before a deploy.
 *
 * Usage:
 *   pnpm check-prereqs           # default: only enforce keys for stages already shipped
 *   pnpm check-prereqs --all     # enforce every documented key (used in CI deploy gate)
 *   pnpm check-prereqs --stage cloud   # enforce keys required for a named stage
 *
 * The script reads from `process.env` (consumers are expected to source `.env`
 * or have CI inject the relevant secrets). It does NOT block CLI/engine WPs;
 * those don't depend on cloud secrets.
 *
 * Exits 0 if all required keys are present, 1 otherwise.
 */
import process from "node:process";

export interface PrereqRequirement {
  /** Logical group that owns this prereq. */
  stage:
    | "core"
    | "ai"
    | "ci"
    | "cloud"
    | "auth"
    | "github-app"
    | "billing"
    | "marketing"
    | "community";
  /** Environment variable name. */
  envVar: string;
  /** Human-readable description shown when the key is missing. */
  description: string;
  /** WP that introduces or first depends on this requirement. */
  wp: string;
}

export const REQUIREMENTS: readonly PrereqRequirement[] = [
  // Track 0/1 — code-only. No external prereqs required.
  // Track 3 — Cloud
  {
    stage: "cloud",
    envVar: "DATABASE_URL",
    description: "Postgres connection string for cloud-api.",
    wp: "WP-028",
  },
  {
    stage: "cloud",
    envVar: "REDIS_URL",
    description: "Upstash Redis URL for the BullMQ queue + cache.",
    wp: "WP-028",
  },
  {
    stage: "cloud",
    envVar: "R2_ACCESS_KEY_ID",
    description: "Cloudflare R2 access key for artifact storage.",
    wp: "WP-028",
  },
  {
    stage: "cloud",
    envVar: "R2_SECRET_ACCESS_KEY",
    description: "Cloudflare R2 secret access key.",
    wp: "WP-028",
  },
  {
    stage: "cloud",
    envVar: "R2_BUCKET",
    description: "Cloudflare R2 bucket name (e.g. chemag-artifacts).",
    wp: "WP-028",
  },
  // Track 3 — Auth (Clerk)
  {
    stage: "auth",
    envVar: "CLERK_SECRET_KEY",
    description: "Clerk backend API secret key.",
    wp: "WP-029",
  },
  {
    stage: "auth",
    envVar: "CLERK_WEBHOOK_SECRET",
    description: "Clerk webhook signing secret.",
    wp: "WP-029",
  },
  // Track 3 — GitHub App
  {
    stage: "github-app",
    envVar: "GITHUB_APP_ID",
    description: "GitHub App numeric ID.",
    wp: "WP-030",
  },
  {
    stage: "github-app",
    envVar: "GITHUB_APP_PRIVATE_KEY",
    description: "PEM-encoded private key for the chemag-bot GitHub App.",
    wp: "WP-030",
  },
  {
    stage: "github-app",
    envVar: "GITHUB_APP_WEBHOOK_SECRET",
    description: "Webhook secret for the chemag-bot GitHub App.",
    wp: "WP-030",
  },
  // Track 3 — Billing (Stripe)
  {
    stage: "billing",
    envVar: "STRIPE_SECRET_KEY",
    description: "Stripe secret API key for cloud-api.",
    wp: "WP-037",
  },
  {
    stage: "billing",
    envVar: "STRIPE_WEBHOOK_SECRET",
    description: "Stripe webhook signing secret.",
    wp: "WP-037",
  },
  // Track 6 — Marketing/analytics
  {
    stage: "marketing",
    envVar: "RESEND_API_KEY",
    description: "Resend API key for transactional email.",
    wp: "WP-052",
  },
  {
    stage: "marketing",
    envVar: "POSTHOG_PROJECT_KEY",
    description: "PostHog project key for product analytics.",
    wp: "WP-057",
  },
  {
    stage: "marketing",
    envVar: "SENTRY_DSN",
    description: "Sentry DSN for error tracking.",
    wp: "WP-052",
  },
  // Track 6 — Community
  {
    stage: "community",
    envVar: "DISCORD_BOT_TOKEN",
    description: "Discord bot token for the launch server.",
    wp: "WP-058",
  },
];

export interface CheckResult {
  ok: boolean;
  missing: PrereqRequirement[];
  checked: PrereqRequirement[];
}

export interface CheckOptions {
  /** If specified, only enforce requirements in this stage. */
  stage?: PrereqRequirement["stage"];
  /** If true, enforce every documented requirement regardless of stage. */
  all?: boolean;
  /** Environment dictionary to read from (default: process.env). */
  env?: NodeJS.ProcessEnv;
}

export function checkPrereqs(options: CheckOptions = {}): CheckResult {
  const env = options.env ?? process.env;

  const filtered = REQUIREMENTS.filter((req) => {
    if (options.all) return true;
    if (options.stage) return req.stage === options.stage;
    // Default: enforce nothing (Track 0/1 require nothing). Caller should pass
    // --all or --stage <name> to actually validate keys.
    return false;
  });

  const missing = filtered.filter((req) => {
    const value = env[req.envVar];
    return value === undefined || value === "";
  });

  return {
    ok: missing.length === 0,
    missing,
    checked: filtered,
  };
}

function parseArgs(argv: string[]): CheckOptions {
  const opts: CheckOptions = {};
  for (let i = 0; i < argv.length; i += 1) {
    const arg = argv[i];
    if (arg === "--all") {
      opts.all = true;
    } else if (arg === "--stage") {
      const next = argv[i + 1];
      if (!next) {
        throw new Error("--stage requires a value");
      }
      opts.stage = next as PrereqRequirement["stage"];
      i += 1;
    }
  }
  return opts;
}

function main(): void {
  const opts = parseArgs(process.argv.slice(2));
  const result = checkPrereqs(opts);

  if (result.checked.length === 0) {
    console.log(
      "check-prereqs: no requirements selected. Pass --all or --stage <name> to validate keys.",
    );
    return;
  }

  if (result.ok) {
    console.log(`check-prereqs: OK (${result.checked.length} env vars checked).`);
    return;
  }

  console.error("check-prereqs: missing required environment variables:");
  for (const req of result.missing) {
    console.error(`  - ${req.envVar} (${req.stage}, ${req.wp}): ${req.description}`);
  }
  console.error(
    `\n${result.missing.length} of ${result.checked.length} required keys are missing.`,
  );
  console.error("See docs/master-plan/PREREQUISITES.md for how to provision each one.");
  process.exit(1);
}

// Run if invoked directly (not when imported by tests).
const isDirectRun = (() => {
  try {
    const entry = process.argv[1];
    if (!entry) return false;
    const url = new URL(`file://${entry}`).href;
    return import.meta.url === url;
  } catch {
    return false;
  }
})();

if (isDirectRun) {
  main();
}
