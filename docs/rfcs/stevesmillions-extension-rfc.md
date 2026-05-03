# RFC: Extending `chem-agnostic` For Real Monorepo Delivery Work

## Status

Draft

## Motivation

`product-stevesmillions` used `chem-ag` successfully as a workspace and architecture validation layer, but the project also exposed several gaps between clean compound-boundary checking and the realities of a delivery-oriented monorepo.

The main issue is not that `chem-ag` failed at its current job. The issue is that important architectural surfaces in a real project live outside the current model:

- migration-era compatibility shims
- Alembic migrations
- repo-root scripts and data workflows
- generated OpenAPI and contract artifacts
- static frontend assets and cross-workspace dependencies
- deployment topology and runtime units
- policy boundaries such as inference-safe vs training-only reads

This RFC proposes targeted extensions so `chem-agnostic` can remain an architecture tool while becoming more useful for projects like this one.

## Goals

- Improve support for staged migrations instead of assuming a greenfield structure
- Model real operational and generated-artifact surfaces without turning `chem-ag` into a build system
- Add policy-aware checks, not just import-boundary checks
- Improve monorepo and cross-workspace validation
- Keep the tool focused on architecture and delivery integrity

## Non-Goals

- Replacing Docker, CI, or build tooling
- Validating business logic correctness
- Becoming a secrets-management system
- Taking over frontend framework concerns
- Performing deep runtime or security audits

## What This Project Exposed

### 1. Transitional architecture is real

The project spent multiple stages with temporary compatibility shims, relocated packages, and mixed old/new paths. The current model can validate the final shape, but it does not express intentional temporary states well.

### 2. Operational surfaces matter architecturally

The project depends heavily on:

- repo-root `scripts/`
- Alembic migrations
- generated contracts
- CI checks
- deployment topology

These are not just incidental files. They define how the system is built, validated, and operated.

### 3. Import boundaries were not enough

The project has a meaningful distinction between:

- inference-safe product reads
- training-only target-bearing surfaces

That is a policy boundary, not only an import boundary.

### 4. Cross-workspace relationships matter

The project now has:

- `apps/api`
- `apps/web`
- `packages/contracts`
- `infra`

The allowed dependency directions across these workspaces are part of the architecture.

### 5. Generated artifacts need provenance

Backend schema changes generate OpenAPI, which then generates contracts. Drift between source schemas and committed generated artifacts should be architecture-visible, not just a handwritten CI convention.

## Proposed Extensions

## Proposal 1: Transitional Architecture Mode

Add explicit support for temporary architecture exceptions that are known, bounded, and expected to disappear.

### Use cases

- compatibility shims during monorepo relocation
- temporary bridging imports during domain extraction
- staged migrations where old and new module locations coexist briefly

### Suggested config shape

```yaml
transitional_rules:
  - id: root-app-compat-shim
    kind: compatibility_shim
    paths:
      - ./app/__init__.py
    rationale: Preserve legacy imports during backend relocation
    expires_after: stage-2
```

### Suggested checks

- transitional rule paths must exist
- transitional rules must include rationale
- expired rules should fail `check`
- transitional rules should be reported prominently, not hidden

### Why this matters

This keeps migration work explicit instead of forcing teams to choose between noisy failures and undocumented exceptions.

## Proposal 2: Generated Artifact Declarations

Add a first-class way to declare source-to-generated pipelines.

### Use cases

- FastAPI schemas -> OpenAPI artifact -> generated contracts
- architecture reports generated from workspace manifests
- codegen outputs that should never drift from declared source

### Suggested config shape

```yaml
generated_artifacts:
  - id: contracts
    sources:
      - ./apps/api/app/api
    intermediate:
      - ./packages/contracts/openapi.json
    outputs:
      - ./packages/contracts/index.js
      - ./packages/contracts/index.d.ts
      - ./packages/contracts/package.json
    regeneration_hint:
      - python scripts/export_openapi.py
      - python scripts/generate_contracts.py
```

### Suggested checks

- declared outputs exist
- generated outputs are not edited directly if regeneration output differs
- drift checks can be surfaced as a native architecture result
- source and output relationships are visible in reports

### Why this matters

Generated contracts are part of the public system boundary. They should not be treated as an afterthought.

## Proposal 3: Policy Zones

Add architecture-level policy declarations for data exposure and allowed consumers.

### Use cases

- product endpoints may read only inference-safe panels
- routes used for product ranking must never touch target-bearing tables
- admin workflows may call pipeline orchestration, while general product routes may not

### Suggested config shape

```yaml
policy_zones:
  - id: inference_safe
    paths:
      - ./apps/api/app/api/routes/product.py
      - ./scripts/build_model_panel.py
    rules:
      deny_dependencies:
        - training_targets

  - id: training_targets
    paths:
      - ./scripts/build_forward_targets.py
      - ./apps/api/app/models/entities.py#targets_forward_returns
```

### Suggested checks

- denied dependency edges fail `check`
- product-facing surfaces can be validated against target-bearing paths
- reports can distinguish import violations from policy violations

### Why this matters

Real systems often require semantic safety guarantees, not just folder discipline.

## Proposal 4: Operational Surface Modeling

Add declared operational surfaces for migrations, scripts, CI, and deployment assets.

### Use cases

