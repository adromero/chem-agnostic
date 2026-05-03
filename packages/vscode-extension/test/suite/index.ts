// ---------------------------------------------------------------------------
// Mocha bootstrap for vscode-test. @vscode/test-electron loads this module
// inside the extension host, calls `run()`, and waits for the returned
// promise to settle.
// ---------------------------------------------------------------------------

import * as path from "node:path";
import { glob } from "glob";
import Mocha from "mocha";

export async function run(): Promise<void> {
  const mocha = new Mocha({
    ui: "bdd",
    color: true,
    timeout: 30_000,
  });

  const testsRoot = path.resolve(__dirname);
  const files = await glob("**/*.test.js", { cwd: testsRoot });
  for (const f of files) {
    mocha.addFile(path.resolve(testsRoot, f));
  }

  await new Promise<void>((resolve, reject) => {
    try {
      mocha.run((failures: number) => {
        if (failures > 0) reject(new Error(`${failures} test(s) failed`));
        else resolve();
      });
    } catch (err) {
      reject(err);
    }
  });
}
