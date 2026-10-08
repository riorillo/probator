import { connect, type ConnectOptions, type Connection } from "../browser/port.ts";
import type { BrowserPort } from "../browser/types.ts";
import { InputError } from "../errors.ts";
import { settle } from "../outcome.ts";
import * as config from "./config.ts";
import { orchestrate } from "./graph.ts";
import * as recording from "./recording.ts";
import { initial, snapshot, type Mode, type State } from "./state.ts";

/** A goal, or a list of goals that is joined into one. */
export type Goal = string | readonly string[];

/** The fingerprint a command believes it is acting on. */
export type Body = { readonly fingerprint?: string | null };

/** What the inspector and the frontend read. */
export type Snapshot = Record<string, unknown>;

/** One run: a browser, a goal and the state they have reached together. */
export type Session = {
  readonly config: config.Config;
  command(name: string, body?: Body): Promise<Snapshot>;
  /** Starts a new application-level goal in the current browser session. */
  setGoal(goal: string): void;
  drainRecordingEvents(): Promise<unknown[]>;
  captureScreenshot(): Promise<string | null>;
  snapshot(): Snapshot;
  run(): AsyncGenerator<Snapshot>;
  close(): Promise<void>;
  /** Closes the browser when the session leaves a `using` block. */
  [Symbol.asyncDispose](): Promise<void>;
};

const MODES: readonly Mode[] = ["tick", "predict", "act"];
const UNKNOWN = "Unknown command.";
const MISSING_GOAL = "A goal is required.";

/** Opens a browser on a goal and returns the harness that drives it. */
export async function open(url: string, goals: Goal, settings: config.Config = {}): Promise<Session> {
  const goal = task(goals);
  if (!goal) throw new InputError(MISSING_GOAL);
  const port = await attach(url, settings);
  const observed = await settle(() => port.observe(config.screenshots(settings)));
  if (!observed.ok) {
    await port.close();
    throw observed.error;
  }
  const dir = config.frames(settings);
  const state = initial({ mode: "predict", port, config: settings, goal, page: observed.value, record: dir !== null });
  if (dir) await recording.start(dir, observed.value);
  return session(state);
}

/** The port of a run: the one it was handed, or a connection opened in the snapshot mode the config asked for. */
export async function attach(
  url: string,
  settings: config.Config,
  opening: (url: string, options: ConnectOptions) => Promise<Connection> = connect,
): Promise<BrowserPort> {
  if (settings.port) return settings.port;
  return (await opening(url, { vision: config.vision(settings), recordingScript: config.recorder(settings) ?? undefined })).port;
}

function session(state: State): Session {
  let current = state;
  const drive = async (name: string, body: Body = {}): Promise<Snapshot> => {
    const input: State = { ...current, mode: narrow(name), expect: body.fingerprint ?? null, failure: null };
    const result = await orchestrate(input);
    current = result;
    if (result.failure) throw result.failure;
    return snapshot(result);
  };
  return {
    config: state.config,
    drainRecordingEvents: () => state.port.drainRecordingEvents?.() ?? Promise.resolve([]),
    captureScreenshot: () => state.port.captureScreenshot?.() ?? Promise.resolve(null),
    command: drive,
    setGoal: (goal) => {
      const next = goal.trim();
      if (!next) throw new InputError(MISSING_GOAL);
      current = {
        ...current,
        goal: next,
        plan: [next],
        plan_index: 0,
        decision: null,
        status: "ready",
        failure: null,
        started_at: null,
      };
    },
    snapshot: () => snapshot(current),
    close: () => current.port.close(),
    [Symbol.asyncDispose]: () => current.port.close(),
    run: async function* (): AsyncGenerator<Snapshot> {
      while (current.status !== "done" && current.status !== "blocked") {
        yield await drive("tick");
      }
    },
  };
}

/** Turns a command name into a mode, refusing anything else. */
function narrow(name: string): Mode {
  if (MODES.includes(name as Mode)) return name as Mode;
  throw new InputError(UNKNOWN);
}

function task(goals: Goal): string {
  if (typeof goals === "string") return goals.trim();
  return [...goals].join("\n").trim();
}
