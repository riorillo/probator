/** One executed action, as recorded for the inspector and summarised for the model. */
export type Entry = {
  step: number;
  action: unknown;
  kind: string;
  choice: unknown;
  probability: unknown;
  confidence: unknown;
  latency_ms: unknown;
  text: string | null;
  text_helper: unknown;
  text_latency_ms: unknown;
  operation: unknown;
  target: unknown;
  /** Set when the heal model chose this step instead of the decision model. */
  healed: boolean;
  /** Why the heal model chose it, when it explained itself. */
  heal_reason: string | null;
  page_changed: boolean | null;
  url: unknown;
  usage: unknown;
  executed_ms: number;
  elapsed_ms: number;
  [field: string]: unknown;
};

/** The text model only needs the action and the text that was typed. */
export type TextEntry = { readonly action?: unknown; readonly text?: unknown };
