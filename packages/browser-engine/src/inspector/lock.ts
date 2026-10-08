/**
 * One step at a time: a browser step must finish before the next command, and a state read
 * waits for it instead of seeing a half-applied step.
 */

/** A fair gate with an immediate and a waiting way in. */
export type Gate = {
  /** Takes the gate when it is free. A caller that gets `false` must not release it. */
  readonly tryEnter: () => boolean;
  /** Takes the gate, waiting for whoever holds it to release it. */
  readonly enter: () => Promise<void>;
  readonly leave: () => void;
};

/** Creates a gate that hands the turn to waiters in the order they arrived. */
export function create(): Gate {
  let held = false;
  const waiting: Array<() => void> = [];
  return {
    tryEnter: () => {
      if (held) return false;
      held = true;
      return true;
    },
    enter: () => {
      if (!held) {
        held = true;
        return Promise.resolve();
      }
      return new Promise<void>((resume) => {
        waiting.push(resume);
      });
    },
    leave: () => {
      const resume = waiting.shift();
      if (resume === undefined) {
        held = false;
        return;
      }
      // The gate stays held: it is handed over, not released.
      resume();
    },
  };
}
