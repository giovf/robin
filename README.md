# Robin

An AI copilot for software architects. Robin listens to live customer calls and
suggests the next questions to ask, grounded in each customer's own context
(email, documents, earlier call transcripts). It drafts solution documentation
and diagrams, and documentation for each life-cycle phase once a solution goes
ahead. Everything is managed from one operations hub, with every customer kept
completely separate — its own database and its own AI agent.

Status: early development. The project is scaffolded; features are being built
from the backlog in `.taskmaster/`.

## Running it

Open the folder in VS Code and choose **Reopen in Container**. The dev container
installs Node, PostgreSQL with pgvector and the tooling, and starts the database
on every start.

```bash
cp .env.example .env   # then fill in the values you need
npm install
npm run dev            # http://localhost:3000
```

Other commands:

| Command                | What it does                   |
| ---------------------- | ------------------------------ |
| `npm run build`        | Production build               |
| `npm run typecheck`    | Generate route types and `tsc` |
| `npm run lint`         | ESLint                         |
| `npm run format`       | Prettier (write)               |
| `npm run format:check` | Prettier (check only)          |

The local database is `postgres://robin:robin@localhost:5432/robin`. If it is not
running, start it with `bash .devcontainer/post-start.sh`.

To receive Recall.ai webhooks in development, set port 3000 to **Public** in the
VS Code Ports panel and use that address as `APP_URL`.

## Where things are

- `docs/ARCHITECTURE.md` — the stable architecture decisions
- `.taskmaster/docs/prd.md` — product requirements, roadmap and open questions
- `task-master list` / `task-master next` — the backlog
- `CLAUDE.md` — conventions and the working loop for Claude Code sessions

## License

Proprietary. All rights reserved.
