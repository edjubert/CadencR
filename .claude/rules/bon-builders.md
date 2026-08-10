---
paths:
  - "**/*.rs"
---

Cadencr is progressively standardizing Rust construction APIs on [`bon`](https://bon-rs.com/).

- New or modified builder-style APIs must use `bon` (`#[derive(bon::Builder)]`, `#[bon::builder]`, or `#[bon::bon]`) instead of handwritten builders.
- Use a `bon` builder when positional construction would be ambiguous (especially several same-typed, optional, or defaulted values). Keep straightforward constructors with only one or two unambiguous inputs.
- When substantially changing an existing handwritten builder or long positional constructor, migrate it to `bon` in the same change; do not mass-rewrite unrelated code.
- Preserve existing defaults, invariants, visibility, and conversion ergonomics during migration, and test the generated construction API.
- Keep `bon.workspace = true` in every Rust package manifest; the version is centralized in the root `Cargo.toml`.
