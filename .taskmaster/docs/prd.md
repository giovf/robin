<context>

# Overview

Robin is an AI copilot for software architects. An architect running customer engagements
has to keep a great deal in their head during a call: what the customer already said, what
is in the discovery documents and the inbox, and which questions still need answering before
a solution can be designed. Robin listens to live customer calls and shows, in real time,
the questions the architect should ask next, tailored to the phase of the engagement.

Robin is grounded in each customer's own context: email, discovery and documentation files,
and transcripts of earlier calls. From that context it drafts solution documentation and
diagrams, and — once a solution goes ahead — documentation for each life-cycle phase.

The centre of the product is an operations hub: a web UI where every customer, and every
solution for that customer, is managed separately. Robin integrates with the tools the
architect already uses (Google Workspace, Confluence, Jira).

**Who it is for:** in v1, one software architect (the owner) working across several
customers. The design must allow growth to multiple users and organisations later.

**Hard requirements**

1. **Per-customer isolation.** Each customer's Robin is completely independent: its own
   data store and its own AI agent instance (configuration, memory, context). Nothing is
   shared between customers.
2. **Single user now, multi-user later.** v1 has one user, but login and user/organisation
   ownership are in the data model from day one.

# Core Features

## 1. Operations hub

- **What:** the home UI. A list of customers; each customer has its solutions, calls,
  documents, context sources and integration connections. Create, view, edit and archive
  customers and solutions.
- **Why:** it is the single place the architect manages engagements, and the entry point to
  every other feature.
- **How:** Next.js App Router pages backed by the control-plane database (customer registry)
  and, once inside a customer, that customer's own database.

## 2. Per-customer isolation and provisioning

- **What:** creating a customer provisions a dedicated PostgreSQL database (with pgvector)
  and a dedicated agent instance. Archiving/deleting a customer removes or retires them.
- **Why:** hard requirement — a customer's data and agent must never mix with another's. It
  also makes per-customer deletion and export straightforward (GDPR).
- **How:** a control-plane database `robin` holds users, organisations, the customer
  registry (including how to reach each customer database) and integration connections.
  Every customer-scoped request resolves the customer, checks ownership, then opens a
  connection to that customer's database only. The agent instance is a per-customer
  configuration + memory + retrieval scope stored in the customer database; prompts and
  retrieval for one customer can only read that database.

## 3. Customer context ingestion

- **What:** bring a customer's context into their store: emails (Gmail), files (Google
  Drive, direct upload), Confluence pages, Jira issues, and transcripts of past calls.
- **Why:** question suggestions and documents are only useful if they are grounded in what
  is actually known about the customer.
- **How:** per customer, the user selects which sources belong to it (e.g. Gmail
  labels/addresses/domains, Drive folders, a Confluence space, a Jira project). Content is
  fetched read-only, chunked, embedded and stored in the customer's pgvector store with
  source references. Sync is manual or periodic.

## 4. Live call assistant

- **What:** a meeting bot joins a Zoom / Google Meet / Microsoft Teams call; Robin shows the
  live transcript and a stream of suggested questions for the architect to ask.
- **Why:** this is the headline feature — help in the moment, not after the call.
- **How:** the user starts a call session for a customer + solution and gives the meeting
  link. Recall.ai sends a visible bot to the meeting and delivers real-time transcript
  events to Robin's webhook. The customer's agent combines the rolling transcript, the
  solution's current phase, and retrieved customer context to produce suggested questions,
  streamed to the browser. Suggestions can be marked asked/dismissed. At the end of the call
  the full transcript is stored in the customer database and added to the context.
- **Consent:** the bot is visible and named; the UI reminds the user to obtain recording
  consent before the bot joins (see Compliance).

## 5. Solution documentation and diagrams

- **What:** generate and maintain solution documents (e.g. discovery summary, requirements,
  solution architecture, decision records) and diagrams for a solution.
- **Why:** turns the gathered context into the architect's actual deliverables.
- **How:** the customer's agent drafts documents from retrieved context using document
  templates; the user reviews and edits them in the hub. Documents are versioned and stored
  in the customer database with citations back to sources. Diagrams are generated as
  diagram-as-code and rendered in the hub (format: see Open questions).

## 6. Life-cycle phase documentation

- **What:** each solution moves through phases. Once a solution is marked as going ahead,
  Robin produces the documentation set for each subsequent phase.
