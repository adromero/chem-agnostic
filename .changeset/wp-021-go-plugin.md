---
"@chemag/plugin-go": minor
"@chemag/cli": patch
---

Go language plugin (WP-021).

New package `@chemag/plugin-go` parallel to `@chemag/plugin-typescript` and `@chemag/plugin-python`. Bundles a Go helper binary (`chemag-go-helper`) doing AST parsing via JSON-RPC over stdio. Prebuilt binaries for darwin/linux/windows × amd64/arm64 ship in the npm tarball under `bin/<os>-<arch>/` — no `go` runtime needed at the user's machine. No `postinstall` script.

Stub generation honors Go conventions: lowercase snake_case files; role-folder = package; the reserved `interface/` role is rewritten to `package iface`. `public.go` re-exports use `type X = innerpkg.X` for type-roles and `var X = innerpkg.X` for value-roles.

`@chemag/cli` registers the new plugin via `plugin-loader.ts`; `chemag init --language go demo` writes `workspace.yaml` + `go.mod` and warns via `checkGoAvailable()` when no Go toolchain is on PATH. Plugin tests skip cleanly when neither the prebuilt binary nor a `go` toolchain is available — same gating pattern as the Python plugin.
