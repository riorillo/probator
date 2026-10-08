# Probator

Probator is the local project and web-test manager described in [`docs/project-test-management-spec.md`](docs/project-test-management-spec.md). The Next.js application uses PostgreSQL through Prisma, MinIO for execution evidence, and a separate Bun worker that calls the `@probator/browser-engine` workspace package.

## Local setup

Requirements: Node.js 20+, Bun 1.2+, Docker Compose, a MinIO S3 endpoint, and a Chrome instance exposed over CDP. This is a Bun workspace: the web application lives at the root and the browser engine is in `packages/browser-engine/`.

```sh
cp .env.example .env
docker compose up -d postgres
bun install
bun run db:generate
bun run db:migrate:dev --name initial
```

Set `MINIO_ENDPOINT`, credentials, and bucket to a MinIO instance with the S3 API enabled. The worker creates the bucket on first artifact upload. Set the decision model endpoint, model name, and credential in `.env`, and set `BU_CDP_URL` (or `BU_CDP_WS`) to the browser's CDP endpoint. Model credentials are read by the worker and are never returned by the app API. The database defaults in `.env.example` are for Docker Compose; the object store must be configured separately.

Run the application and worker in separate terminals:

```sh
bun run dev
bun run worker
```

Both startup commands check Chrome CDP first and report whether it is reachable. The warning does not prevent the web app from starting; executions and recordings still require an available CDP endpoint. Run `bun run check:cdp` to check it separately.

Open [http://127.0.0.1:3000](http://127.0.0.1:3000). The app binds to loopback and currently supports one local operator; it does not provide shared-user authentication or project-level authorization.

Use `bun run db:migrate` to apply committed Prisma migrations in a deployed environment. `bun run db:migrate:dev --name <name>` is for local schema changes. `bun run db:generate` regenerates Prisma Client after schema changes.

## Current implementation boundary

- Project creation provisions one board with `Da fare`, `In corso`, and `Completato` columns. Tests have ordered browser actions and natural-language completion conditions, labels, and can be moved and reordered between columns with drag, keyboard buttons, or the move selector.
- A queued run snapshots its definition, executes through `@probator/browser-engine`, persists structured results and ordered events, and saves a redacted trace document under `replay/{executionId}/logs/trace.json` in MinIO. Ready artifacts are served through short-lived signed URLs created on access. History uses cursor pagination.
- A worker heartbeat expiry marks the attempt blocked. Browser actions are not retried automatically.
- Each step is evaluated by the configured text model against that step's browser actions and final page, and the explanation is stored with the result. The runner's `DONE` status does not determine whether the condition passed. The versioned test editor also supports final exact-text and URL-fragment checks.
- A project can start an interactive flow recording in a dedicated CDP tab. The operator controls the page from a live browser view; Probator records actions with semantic element details and proposes editable test steps and passing conditions. Text inputs are suggested as reusable parameters, password inputs are treated as secret, and each run can provide parameter values. Saving the generated test clears the raw interaction events; abandoned and completed recording data follows the configured retention period.
- The evidence trace intentionally omits page text, input values, screenshots, and URL paths/query parameters. It stores the origin and the pass/fail result of configured assertions.
- Recording uses rrweb without content masking: text, field values, URLs, canvas, cross-origin iframe snapshots, fonts, and stylesheets are captured for a full-fidelity replay. A lightweight event validator preserves the payload and rejects malformed or oversized events; each run writes a manifest with capture settings and complete/partial state. The replay has pause, seek, and speed controls. Captures can contain sensitive page data and should be used only with trusted pages in this local, single-operator environment.
- The worker expires finished execution rows and objects after `PROBATOR_RETENTION_DAYS` (30 days by default), repairs pending artifact metadata when an object exists, and removes old orphan objects after a one-day grace period. The local-only middleware is the access boundary; this deployment is for one trusted local operator, not a shared service.
- Live mode streams progress and saves a full page frame at most every 2.5 seconds and after each step. Text, form contents, images, iframes, and custom elements appear as captured by the browser. Each saved frame becomes the current project-list preview and is served through the app artifact endpoint. Automated MinIO outage/reconciliation tests and the full visual regression gallery still need dedicated end-to-end verification.

The browser engine inspector remains available as a diagnostic tool in `packages/browser-engine/`. Its API includes `Session.setGoal()` so Probator can execute and evaluate one application test step at a time while retaining a single browser session.
