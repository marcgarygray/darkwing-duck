# Contributing to darkwing-duck

Thanks for your interest. This document covers how to get set up, how to submit changes, and what kinds of contributions are most useful right now.

---

## Setup

```sh
git clone https://github.com/marcgarygray/darkwing-duck.git
cd darkwing-duck
pnpm install
pnpm build
pnpm test
```

Requires Node 20+ and pnpm.

---

## Development workflow

```sh
pnpm build          # compile src/ → dist/
pnpm dev            # watch mode
pnpm test           # run the test suite
pnpm typecheck      # type-check without emitting
```

The test suite runs against the fixtures in `fixtures/`. Each fixture is a self-contained
mini-project that exercises one behaviour. If you're fixing a bug or adding a feature,
add or extend a fixture that demonstrates it.

---

## Adding a fixture

1. Create a new directory under `fixtures/`, e.g. `fixtures/my-case/`.
2. Add a minimal `package.json` (only declare what's needed to demonstrate the case).
3. Add source files under `fixtures/my-case/src/`.
4. Add a test in `tests/integration/analyzer.test.ts` that runs `analyze()` against it
   and asserts the expected result.

Fixtures are intentionally small — the goal is one fixture per edge case, not a realistic
app. Keep them minimal.

---

## Submitting a pull request

1. Fork the repo and create a branch from `main`.
2. Make your changes. If you're fixing a bug, add a failing test first.
3. Run `pnpm test` and `pnpm typecheck` — both must pass.
4. Open a PR against `main`. Describe what problem you're solving and why your approach
   is the right one. Link to any relevant issues.

All PRs require a review from a maintainer before merging. Please don't take it personally
if review takes a few days.

---

## What's in scope

- Bug fixes with a reproducing fixture
- New edge cases that `classify()` gets wrong (false positives or missed phantoms)
- Performance improvements with benchmarks showing the delta
- Documentation improvements

## What's out of scope right now

- Monorepo / workspace support (planned for v2)
- Vue SFC, Svelte, MDX parsing
- A web UI or VS Code extension
- Non-Node runtimes (Deno, Bun)

If you're unsure whether something is a good fit, open an issue before writing code.

---

## Code style

- TypeScript throughout, strict mode
- No comments unless the *why* is non-obvious
- No new abstractions unless the same pattern appears three or more times
- Prefer correctness over cleverness — this tool is used during migrations where a missed
  phantom dep causes a runtime crash

---

## License

By contributing you agree that your changes will be licensed under the project's [MIT license](./LICENSE).
