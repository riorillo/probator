import { InputError } from "../errors.ts";
import * as config from "../harness/config.ts";
import { isRecord } from "../json.ts";
import { MAX_STEPS } from "../settings/limits.ts";
import * as form from "./form.ts";
import type { Sessions } from "./session.ts";

const NO_SESSION = "Start a session first.";

/** The state reported before any session exists. */
const IDLE: Record<string, unknown> = { page: null, status: "idle", history: [], decision: null };

/** Everything the frontend reads: the run state plus the settings in effect. */
export function report(sessions: Sessions): Record<string, unknown> {
  const session = sessions.current();
  const settings = config.describe(session?.config ?? {});
  return {
    ...(session ? session.snapshot() : IDLE),
    typesafe_api_url: settings.decisionAddress,
    typesafe_model: settings.decisionIdentity,
    text_model_base_url: settings.textAddress,
    text_model: settings.textIdentity,
    max_steps: MAX_STEPS,
  };
}

/** Runs one command: `reset` opens a new run, everything else steps the current one. */
export async function run(
  sessions: Sessions,
  name: string,
  body: unknown,
): Promise<Record<string, unknown>> {
  if (name === "reset") return reset(sessions, body);
  const session = sessions.current();
  if (session === null) throw new InputError(NO_SESSION);
  await session.command(name, { fingerprint: fingerprintOf(body) });
  return report(sessions);
}

async function reset(sessions: Sessions, body: unknown): Promise<Record<string, unknown>> {
  const current = sessions.current();
  const prepared = form.read(body, config.describe(current?.config ?? {}));
  await sessions.open(prepared.url, prepared.goal, prepared.config);
  return report(sessions);
}

function fingerprintOf(body: unknown): string | null {
  if (!isRecord(body)) return null;
  const value = body.fingerprint;
  return typeof value === "string" ? value : null;
}
