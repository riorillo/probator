/** Every label the page shows. They describe the run, never the code. */

/** Shown while the browser opens the first page. */
export const OPENING = "Opening a new tab on Google…";

/** Shown while the loop is asking the server for the next move. */
export const RUNNING = "Running…";

/** Shown after a pause request, until the request in flight is back. */
export const PAUSING = "Pausing after the current request…";

/** Shown when a request failed. */
export const ATTENTION = "Paused · attention required";

/** Shown when the server itself cannot be reached. */
export const UNREACHABLE = "Local server unreachable";

/** The empty viewport, before any page is observed. */
export const NO_PAGE = "LOCAL BROWSER";
export const EMPTY_BIG = "NO PAGE";
export const EMPTY_SMALL = "Describe a task and press START.";

/** The viewport footer before any page is observed. */
export const NO_TITLE = "ISOLATED TAB";

/** The text-model helper before the server reports one. */
export const NO_MODEL = "…";

/** The mode of the snapshot, as the settings offer it for the next run. */
export const VISION_FIELD = "SEND THE NUMBERED IMAGE TO CLEF";

/** The mode the run in effect reads the page in, as the viewport reports it. */
export const VISION_ON = "IMAGE SNAPSHOT · NUMBERED BOXES";
export const VISION_OFF = "TEXT SNAPSHOT";

/** The trace before any action was executed. */
export const NO_ACTIONS = "No actions executed.";

/** The chip on the one action the heal model chose instead of the model that drives the run. */
export const HEAL = "HEAL";

/** The reason of a healed action, as the trace shows it under the row. */
export function because(reason: string): string {
  return `↳ ${reason}`;
}

/** The line under the status of a run the heal model had the last look at: what it said, or why it said nothing. */
export function healNote(said: string, answered: boolean): string {
  return answered ? `L'healer ha controllato: ${said}` : `L'healer non ha risposto: ${said}`;
}

const STATUS: ReadonlyMap<string, string> = new Map([
  ["idle", "Pronto"],
  ["ready", "In corso · pagina osservata"],
  ["predicted", "In corso · scelta pronta"],
  ["done", "Run finished · check the page"],
  ["blocked", "Fermo · nessuna azione disponibile"],
]);

/** The state of the run in words, and the state itself when it is unknown. */
export function statusLabel(status: string): string {
  return STATUS.get(status) ?? status;
}

/** `7 STEPS · 12.3s`, as the trace header counts the run. */
export function counted(steps: number, elapsedMs: number): string {
  return `${steps} ${steps === 1 ? "PASSO" : "PASSI"} · ${(elapsedMs / 1000).toFixed(1)}s`;
}

/** The step number as the trace shows it. */
export function numbered(step: number): string {
  return String(step).padStart(2, "0");
}

/** The latency of one decision. */
export function milliseconds(latency: number): string {
  return `${latency} ms`;
}

/** Whether the action left the page different. */
export function effect(changed: boolean): string {
  return changed ? "CAMBIATA" : "INVARIATA";
}
