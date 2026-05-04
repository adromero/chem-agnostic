// ---------------------------------------------------------------------------
// wp-026f: First-run walkthrough + marketing-asset structural checks.
//
// These assertions are pure filesystem + JSON checks against the package.json
// shipped in the .vsix. They deliberately do NOT touch the vscode API:
//   - VS Code's `vscode-test` harness does not drive the "Get Started" page,
//     so end-to-end walkthrough rendering is verified manually.
//   - We CAN cheaply assert the contribution shape and asset existence here,
//     which catches the most common regressions:
//       1. Walkthrough id drift (deep links break silently).
//       2. Step count drift (the plan locks the count at 3 — not arbitrary).
//       3. Missing media files (broken images / 404 markdown in the panel).
//       4. Icon-slot conflation: top-level `icon` is the Marketplace tile
//          (PNG); `contributes.viewsContainers.activitybar[].icon` MUST stay
//          SVG (CSS-masked for theme adaptation). Conflating the two breaks
//          the activity bar.
// ---------------------------------------------------------------------------

import * as assert from "node:assert/strict";
import * as fs from "node:fs";
import * as path from "node:path";

// Resolve the extension root from the compiled-test location:
//   <ext>/out/test/suite/walkthrough.test.js → <ext>
const EXTENSION_ROOT = path.resolve(__dirname, "..", "..", "..");

function loadPackageJson(): Record<string, unknown> {
  const pkgPath = path.join(EXTENSION_ROOT, "package.json");
  const raw = fs.readFileSync(pkgPath, "utf8");
  return JSON.parse(raw) as Record<string, unknown>;
}

suite("chemag walkthrough + marketing assets (wp-026f)", () => {
  test("package.json declares chemag.gettingStarted walkthrough with exactly 3 steps", () => {
    const pkg = loadPackageJson();
    const contributes = pkg.contributes as Record<string, unknown> | undefined;
    assert.ok(contributes, "package.json must have a contributes block");

    const walkthroughs = contributes.walkthroughs as Array<Record<string, unknown>> | undefined;
    assert.ok(Array.isArray(walkthroughs), "contributes.walkthroughs must be an array");
    assert.ok(walkthroughs.length >= 1, "at least one walkthrough must be contributed");

    const gettingStarted = walkthroughs.find((w) => w.id === "chemag.gettingStarted");
    assert.ok(
      gettingStarted,
      "a walkthrough with id 'chemag.gettingStarted' must exist (deep links depend on this id)",
    );

    const steps = gettingStarted.steps as Array<Record<string, unknown>> | undefined;
    assert.ok(Array.isArray(steps), "walkthrough must declare a steps[] array");
    assert.equal(steps.length, 3, `walkthrough must have exactly 3 steps (got ${steps.length})`);
  });

  test("every walkthrough step's media.markdown and media.image exist on disk", () => {
    const pkg = loadPackageJson();
    const walkthroughs = (pkg.contributes as Record<string, unknown>).walkthroughs as Array<
      Record<string, unknown>
    >;
    const gettingStarted = walkthroughs.find((w) => w.id === "chemag.gettingStarted");
    assert.ok(gettingStarted);
    const steps = gettingStarted.steps as Array<Record<string, unknown>>;

    for (const step of steps) {
      const stepId = String(step.id);
      const media = step.media as Record<string, unknown> | undefined;
      assert.ok(media, `step ${stepId} must declare a media block`);

      const markdown = media.markdown as string | undefined;
      assert.ok(markdown, `step ${stepId} must declare media.markdown`);
      const markdownPath = path.join(EXTENSION_ROOT, markdown);
      assert.ok(
        fs.existsSync(markdownPath),
        `step ${stepId} markdown not found on disk: ${markdownPath}`,
      );

      const image = media.image as string | undefined;
      assert.ok(image, `step ${stepId} must declare media.image`);
      const imagePath = path.join(EXTENSION_ROOT, image);
      assert.ok(fs.existsSync(imagePath), `step ${stepId} image not found on disk: ${imagePath}`);
    }
  });

  test("top-level icon field equals media/icon.png and the file exists", () => {
    const pkg = loadPackageJson();
    assert.equal(
      pkg.icon,
      "media/icon.png",
      "top-level icon (Marketplace tile) must be media/icon.png",
    );
    const iconPath = path.join(EXTENSION_ROOT, "media", "icon.png");
    assert.ok(fs.existsSync(iconPath), `icon.png missing on disk: ${iconPath}`);
    // Verify PNG magic — `vsce package` rejects malformed icons.
    const head = fs.readFileSync(iconPath).slice(0, 8);
    const expectedMagic = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);
    assert.ok(head.equals(expectedMagic), "media/icon.png must start with the PNG magic bytes");
  });

  test("activity-bar icon stays media/icon.svg (regression guard against icon-slot conflation)", () => {
    const pkg = loadPackageJson();
    const containers = (
      (pkg.contributes as Record<string, unknown>).viewsContainers as Record<string, unknown>
    ).activitybar as Array<Record<string, unknown>>;
    assert.ok(Array.isArray(containers) && containers.length >= 1);
    assert.equal(
      containers[0].icon,
      "media/icon.svg",
      "activity-bar icon MUST remain SVG — VS Code requires SVG for theme-masked activity-bar icons",
    );
    const svgPath = path.join(EXTENSION_ROOT, "media", "icon.svg");
    assert.ok(fs.existsSync(svgPath), `icon.svg missing on disk: ${svgPath}`);
  });

  test("getting-started.md (overview) ships under media/walkthrough/", () => {
    // Not directly referenced by a contribution slot, but the README links to
    // the walkthrough by id; the overview file is the canonical landing page
    // surfaced by VS Code when the walkthrough opens. Regression guard
    // against an accidental relocation back to src/walkthrough/ (which the
    // .vsix would strip).
    const overview = path.join(EXTENSION_ROOT, "media", "walkthrough", "getting-started.md");
    assert.ok(fs.existsSync(overview), `overview markdown missing: ${overview}`);
    const stray = path.join(EXTENSION_ROOT, "src", "walkthrough");
    assert.ok(
      !fs.existsSync(stray),
      "src/walkthrough/ must not exist — .vscodeignore strips src/** from the .vsix",
    );
  });
});
