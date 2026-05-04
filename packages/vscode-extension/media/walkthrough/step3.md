# Step 3 — Run your first check

With a workspace open, ask chemag to scan it end-to-end:

1. Open the command palette (`Ctrl+Shift+P` / `Cmd+Shift+P`).
2. Run **chemag: Check workspace**.
3. The extension shells out to `chemag check workspace.yaml`, streams the
   output into the **chemag** output channel, and asks the LSP server to
   re-publish diagnostics for the active editor.

Open the **Problems** panel (`Ctrl+Shift+M` / `Cmd+Shift+M`) to read the
diagnostics. Each one has a stable code (`CHEM-CATEGORY-NNN`) and, where
applicable, a quick-fix code action — look for the lightbulb or hit
`Ctrl+.` / `Cmd+.` on the highlighted range.

Useful follow-ups:

- **chemag: Show graph** — render the compound/bond graph as a Mermaid
  diagram in a side panel.
- **chemag: Add compound** / **chemag: Add unit** — scaffold new code that
  conforms to your `workspace.yaml`.
- **chemag: Where should this go?** — ask chemag to suggest a home for the
  current file based on its imports.

That's the loop: edit, save, read diagnostics, accept a quick-fix, repeat.
You're done with the walkthrough — happy chem-ing.
