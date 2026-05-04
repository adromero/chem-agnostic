# Step 2 — Open a workspace

The chemag extension activates when VS Code opens a folder that contains a
`workspace.yaml` at its root.

1. Open the folder for a project that already has a `workspace.yaml`
   (`File → Open Folder…`). If you don't have one yet, run
   `chemag init <project-name>` from a terminal first to scaffold the
   manifest, then open that folder in VS Code.
2. Wait a moment for the **chemag** activity-bar icon to appear in the
   sidebar — that's the signal that the extension has activated and the
   embedded LSP server is running.
3. Click the activity-bar icon to open the **Architecture** view, which
   shows your compounds, their units, and any active violations as a
   live tree.

If the activity-bar icon does not appear, confirm that `workspace.yaml`
exists at the workspace root and that the file is readable. Reload the
window with **Developer: Reload Window** if needed.

Continue to step 3 to run your first check.