- **Why:** keeps documentation current through delivery rather than stopping at the proposal.
- **How:** a solution has a current phase; each phase has a set of document templates.
  Entering a phase offers to generate that phase's documents. The phase also steers the
  live-call question suggestions. (The exact phase list is an open question.)

## 7. Integrations

- **v1:** Google (Gmail, Drive, Calendar), Confluence, Jira.
- **What:** OAuth connections managed in the hub. Reading for context ingestion; Calendar to
  find upcoming customer meetings and their meeting links; publishing generated documents to
  Confluence / creating Jira issues **only** as a user-reviewed, explicitly confirmed action.
- **Why:** Robin has to live where the architect's information already is.
- **How:** each integration sits behind an adapter interface (connect, list sources, fetch,
  publish) so later integrations (Microsoft 365, Slack) plug in the same way. Tokens are
  stored encrypted in the control-plane database.

## 8. Login and ownership

- **What:** the user signs in; every customer belongs to an organisation, every organisation
  has members.
- **Why:** required so multi-user / multi-org can be added later without a data migration.
- **How:** v1 has one user and one organisation created at first sign-in. No organisation
  management UI, invitations or permissions in v1.

# User Experience

**Persona:** a software architect (solutions/enterprise architect or consultant) running
several customer engagements at once, comfortable with technical tools.

**Key flows**

1. **Set up a customer:** sign in → New customer → Robin provisions its database and agent →
   connect/select context sources (Gmail scope, Drive folder, Confluence space, Jira
   project) → first sync.
2. **Create a solution:** inside a customer → New solution → name, description, starting
   phase.
3. **Run a call:** open the solution → Start call → paste the meeting link (or pick an
   upcoming Calendar event) → confirm consent reminder → bot joins → live view with
   transcript on one side and suggested questions on the other → mark questions asked or
   dismissed → End call → transcript saved.
4. **Produce documents:** open the solution → Generate document → pick a template → review
   and edit the draft → optionally publish to Confluence after an explicit confirmation.
5. **Advance the life cycle:** mark the solution as going ahead / move to the next phase →
   Robin offers that phase's documentation set.

**UI/UX considerations**

- The current customer is always visible; switching customers is an explicit action, so it
  is never ambiguous whose data is on screen.
- The live call view is designed for glancing: few, short, prioritised questions; no layout
  shifts while the user is reading.
- Every generated statement that comes from customer context shows its source.
- Nothing is written to a customer system without a review screen and a confirm action.
- Desktop browser first; accessible to WCAG 2.1 AA as a target.

</context>
<PRD>

# Technical Architecture

## System components

- **Web app (hub UI + API):** one Next.js (App Router) codebase, TypeScript strict,
  Tailwind CSS. Server-side route handlers / server actions form the API; webhooks from
  Recall.ai arrive at route handlers.
- **Control-plane database `robin`:** PostgreSQL. Users, organisations, memberships, the
  customer registry, integration connections (encrypted tokens), and provisioning state.
  Holds no customer content.
- **Customer databases:** one PostgreSQL database per customer, each with pgvector.
  Solutions, phases, calls, transcripts, documents and versions, ingested source items,
  chunks + embeddings, agent configuration and agent memory.
- **Database access:** Drizzle ORM. Two schema sets and two migration tracks: control plane,
  and customer (applied to every customer database on provisioning and on upgrade). A single
  resolver maps an authenticated request + customer id to a customer-database connection;
  customer-scoped code can only obtain a connection through it.
- **Agent layer:** per-customer agent instance built on Claude (Anthropic API). Each
  instance has its own configuration, memory and retrieval scope, all in that customer's
  database. Three jobs: live question suggestion, document drafting, phase documentation.
- **Call capture:** Recall.ai meeting bot (Zoom / Meet / Teams) with real-time transcript
  delivery to a Robin webhook; live updates pushed to the browser by server-sent events.
- **Transcription:** hosted — Recall.ai's built-in transcription or Deepgram (open question).
- **Ingestion pipeline:** integration adapters → normalise → chunk → embed → store in the
  customer's pgvector store. Runs as background work (job mechanism: open question).
- **Integration adapters:** Google (Gmail, Drive, Calendar), Confluence, Jira, each behind a
  common interface.

## Data model (first cut)

Control plane (`robin`):

