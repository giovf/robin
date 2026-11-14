# Project: Robin

> Raw scope and decisions as supplied by the user on 2026-11-14 (restart of setup on an
> updated template; scope, interview answers and decisions carried over from a previous run).

## Scope (original brief)

Robin is an AI assistant specifically designed to assist software architects. It should:

1. Listen in on calls and display real-time questions for the user to ask the customer, to
   assist in all phases of architecting a solution.
2. Have all the necessary context, including email inbox access, access to relevant
   discovery/documentation files, and previous call transcripts.
3. Create documentation and relevant diagrams for the solution.
4. Produce documentation for each solution life-cycle phase once we go ahead with the solution.
5. Integrate with various platforms (Confluence/Jira, Google, etc.), but have a central
   operations hub UI where each customer and their solutions are managed individually.

## Confirmed summary

Robin is an AI copilot for software architects. It listens to live customer calls and shows
suggested questions in real time, tailored to the engagement phase. It is grounded in the
customer's context (email, discovery/documentation files, earlier call transcripts). It
generates solution documentation and diagrams, and per-lifecycle-phase documentation once a
solution goes ahead. It integrates with Confluence, Jira, Google etc. The centre is an
operations hub UI where each customer and each of their solutions is managed separately.

## Hard requirements

- **Per-customer isolation**: Robin instances must be completely independent per customer,
  including the AI agent itself and all data for that customer.
- **Users**: single user in v1, but it must be able to grow to multi-user / multi-org later.

## Decisions (user said "your call" and accepted the recommendations)

- **Platform**: web app — hub UI + API in one codebase. No desktop or mobile app.
- **Stack**: Next.js (App Router) + TypeScript strict + Tailwind; PostgreSQL + pgvector;
  Drizzle ORM; npm.
- **Isolation design**: a small control-plane database (`robin`) holds users, the customer
  registry and integration connections. Every customer gets its own Postgres database (own
  vector store, transcripts, documents) and its own agent instance (own configuration, memory
  and context — nothing shared between customers).
- **Users design**: build login and user/org ownership into the data model from day one; no
  org-management UI or permissions in v1.
- **Call capture**: a meeting bot that joins Zoom/Meet/Teams via Recall.ai (paid service; the
  bot is visible to call participants). Dev needs a public URL for its webhooks — use VS Code
  port forwarding with public visibility; nothing to install.
- **Integrations in v1**: Google (Gmail, Drive, Calendar), Confluence, Jira. Later: Microsoft
  365, Slack, others.
- **AI services**: Claude for the LLM. Real-time transcription from a hosted service —
  Recall.ai's built-in transcription or Deepgram, to be settled in the PRD. Anthropic and
  Recall.ai accounts not yet confirmed.
- **Constraints**: no deadline. Customer regions unknown — treat call-recording consent and
  GDPR as requirements, and list regions as an open question in the PRD.
- **Out of scope for v1**: mobile app; billing / multi-org SaaS features; automatic writes to
  customer systems (Confluence/Jira/email) without the user's review.
