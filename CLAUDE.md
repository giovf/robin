# Project guidelines for Claude Code

This file is loaded automatically by Claude Code at the start of every session
(both `claude` in the terminal and the IDE extension). Keep it small and
high-signal — it's part of every prompt, so verbosity costs tokens.

## Architecture

- Product/system architecture lives in `docs/ARCHITECTURE.md` (imported
  below). That file tracks the PRD (`.taskmaster/docs/prd.md`); this file is
  conventions and practices only — keep PRD-specific detail out of here.

## Stack

- **Framework**: Next.js 16 (App Router, `src/` dir, Turbopack) — hub UI + API in
  one codebase. Next 16 has breaking changes: read `node_modules/next/dist/docs/`
  before writing framework code (see `AGENTS.md`).
- **Styling**: Tailwind CSS 4
- **Database**: PostgreSQL + pgvector, Drizzle ORM
- **Package manager**: npm (don't switch to pnpm/yarn without asking)
- **Language**: TypeScript everywhere — strict mode

## Commands

- `npm run dev` — dev server on http://localhost:3000
- `npm run tunnel` — free Cloudflare quick tunnel to the dev server (public
  address for Recall.ai webhooks; put it in `WEBHOOK_BASE_URL`)
- `npm run build` — production build
- `npm run typecheck` — `next typegen && tsc --noEmit`
- `npm run lint` — ESLint
- `npm run format` / `npm run format:check` — Prettier
- `npm test` / `npm run test:watch` — Vitest; needs local Postgres, uses a
  throwaway `robin_test` database (never the dev database)
- `npm run db:generate` / `db:generate:customer` — generate migrations for the
  control-plane / customer schema; `npm run db:migrate` applies control-plane
- Local Postgres starts with the container
  (`postgres://robin:robin@localhost:5432/robin`); if it is down, run
  `bash .devcontainer/post-start.sh`.

## Conventions

- All new code in TypeScript with explicit return types on exported functions
- No `any`, no `// @ts-ignore` without a comment explaining why
- Prefer named exports over default exports
- Next.js files that require a default export (`page.tsx`, `layout.tsx`,
  `route.ts` handlers, config files) are the only exception to named exports
- Import from `src/` with the `@/` alias
- Server Components by default; add `"use client"` only where interactivity
  needs it
- Design tokens live in `src/app/globals.css` (Tailwind 4 `@theme`); use the
  frontend-design plugin for UI work
- **Customer isolation is a hard rule**: customer-scoped code gets its database
  connection only through the customer-connection resolver — never query one
  customer's database from another customer's context, and never put customer
  content in the control-plane database

## Working loop (mandatory — applies even if the user doesn't mention Taskmaster)

A **functional change** is anything that changes behaviour: features, bug
fixes, behaviour-changing refactors, new deps, schema/API changes. Docs-only,
formatting, typo fixes and answering questions are exempt. For every
functional change, before writing code:

1. **File it** — reuse the task that already covers it, otherwise
   `task-master add-task --prompt="<what and why>"`.
2. **Score it** — `task-master analyze-complexity --id=<id> --threshold=7`,
   then read the score with `task-master complexity-report`.
3. **Split if > 6/10** — `task-master expand --id=<id>` (uses the report's
   recommended subtask count). Then work subtask by subtask.
4. **Check the blueprint** — does the change alter scope, features, data
   model, stack, external services or the out-of-scope list? If so, update
   `.taskmaster/docs/prd.md` and add a dated entry to its `## Changelog`;
   if a stable decision changed, update `docs/ARCHITECTURE.md` too. Changes
   to approved scope need the user's OK first.
5. **Implement** — `set-status --status=in-progress`, log notes with
   `task-master update-subtask`, verify (typecheck/lint/tests — not "should
   work"), then `set-status --status=done`.

- Never hand-edit `.taskmaster/tasks/tasks.json` — use the CLI/MCP tools.
- Don't commit `node_modules/`, `.taskmaster/reports/`, or anything in
  `.gitignore`.

## Dependencies

- Add deps with `npm install <pkg>@latest` (or the scaffolder's `@latest`);
  never hand-type version numbers. The lockfile provides reproducibility.

## Things to ask before doing

- Adding a new top-level dependency
- Changing the package manager
- Modifying anything inside `.devcontainer/`
- Deploying, publishing, or submitting to any store/registry
- Signing up for, or making calls that cost money on, paid services
  (Recall.ai, Anthropic API, transcription, embeddings)
- Sending a real meeting bot into a call
- Writing to a customer system (Confluence, Jira, email)
- Dropping a customer database, or running migrations against non-local databases

## Product architecture

**Import the architecture overview; treat as if inlined here.**
@./docs/ARCHITECTURE.md

## Task Master AI Instructions

**Import Task Master's development workflow commands and guidelines, treat as if import is in the main CLAUDE.md file.**
@./.taskmaster/CLAUDE.md

## graphify

This project has a knowledge graph at graphify-out/ with god nodes, community structure, and cross-file relationships.

Rules:
- When graphify-out/graph.json exists, run `graphify query "<question>"` before your first grep, search or source-file read for a codebase question, and put this rule in every subagent prompt that explores code. Read raw files only for lines the graph or an earlier read already located. Use `graphify path "<A>" "<B>"` for relationships and `graphify explain "<concept>"` for focused concepts. These return a scoped subgraph, usually much smaller than GRAPH_REPORT.md or raw grep output.
- If graphify-out/wiki/index.md exists, use it for broad navigation instead of raw source browsing.
- Read graphify-out/GRAPH_REPORT.md only for broad architecture review or when query/path/explain do not surface enough context.
- After modifying code, run `graphify update .` to keep the graph current (AST-only, no API cost).
- A committed graphify-out/graph.json is rewritten whole on every build, so a large diff to it in a pull request is expected. Do not flag it as churn or suggest skipping the graph rebuild or its hooks.
