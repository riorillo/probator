import { settle } from "../outcome.ts";
import * as env from "../settings/env.ts";
import * as app from "./app.ts";
import * as assets from "./assets.ts";
import * as security from "./security.ts";
import * as session from "./session.ts";

/** The local inspector every frontend request talks to. */
export const HOST = "127.0.0.1";

/** Starts the inspector on the loopback host and prints where to open it. */
export async function start(): Promise<Bun.Server<undefined>> {
  env.load(process.cwd());
  const port = env.port();
  const sessions = session.create();
  const guard = { ...security.loopback(port), token: security.token() };
  const server = Bun.serve({
    hostname: HOST,
    port,
    fetch: app.create({ sessions, guard, directory: assets.DIRECTORY }).fetch,
  });
  process.on("SIGINT", () => {
    void stop(sessions, server);
  });
  console.log(`S1 Visual Browser Agent: ${guard.origin}`);
  return server;
}

/** Closes the browser and the server before exiting. */
async function stop(sessions: session.Sessions, server: Bun.Server<undefined>): Promise<void> {
  await settle(() => sessions.close());
  server.stop(true);
  process.exit(0);
}

if (import.meta.main) await start();
