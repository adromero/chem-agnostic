# Contributing

<!-- chemag:contributing:start -->
## chemag — architecture validation

This repository uses [chemag](https://github.com/anthropics/chemag) to enforce its module architecture.

- After every meaningful edit, run `chemag check-edit <path>` for fast single-file feedback.
- A pre-commit hook (`husky`) runs `chemag check --format human` on every commit.
- Architecture rules live in `.cursor/rules/architecture.mdc` (regenerate with `chemag emit-rules --tool cursor`).
<!-- chemag:contributing:end -->
