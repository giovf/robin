# Robin — Architecture

> Derived from `.taskmaster/docs/prd.md`. This file holds the _stable_
> architectural decisions and is loaded into every Claude session via
> CLAUDE.md. When the PRD changes, update **this** file — not `CLAUDE.md`.
> Volatile detail (full data model, phasing, open questions) stays in the PRD;
> this is the always-loaded summary.

## What we're building

Robin is an AI copilot for software architects. It listens to live customer
calls and suggests questions in real time, is grounded in each customer's
context (email, documents, past transcripts), and drafts solution and
life-cycle documentation and diagrams. Everything is managed from an operations
hub web UI, per customer and per solution. v1 has a single user.

**Two hard requirements:** (1) every customer is completely isolated — its own
database and its own agent instance, nothing shared; (2) login and user/org
ownership are in the data model from day one, even though v1 is single-user.

## Repo layout

- `src/app/` — Next.js App Router: pages, layouts, route handlers (API, webhooks)
- `src/db/control-plane/` — control-plane Drizzle client (`connection.ts`,
  `getControlPlaneDb()`) and schema
- `src/db/customer/schema/` — schema applied to every customer database
- `drizzle.config.ts` / `drizzle.customer.config.ts` — the two migration
  tracks; generated SQL lands in `drizzle/control-plane` and `drizzle/customer`
- `public/` — static assets
- `docs/` — this file
- `.taskmaster/` — PRD (`docs/prd.md`), raw scope (`docs/scope.md`), task backlog
- `.devcontainer/` — dev container; `post-start.sh` starts local Postgres
- `graphify-out/` — generated code graph (git-ignored)

Further `src/` structure (database, agents, integrations) is set by the tasks
that introduce it — record it here when it exists.

## Stack

- Next.js 16 (App Router, Turbopack), React 19, TypeScript strict — hub UI and
  API in one codebase
- Tailwind CSS 4
- PostgreSQL + pgvector, Drizzle ORM
- npm; ESLint + Prettier

## Backend & data

- **Control-plane database `robin`:** users, organisations, memberships, the
  customer registry, integration connections (encrypted OAuth tokens). Holds
  **no customer content**.
- **One PostgreSQL database per customer** (with pgvector): solutions, calls,
  transcripts, documents, ingested sources, embeddings, and that customer's
  agent configuration and memory.
- **Access rule:** customer-scoped code obtains a database connection only
  through the customer-connection resolver, which checks ownership first.
- **Agent:** one agent instance per customer, built on Claude; its prompts and
  retrieval read only that customer's database.
- **Migrations:** two Drizzle tracks — control plane, and customer schema
  (applied to every customer database on provisioning and on upgrade).
- **Auth:** login required; every customer belongs to an organisation. No org
  management or permissions in v1.

## External services

Each sits behind an adapter/interface so it can be faked in tests and swapped.

- Anthropic API (Claude) — LLM for all agent work
- Recall.ai — visible meeting bot (Zoom/Meet/Teams) + real-time transcript
  webhooks; paid
- Transcription — Recall.ai built-in or Deepgram (undecided, see PRD)
- Embeddings provider — undecided, see PRD
- Google OAuth — Gmail, Drive, Calendar (read)
- Atlassian OAuth — Confluence, Jira (read; writes only after user review and
  explicit confirmation)

## Compliance & accessibility

- Call-recording consent: visible bot; user acknowledges a consent reminder
  before it joins; acknowledgement stored with the call.
- GDPR treated as applicable: ingest only selected sources, per-customer export
  and deletion, encrypted tokens, record of third-party processors.
- Accessibility target: WCAG 2.1 AA.

## Out of scope for v1 (do not scope-creep without re-baselining)

- Mobile app, desktop app
- Billing and multi-org SaaS features (invitations, roles, org management UI)
- Automatic writes to customer systems (Confluence, Jira, email) without the
  user's review
- Microsoft 365, Slack and other integrations beyond Google, Confluence, Jira
