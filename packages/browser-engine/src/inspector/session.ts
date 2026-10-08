import * as agent from "../harness/agent.ts";
import type { Config } from "../harness/config.ts";

/** The run the inspector drives: one at a time, replaced only by a closed one. */
export type Sessions = {
  readonly current: () => agent.Session | null;
  readonly open: (url: string, goal: string, config: Config) => Promise<agent.Session>;
  readonly close: () => Promise<void>;
};

/** Holds the current run so a new session always starts from a closed browser. */
export function create(): Sessions {
  let running: agent.Session | null = null;
  const close = async (): Promise<void> => {
    if (running === null) return;
    await running.close();
    running = null;
  };
  return {
    current: () => running,
    open: async (url, goal, config) => {
      await close();
      const opened = await agent.open(url, goal, config);
      running = opened;
      return opened;
    },
    close,
  };
}
