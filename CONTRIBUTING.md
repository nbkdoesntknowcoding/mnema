# Contributing to Mnema

Thanks for your interest in improving Mnema. This document covers how to
contribute and the licensing terms your contributions are made under.

## How this repo is published (please read)

This public repository is a **generated artifact**. The source of truth is a
separate private repository that holds the full product (core + enterprise
modules); this public repo is produced from it by an automated "carve" that strips
the enterprise code, then **force-pushed** as squashed releases. Two consequences,
stated plainly so nothing surprises you:

- **Your PR is reviewed here on GitHub, then ported into the private source** with
  your authorship and sign-off preserved (see the DCO below), and it ships in the
  next carve. We'll keep you posted on the PR.
- Because releases are force-pushed, **contributor branches and history will show
  as force-pushed-over** — that's expected, not a mistake or a lost commit.

If that model doesn't work for a change you have in mind, open an issue first and
we'll figure out the right path.

## Ground rules

- **Be respectful.** Assume good faith; keep discussion technical.
- **One logical change per pull request.** Small, reviewable PRs merge faster.
- **Match the surrounding code.** Follow the existing style, naming, and comment
  density of the files you touch.

## Getting started

Mnema is a pnpm monorepo (`apps/api`, `apps/web`, `packages/*`), Node 22. See the
[README](./README.md) for local setup (Docker, or the "Run it with an AI agent"
prompt). Before opening a PR:

1. `pnpm install`
2. `pnpm -r --filter "./packages/**" build`
3. Build the app(s) you changed (`pnpm --filter @boppl/api build`, `… @boppl/web build`).
4. Run the test suite for the package you touched (`pnpm test`).

For a full local instance, follow the **self-host quickstart** in the [README](./README.md) (Docker Compose) — the app you run locally is the same one this repo publishes.

### Fork → PR (the exact flow)

You contribute by forking and opening a pull request — nobody but the release bot has write access here.

1. Fork this repo (top-right **Fork**), then clone your fork and add upstream:
   ```
   git clone https://github.com/<your-username>/mnema.git
   cd mnema
   git remote add upstream https://github.com/nbkdoesntknowcoding/mnema.git
   ```
2. Branch, make your change, and **sign off** each commit (DCO, below):
   ```
   git checkout -b fix/short-description
   git commit -s -m "fix: short description"
   ```
3. `pnpm install`, then run the checks above for what you touched (including `pnpm test`).
4. Push to your fork and open a PR against `nbkdoesntknowcoding/mnema:main`.

**What happens to your PR:** it is **not** merged on GitHub. Once approved, we port it into our private source-of-truth with your authorship + a `Co-authored-by` line preserved; it ships in the next release carve, and your PR is then closed **with a link to that release**. History on `main` showing as force-pushed-over is normal — your credited commit is safe.

## The core / enterprise boundary

This repository is the **open-core** of Mnema, licensed under the
[Mnema Community License](./LICENSE). The enterprise modules (knowledge graph
engine, meeting intelligence, org/IAM + SSO, audit/admin, multi-tenant) live in a
separate repository and are **not** part of this project.

Please do **not** contribute code here that belongs behind the enterprise seam.
Core code must continue to compile and boot with the enterprise modules absent —
CI enforces this (`verify-core-only`). If you're unsure which side a change
belongs on, open an issue first.

## Developer Certificate of Origin (DCO)

Every commit must be signed off, certifying you wrote the change (or have the
right to submit it) under the license below. Add `-s` to your commit:

```
git commit -s -m "your message"
```

This appends a `Signed-off-by: Your Name <you@example.com>` line, your agreement
to the [DCO](https://developercertificate.org/).

## Contribution License

Mnema is developed under an **open-core** model: the same code is offered both
under the Community License and, for enterprise customers, under a commercial
license. So that the maintainer can continue to offer both, by submitting a
contribution you agree that:

1. You license your contribution to the project and its users under the
   **Mnema Community License** (inbound = outbound); **and**
2. You grant the maintainer a perpetual, worldwide, non-exclusive, royalty-free,
   irrevocable license — with the right to sublicense — to use, reproduce,
   modify, and distribute your contribution as part of Mnema, **including under
   different license terms** (e.g. the commercial Enterprise License).

You retain copyright to your contribution. If you cannot grant these rights
(for example, work owned by your employer), do not submit the contribution until
you can.

## What we'll ask you to rework — or decline

To keep reviews fast and the core clean, these get sent back:

- **Enterprise-adjacent changes.** Anything that belongs behind the enterprise seam
  (graph engine, meetings, org/IAM/SSO, audit/admin) — see the boundary section
  above. Core must build and boot with enterprise absent.
- **Licensing / publishing machinery.** The carve pipeline, license-key mechanics,
  and community-license service are maintained by the team; PRs there won't land.
- **Dependency churn.** New dependencies or version bumps without a clear,
  discussed reason.
- **Drive-by refactors.** Formatting sweeps, renames, or restructuring bundled into
  an unrelated change. One logical change per PR.

When in doubt, open an issue first — we'll point you at the right approach before
you spend time writing code.

## New to the project? (student clubs welcome)

New contributors — including university open-source clubs — are welcome. If this is
your first PR here:

- **Find a foothold.** Start with an issue labeled **`good-first-issue`** or
  **`help-wanted`**. Each one has file pointers, acceptance criteria, and a size
  tag (S/M) so you know what "done" looks like before you begin.
- **Where to talk.** Use GitHub **Issues** — for questions, to propose work, or to
  report a bug. There's no separate chat or portal; the issue thread is the place.
- **Claiming work.** Comment on the issue to say you're taking it. To keep the
  board healthy, there's no assignment squatting: if an issue shows no PR or visible
  progress after **2 weeks**, it reopens for others.
- **Review cadence.** We're a small team. A maintainer will review your PR **within
  one week** — usually sooner. If a week passes with no word, a polite nudge on the
  PR is welcome.

## Reporting security issues

Do **not** open a public issue for security vulnerabilities. See
[SECURITY.md](./SECURITY.md) if present, or contact the maintainer privately.
