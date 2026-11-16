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

1. **Transcription:** ~~Recall.ai's built-in transcription or Deepgram?~~ Decided
   2026-11-16: meeting captions by default, Recall.ai transcription optional (see Changelog).
2. **Customer regions:** which countries are customers in? Determines recording-consent
   rules and any data-residency needs.
3. **Accounts:** Anthropic and Recall.ai accounts are not yet confirmed.
4. **Embeddings provider:** ~~which model/service produces embeddings for pgvector?~~
   Decided 2026-11-16: local `multilingual-e5-small` (see Changelog).
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
- 2026-11-14 — Login decided for v1 (open question 5): email + password with the
  better-auth library, 7-day sessions, minimum password length 12. Because v1 is
  single-user, sign-up closes once the first account exists (`ALLOW_SIGNUP=true` reopens
  it). First sign-up creates the user's organisation. Google sign-in can be added later
  through the same library.
- 2026-11-14 — Provisional life-cycle phase list (open question 7), used by the hub until
  the real list is agreed: Discovery, Solution design, Proposal, Delivery, Handover,
  Operations. Phases are stored as text, so changing the list needs no migration. Archived
  customers are hidden and inaccessible in the hub (data kept).
- 2026-11-14 — Export and deletion: the per-customer export is a JSON file streamed on
  request (nothing is stored server-side; embedding vectors are omitted as derived data).
  Archiving is reversible (restore); permanent deletion drops the customer database and
  requires typing the customer's name. OAuth tokens are encrypted with AES-256-GCM
  (`TOKEN_ENCRYPTION_KEY`). CI workflow added (GitHub Actions with a pgvector service).
- 2026-11-14 — Google integration talks to Google's REST APIs directly with `fetch` (no
  `googleapis` SDK): read-only scopes for Gmail, Drive and Calendar. OAuth redirect URI is
  `<APP_URL>/api/integrations/google/callback`. A Gmail source is either a label or a Gmail
  search (addresses/domains); a Drive source is a folder (Docs, Sheets, Slides and text
  files are read; PDFs and Office files wait for the upload/extraction work).
- 2026-11-14 — Atlassian integration (Confluence spaces, Jira projects) added the same way.
  It connects with read-only scopes; the write scopes needed for publishing
  (`write:confluence-content`, `write:jira-work`) are requested only when publishing is
  built, so a connection made today cannot write to the customer's systems.
- 2026-11-14 — Context ingestion built: file upload (PDF, DOCX, text, Markdown, CSV, JSON,
  HTML; 20 MB limit; libraries `unpdf` and `mammoth`), chunking (~2000 characters with
  overlap), manual sync of selected integration sources (changed items only; items deleted
  at the provider are not yet removed), retrieval, and a Knowledge page with search.
  **Embeddings are a local stand-in** (`local-hash-v1`: word hashing, no meaning, no cost,
  no data leaves the server) behind an `EmbeddingProvider` interface, because the provider
  (open question 4) is undecided. Retrieval quality is not representative until a real
  model is plugged in; chunks record their model, so switching re-embeds on the next sync.
- 2026-11-14 — Customer agent service built on the Anthropic SDK (`claude-opus-5-5` by
  default, overridable per customer; refused requests fall back to Anthropic's default
  fallback model). It suggests questions from the recent transcript and drafts documents
  with source citations, using only that customer's retrieved context. **Not yet run
  against the real API** (no key configured; calls cost money) — tested with a fake model
  client. Suggestions arrive as one structured answer; only document drafts stream.
- 2026-11-16 — Embeddings decided (open question 4): `multilingual-e5-small` run locally
  (384 dimensions, ~100 languages; library `@huggingface/transformers`). Free, no account,
  and customer text is not sent to a third-party embeddings processor. The model (~120 MB)
  downloads once to `.cache/transformers`. `chunks.embedding` is now `vector(384)`; chunks
  are ~1600 characters to fit the model's input. A hosted model can still replace it behind
  `EmbeddingProvider`. The agent was run against the live Anthropic API for the first time
  (question suggestions and a document draft); `ANTHROPIC_API_KEY` is accepted when
  `ROBIN_ANTHROPIC_API_KEY` is unset.
- 2026-11-16 — Live calls built on Recall.ai (workspace region `us-west-2`). Transcription
  (open question 1) defaults to the meeting platform's own captions (`meeting_captions`: no
  extra charge, but captions must be enabled in the meeting and carry no timestamps);
  `RECALL_TRANSCRIPT_PROVIDER="recallai_streaming"` switches to Recall.ai's paid
  transcription. Deepgram is not used. The bot is named "Robin (notetaker)"; it is sent only
  from the start-call form, which requires the consent acknowledgement (stored with the
  call). The live screen polls every 2.5 s rather than using server-sent events; question
  suggestions are generated only while that screen is open, at most every 20 s. Webhooks
  are accepted only with a valid signature and only if the bot belongs to the customer
  named in the event. Bot status is polled, so no webhook needs configuring in the Recall
  dashboard. Finished transcripts are indexed into the customer's context.
  `MEETING_BOT_PROVIDER="fake"` plus `scripts/simulate-call.mjs` exercise all of this
  without Recall.ai. **No real bot has been sent yet.** Customer databases now migrate
  themselves on first use after an upgrade.
- 2026-11-16 — Documents, diagrams and life-cycle phases built. Nine provisional document
  templates, one or two per phase (discovery summary, requirements, solution architecture,
  decision record, proposal, delivery plan, runbook, handover guide, operations review).
  Drafts stream to the browser, cite their sources as [S1]…, and every save is a new
  version (history, comparison, restore). Diagram format (open question): Mermaid, with
  live preview and SVG/PNG export. Entering the Delivery phase marks a solution as going
  ahead; each phase lists its expected documents and steers call suggestions. Publishing
  to Confluence creates a new page from the exact version the user reviewed and confirmed,
  and is recorded in a per-customer `publications` audit log; it needs an Atlassian
  connection made "with publishing access" (write scopes are never requested otherwise).
  Publishing to Jira is not built. New libraries: `react-markdown`, `remark-gfm`,
  `mermaid`, `marked`. Documents and diagrams were generated with the live model; **the
  Confluence publish has only been tested against a fake**.

</PRD>

## Changelog

- 2026-11-14 — Foundation implemented (tasks 1–5, 31). Decisions recorded:
  `chunks.embedding` uses a placeholder size of 1536 with an HNSW cosine index until the
  embeddings provider is chosen; chunks reference either a source item or a call (transcript);
  `agent_config` is a single row per customer database; archiving a customer renames its
  database to `archived_<name>` (content kept), deletion drops it; customer databases are
  named `customer_<uuid>`; Vitest added as the test runner, running against a throwaway
  `robin_test` control plane.
