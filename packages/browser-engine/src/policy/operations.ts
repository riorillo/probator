/** The vocabulary shared by the action space, the questions, and the answers. */
export const DONE = "DONE";
export const BLOCKED = "BLOCKED";

const NAMES: ReadonlyMap<string, string> = new Map([
  ["click", "CLICK"],
  ["fill", "TYPE_TEXT"],
  ["select", "SELECT"],
]);

const DESCRIPTIONS: ReadonlyMap<string, string> = new Map([
  ["CLICK", "Click an element, button, menu option, autocomplete suggestion, or calendar day."],
  [
    "TYPE_TEXT",
    "Enter or replace text in an editable field. A small LLM will supply the value from the goal.",
  ],
  ["SELECT", "Select an observed dropdown value."],
]);

const FINISH: ReadonlyMap<string, string> = new Map([
  [DONE, "Every requirement is visibly satisfied."],
  [BLOCKED, "No supported operation can progress."],
]);

/** The model-facing name of an observed action kind, when it has one. */
export function name(kind: string): string | undefined {
  return NAMES.get(kind);
}

/** The description of a choice shown to the model. */
export function describe(operation: string): string {
  return DESCRIPTIONS.get(operation) ?? FINISH.get(operation) ?? operation;
}

/** Whether a choice ends the run instead of executing an action. */
export function finished(choice: string): boolean {
  return choice === DONE || choice === BLOCKED;
}
