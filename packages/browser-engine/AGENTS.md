# Repository Guidelines

## Project Structure & Module Organization

Read `README.md` before editing. This Bun/TypeScript browser agent exports its API from `src/index.ts`. `src/harness/` manages the run loop and recovery; `src/browser/` reads and executes browser actions; `src/cdp/` handles DevTools connections. Decision validation lives in `src/policy/`, text generation in `src/text/`, healing in `src/heal/`, and the local HTTP inspector in `src/inspector/`.

The React client lives in `web/`: components in `web/components/`, shared state and run orchestration in `web/store/`, pure readers in `web/model/`, and styling in `web/style.css`. Offline tests live in `tests/`; generated bundles go to ignored `dist/`.

## Build, Test, and Development Commands

Run commands from the repository root with Bun 1.2 or newer:

- `bun install`: install dependencies using `bun.lock`.
- `cp .env.example .env`: initialize local configuration; supply the required API keys.
- `bun run jev`: start the inspector at `http://127.0.0.1:8766`.
- `bun run typecheck`: check strict TypeScript across source, tests, and client.
- `bun run check`: validate browser JavaScript syntax and run type checking.
- `bun test`: run the offline test suite.
- `bun run build`: bundle the public entry point into `dist/`.

## Coding Style & Naming Conventions

Match existing two-space indentation, double quotes, semicolons, and trailing commas. Use explicit `.ts` extensions for TypeScript imports and `import type` for type-only dependencies. Keep modules focused; use lowercase filenames for utilities and PascalCase filenames for React components. Preserve pure client components and centralized store orchestration. No formatter or linter is configured; use `bun run check`.

## Testing Guidelines

Use `bun:test` with descriptive `describe`/`test` cases in `tests/*.test.ts`. Reuse fixtures from `tests/support.ts` and stub external providers. Tests must remain offline and never call paid APIs. Cover changed behavior and failure paths; no numeric coverage threshold is configured. Before submitting, run `bun run check`, `bun test`, and `bun run build`.

## Commit & Pull Request Guidelines

History uses concise imperative subjects, sometimes prefixed with `feat:`; follow that style. PRs should describe the behavior change, list validation results, link relevant issues, and include screenshots for client changes. Keep README claims consistent. Do not commit or push unless requested.

## Architecture & Configuration Safety

Keep targets bound to observed elements; models must never emit selectors or executable code. Never retry browser mutations, and log execution before observing results. Maintain one tab per run and shared numbering across snapshot modes. Verify final outcomes independently of `DONE`. Keep credentials server-side and `.env` ignored.
