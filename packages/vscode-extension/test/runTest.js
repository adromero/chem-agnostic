// ---------------------------------------------------------------------------
// VS Code extension test runner. Boots @vscode/test-electron against the
// fixture workspace.
//
// Headless-Linux requirement: @vscode/test-electron launches a real Electron
// process which needs an X11 display. On Linux without DISPLAY, this script
// re-execs itself under `xvfb-run -a`. The CHEMAG_TEST_NO_XVFB sentinel
// prevents a re-exec loop (the inner process inherits DISPLAY from xvfb-run,
// but we set the sentinel anyway as belt-and-braces).
//
// If xvfb-run isn't installed (e.g. dev workstation without xvfb), exit 2
// with an actionable message instead of crashing.
// ---------------------------------------------------------------------------

const path = require("node:path");

function reexecUnderXvfb() {
  const { spawn } = require("node:child_process");
  const child = spawn("xvfb-run", ["-a", "node", __filename], {
    stdio: "inherit",
    env: { ...process.env, CHEMAG_TEST_NO_XVFB: "1" },
  });
  child.on("exit", (code) => process.exit(code ?? 1));
  child.on("error", (err) => {
    if (err.code === "ENOENT") {
      // SKIP path — exit 0 so the workspace-level `pnpm test` stays green on
      // dev machines without xvfb. CI environments install xvfb (it's
      // pre-installed on ubuntu-latest GHA runners) and will run for real.
      // Override by setting CHEMAG_REQUIRE_XVFB=1 to force a hard failure.
      const msg =
        "chemag: xvfb-run not found. SKIPPING vscode-extension tests. " +
        "Install xvfb (e.g. `sudo apt-get install xvfb`) or set DISPLAY to run them.";
      console.warn(msg);
      if (process.env.CHEMAG_REQUIRE_XVFB === "1") {
        console.error("CHEMAG_REQUIRE_XVFB=1 — failing instead of skipping.");
        process.exit(2);
      }
      process.exit(0);
    }
    console.error(err);
    process.exit(1);
  });
}

function runVsCodeTests() {
  const { runTests } = require("@vscode/test-electron");

  const extensionDevelopmentPath = path.resolve(__dirname, "..");
  const extensionTestsPath = path.resolve(__dirname, "..", "out", "test", "suite");
  const fixtureWorkspace = path.resolve(__dirname, "fixtures/sample-workspace");

  runTests({
    extensionDevelopmentPath,
    extensionTestsPath,
    launchArgs: [fixtureWorkspace],
  }).catch((err) => {
    console.error("Failed to run tests:", err);
    process.exit(1);
  });
}

if (process.platform === "linux" && !process.env.DISPLAY && !process.env.CHEMAG_TEST_NO_XVFB) {
  reexecUnderXvfb();
} else {
  runVsCodeTests();
}
