# infra/

Runtime infrastructure declarations live here. In the v1.0 reference
monorepo this directory is intentionally a placeholder — the chemag
"infra compounds" feature lands in **WP-058+ (Phase 2)**, which adds
machine-readable infra manifests (Postgres clusters, queue brokers, KV
stores) that participate in the bond and wiring rules.

For now, treat each `apps/*` service as carrying its own ad-hoc infra
config (`.env.example`, `pyproject.toml`, etc.) and revisit this directory
once Phase 2 RFCs land.

Tracking: see `docs/master-plan/STATUS.md` in the outer chemag repo for
the WP-058 status.
