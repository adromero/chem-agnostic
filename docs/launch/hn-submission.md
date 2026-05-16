# Hacker News submission

## Title (≤ 80 chars)

`Three ESLint rules for hexagonal architecture, plus the bench that failed`

## First comment

A self-comment to provide context, posted immediately after submission:

> Author here. This is a writeup of a negative result: a framework
> built around three semantic rules (PORT-001/003/004) ran a
> pre-registered bench against the rules alone, and the framework lost
> on subjective code-quality even when the rules caught real
> violations.
>
> The three rules are useful — they catch boundary leaks TypeScript
> doesn't (concrete-class imports through barrel chains, adapter
> instantiation outside a composition root). The framework around
> them was wrong shape.
>
> The repo has the full bench data, the rubric we locked before
> running, both run-1 and run-2 results, and the ADR that records the
> pivot. Most framework war-stories don't get published because the
> "we shipped" version sells better. Putting this up because I read a
> lot of those framework wins and they all look the same after a
> while.
>
> The plugin lives at:
> https://www.npmjs.com/package/eslint-plugin-port-discipline