- Alembic is part of the architecture
- pipeline scripts should be classified and governed
- deployment assets should be visible as runtime topology, not orphan files

### Suggested config shape

```yaml
operational_surfaces:
  migrations:
    paths:
      - ./apps/api/alembic
  scripts:
    paths:
      - ./scripts
  deployment:
    paths:
      - ./infra
      - ./docker-compose.yml
  ci:
    paths:
      - ./.github/workflows
```

### Suggested checks

- required operational surfaces must exist once declared
- scripts can be categorized and validated
- migrations and deployment docs can be referenced as owned surfaces

### Why this matters

This lets `chem-ag` describe the architecture teams actually operate.

## Proposal 5: Script Types And Ownership

Add explicit script classification.

### Use cases

- ingestion scripts
- feature-generation scripts
- admin/export scripts
- deployment scripts

### Suggested config shape

```yaml
script_types:
  - path: ./scripts/build_daily_prices.py
    type: ingestion
  - path: ./scripts/run_research_pipeline.py
    type: orchestration
  - path: ./scripts/export_openapi.py
    type: artifact_export
```

### Suggested checks

- orchestration scripts may depend on multiple script types
- ingestion scripts may not import product UI code
- export scripts may only write to declared generated-artifact paths

### Why this matters

Scripts are often where architecture discipline quietly breaks down.

## Proposal 6: Runtime Unit Declarations

Add a way to declare deployable runtime units.

### Use cases

- API
- scheduler
- reverse proxy
- worker

### Suggested config shape

```yaml
runtime_units:
  - id: api
    paths:
      - ./apps/api
  - id: scheduler
    paths:
      - ./scripts/run_research_pipeline.py
      - ./infra/docker/scheduler-entrypoint.sh
  - id: proxy
    paths:
      - ./infra/nginx/default.conf
```

### Suggested checks

- declared runtime units must map to real files
- docs and deployment assets should reference valid runtime units
- missing declared topology components should fail validation

### Why this matters

Architecture is partly about what gets deployed, not only what imports what.

## Proposal 7: Cross-Workspace Dependency Rules

Add native cross-workspace dependency validation.

### Use cases

- `apps/web` may depend on `packages/contracts`
- `apps/web` may not depend directly on backend implementation code
- `infra` may reference runtime units but not import app internals

### Suggested config shape

```yaml
cross_workspace_dependencies:
  - from: apps/web
    allow:
      - packages/contracts
    deny:
      - apps/api/app
```

### Suggested checks

- invalid cross-workspace imports fail
- generated-contract usage can be preferred over duplicated DTOs
- reports can show dependency direction at workspace granularity

### Why this matters

Monorepo structure is only useful if dependency direction is enforced.

## Proposal 8: CI Check Synthesis

Allow `chem-ag` to recommend or emit a standard validation bundle based on workspace declarations.

### Use cases

- compile checks
- contracts drift
- architecture check
- migration SQL validation

### Possible scope

This should probably remain advisory or generative, not become a full CI engine.

### Why this matters

It reduces drift between declared architecture and handwritten CI expectations.

## Proposal 9: Documentation Completeness Hints

Add optional docs expectations once certain capabilities are declared.

### Example

If a workspace declares:

- generated artifacts
- runtime units
- deployment surfaces

then `chem-ag` can recommend or require:

- deployment docs
- runbook docs
- contracts pipeline docs

### Why this matters

Operational architecture without docs is not stable architecture.

## Prioritization

### Highest priority

1. Transitional architecture mode
2. Generated artifact declarations
3. Policy zones
4. Cross-workspace dependency rules

### Medium priority

5. Operational surface modeling
6. Script types and ownership
7. Runtime unit declarations

### Lower priority

8. CI synthesis helpers
9. Documentation completeness hints

## Suggested Implementation Order

### Phase 1

- transitional rules
- generated artifact declarations
- cross-workspace dependency rules

### Phase 2

- policy zones
- script types
- operational surfaces

### Phase 3

- runtime units
- CI synthesis helpers
- docs completeness hints

## Risks

- Over-modeling operational concerns until `chem-ag` becomes a build tool
- Adding policy semantics that are too vague to validate reliably
- Making config too heavy for smaller projects

## Risk Controls

- Keep each new concept declarative and narrowly scoped
- Prefer validation and reporting over orchestration
- Make advanced features optional
- Separate architecture checks from implementation/security checks

## Concrete Lessons From `product-stevesmillions`

- Temporary migration states need explicit representation
- Generated contracts are architectural assets
- Repo-root scripts are part of the architecture
- Inference-safe boundaries are a meaningful architecture concept
- Runtime topology belongs in the architecture conversation
- Path/root assumptions should be visible and validated

## Recommendation

Extending `chem-agnostic` makes sense, but only around durable monorepo delivery concerns:

- staged migration support
- generated artifact provenance
- policy-aware architecture boundaries
- cross-workspace dependency validation
- operational surface visibility

It does not make sense to turn it into a general deployment framework, security scanner, or application runtime.

## Proposed Output Of A First Follow-Up

A practical next step for `chem-agnostic` would be a small implementation spike covering only:

1. `transitional_rules`
2. `generated_artifacts`
3. `cross_workspace_dependencies`

That would test the highest-value ideas without committing the project to a much broader redesign.
