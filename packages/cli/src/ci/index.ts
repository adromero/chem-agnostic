// ---------------------------------------------------------------------------
// `chemag ci <provider> [...args]` — dispatcher for CI integrations that need
// out-of-band steps the third-party platform's UI doesn't already cover (MR /
// PR comments, status checks, etc.).
//
// Supported providers:
//   - gitlab    — wp-024. Posts a sticky MR comment via GitLab REST.
//   - bitbucket — wp-025. Posts a sticky PR comment via Bitbucket REST.
//
// Each provider lives in its own module so adding a third (Azure DevOps,
// Gitea, Forgejo, ...) is a one-file addition + one switch case here.
//
// The dispatcher is intentionally thin: each provider owns its own argv
// parser, env-var validation, and process.exit semantics. We just route.
// ---------------------------------------------------------------------------

import { cmdCiBitbucket } from "./bitbucket.js";
import { cmdCiGitlab } from "./gitlab.js";

const R = "\x1b[0m";
const RED = "\x1b[31m";
const BLD = "\x1b[1m";

/**
 * Run `chemag ci <provider>`. `argv` is everything after `ci` on the command
 * line (so `argv[0]` is the provider). Exits the process on success or
 * failure — never returns.
 */
export async function cmdCi(argv: string[]): Promise<void> {
  if (argv.length === 0 || argv[0] === "--help" || argv[0] === "-h") {
    printHelp();
    process.exit(argv.length === 0 ? 2 : 0);
  }

  const provider = argv[0];
  const rest = argv.slice(1);

  switch (provider) {
    case "gitlab":
      await cmdCiGitlab(rest);
      return;
    case "bitbucket":
      await cmdCiBitbucket(rest);
      return;
    default:
      console.error(`${RED}Unknown ci provider:${R} ${provider}`);
      console.error(`Run 'chemag ci --help' for the list of supported providers.`);
      process.exit(2);
  }
}

function printHelp(): void {
  console.log(`\n${BLD}chemag ci <provider> [options]${R}\n`);
  console.log("Post chemag results to a CI provider's MR/PR review surface.\n");
  console.log(`${BLD}Providers:${R}`);
  console.log("  gitlab     Post or update a sticky MR comment via the GitLab REST API.");
  console.log("  bitbucket  Post or update a sticky PR comment via the Bitbucket REST API.\n");
  console.log("Run 'chemag ci <provider> --help' for provider-specific options.");
}