- `users`, `organizations`, `memberships` (user ↔ organisation, role)
- `customers` (organisation id, name, status, database name / connection reference)
- `integration_connections` (organisation id, provider, encrypted tokens, scopes)
- `customer_sources` (customer id, connection id, provider-specific selector such as Gmail
  filter, Drive folder, Confluence space, Jira project)

Customer database (one per customer):

- `solutions` (name, description, current phase, status)
- `calls` (solution id, meeting URL, bot id, started/ended, consent acknowledged)
- `transcript_segments` (call id, speaker, text, timestamps)
- `suggestions` (call id, text, rationale, state: shown / asked / dismissed)
- `documents`, `document_versions` (solution id, template, phase, content, citations)
- `diagrams` (solution id, source code, format)
- `source_items` (provider, external id, title, URL, content hash, synced at)
- `chunks` (source item or transcript reference, text, embedding vector)
- `agent_config`, `agent_memory` (the customer's agent instance state)

## APIs and integrations

- Anthropic API (Claude) — LLM for all agent work.
- Recall.ai — meeting bot and real-time transcript webhooks (paid).
- Deepgram — only if chosen over Recall.ai's built-in transcription (paid).
- Embeddings provider — required for pgvector retrieval; Claude does not provide embeddings
  (open question; likely paid).
- Google OAuth — Gmail, Drive, Calendar (read scopes).
- Atlassian OAuth — Confluence (read; write only for confirmed publishing), Jira (read;
  write only for confirmed issue creation).

## Infrastructure

- **Development:** dev container with PostgreSQL + pgvector running locally
  (`postgres://robin:robin@localhost:5432/robin`); the dev role can create per-customer
  databases; pgvector is preinstalled in `template1`. Recall.ai webhooks reach the dev
  server through VS Code port forwarding with port 3000 set to public.
- **Production hosting:** not decided (open question). Requirements: a long-running Node
  server (webhooks + server-sent events), PostgreSQL with pgvector and the ability to create
  databases programmatically, a public HTTPS URL.

## Compliance, privacy and accessibility

- **Call-recording consent** is a requirement: the bot is visible and clearly named; the
  user must acknowledge a consent reminder before the bot joins; the acknowledgement is
  stored with the call.
- **GDPR** is treated as applicable: data minimisation (only selected sources are ingested),
  per-customer export and deletion (dropping the customer database removes all of that
  customer's content), encrypted OAuth tokens, secrets only in environment variables, and a
  record of which third-party processors receive customer data (Anthropic, Recall.ai,
  transcription and embeddings providers).
- **Accessibility:** WCAG 2.1 AA target for the hub UI.

# Development Roadmap

## Phase 1 — Foundation

- Control-plane schema and migrations (users, organisations, memberships, customers).
- Login; first sign-in creates the user and their organisation.
- Customer-database provisioning, the customer schema + migration runner, and the
  customer-connection resolver with ownership checks.
- Isolation tests: a request scoped to customer A cannot read customer B's database.
- App shell and hub: customer list, customer page, solutions CRUD.

## Phase 2 — Context ingestion

- Integration framework (adapter interface, OAuth connection storage with encryption).
- Direct file upload into a customer's context.
- Google connection: Gmail and Drive source selection and sync.
- Chunking, embedding and retrieval over the customer's pgvector store.
- Source browser in the hub (what Robin knows about this customer, with links).

## Phase 3 — Customer agent and live call assistant

- Per-customer agent instance (configuration, memory, retrieval scope) on Claude.
- Recall.ai integration: create bot, webhook endpoint, real-time transcript ingestion.
- Consent reminder + acknowledgement.
- Live call view: transcript + streamed suggested questions; asked/dismissed states.
- End-of-call: transcript stored and indexed into the customer context.
- Google Calendar: pick an upcoming meeting instead of pasting a link.

## Phase 4 — Solution documentation and diagrams

- Document templates, generation from context with citations, editor, versioning.
- Diagram generation (diagram-as-code) and rendering in the hub.

## Phase 5 — Life-cycle phases

- Phase model per solution; "going ahead" transition.
- Per-phase document sets; phase-aware question suggestions.

## Phase 6 — Atlassian integrations

- Confluence and Jira connections; ingestion of selected space/project.
- Reviewed, explicitly confirmed publishing of documents to Confluence and creation of Jira
  issues.

## Phase 7 — Hardening

- Per-customer export and deletion.
- Audit trail of writes to external systems and of data sent to third-party processors.
- Accessibility pass (WCAG 2.1 AA), error handling, sync robustness.

## Future enhancements (not v1)

- Multi-user and multi-organisation features: invitations, roles/permissions, org
  management UI.
- Microsoft 365, Slack and other integrations.
- Post-call summaries and action items pushed to the user's tools.

## Out of scope for v1

- Mobile app (and any desktop app).
- Billing and multi-org SaaS features.
- Automatic writes to customer systems (Confluence, Jira, email) without the user's review.

# Logical Dependency Chain

1. **Control plane + login + provisioning + resolver** — everything else is customer-scoped,
   so isolation has to exist first and be tested first.
2. **Hub shell with customers and solutions** — the first usable, visible front end; reached
   as early as possible.
3. **File upload + retrieval** — the smallest path to grounded context, before any OAuth.
4. **Customer agent (Claude)** — can be exercised against uploaded context.
5. **Live call assistant** — needs the agent and retrieval; needs Recall.ai and a public
   webhook URL.
6. **Google ingestion (Gmail, Drive), then Calendar** — widens the context; can proceed in
   parallel with step 5 once the integration framework exists.
7. **Documents and diagrams** — reuse agent + retrieval.
8. **Life-cycle phases** — builds on documents and feeds back into call suggestions.
9. **Confluence / Jira** — ingestion reuses the framework; publishing needs documents.
10. **Hardening** — export/deletion, audit, accessibility.

# Risks and Mitigations

- **Isolation leaks** (the highest-cost failure). One resolver is the only way to get a
  customer connection; automated cross-customer tests from Phase 1; agent prompts are built
  only from that customer's database.
- **Many databases to migrate.** A migration runner applies the customer schema to every
  customer database and records each one's version; provisioning uses the same runner.
- **Real-time latency.** Suggestions must arrive while they are still relevant: stream
  responses, keep retrieval small, and trigger suggestions on transcript pauses rather than
  every segment.
- **Paid services not yet set up** (Anthropic, Recall.ai, transcription, embeddings). Phase
  1 needs none of them; each is behind an interface so work can proceed with fakes in tests.
- **Consent and privacy.** Visible bot, stored consent acknowledgement, selected-source
  ingestion only, per-customer deletion.
- **OAuth app verification.** Gmail/Drive read scopes are restricted scopes; fine for a
  single user in testing mode, a real hurdle before any wider release.
- **Framework churn.** Next.js 16 has breaking changes relative to older versions; consult
  the bundled docs (`node_modules/next/dist/docs/`) before writing framework code.
- **Scope size.** The product is large for one developer; the roadmap is ordered so each
  phase ends in something usable, and v1 could stop after Phase 5.

# Appendix

## Open questions

1. **Transcription:** Recall.ai's built-in transcription or Deepgram? (Cost, latency,
   accuracy, speaker labels.)
2. **Customer regions:** which countries are customers in? Determines recording-consent
   rules and any data-residency needs.
3. **Accounts:** Anthropic and Recall.ai accounts are not yet confirmed.
4. **Embeddings provider:** which model/service produces embeddings for pgvector?
5. **Login method:** e.g. Google sign-in (the user already connects Google) or
   email + password; and which auth library.
6. **Production hosting:** where Robin runs and which managed Postgres (must support
   pgvector and programmatic database creation).
7. **Life-cycle phases:** the exact phase list and the documents expected in each.
8. **Diagram format:** Mermaid, or something else (e.g. C4 via Structurizr, draw.io)?
9. **Assigning email to customers:** by Gmail label, by sender domain/address, or manually?
10. **Background jobs:** in-process, a Postgres-backed queue, or a hosted service?
11. **Which meeting platform first:** Zoom, Meet or Teams as the first one to verify.
12. **Shape of the agent instance:** direct Anthropic API calls with per-customer state, or
    an agent framework/SDK?

## Decisions already made

Platform, stack, isolation design, users design, call-capture approach, v1 integrations and
the out-of-scope list were agreed with the user during setup; the raw record is in
`.taskmaster/docs/scope.md`.

# Changelog

Newest first. One dated line per change to this PRD, with the Taskmaster task ID that
prompted it.

- 2026-11-14 — Initial PRD approved.

</PRD>
