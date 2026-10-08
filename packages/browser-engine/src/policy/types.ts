import type { Answer } from "./validate.ts";

/** The complete decision, shaped exactly like the recorded and rendered payload. */
export type Choice = {
  choice: string;
  operation: string;
  target: string | null;
  confidence: number;
  probabilities: Record<string, number>;
  operation_probabilities: Record<string, number>;
  target_probabilities: Record<string, number>;
  target_confidence: number | null;
  raw_answers: Record<string, unknown>;
  model: unknown;
  usage: unknown;
  latency_ms: number;
  request: unknown;
  /** Set when a stuck run was handed to the heal model instead of the decision model. */
  healed?: boolean;
  /** Why the heal model chose this move, when it explained itself. */
  reason?: string | null;
};

export type { Answer };
