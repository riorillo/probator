type TestStep = { instruction: string; completionCondition?: string; expected?: string };
type StepResult = { position: number; status: string; observed: string; error_detail?: string | null };
type SessionEvent = { sequence: number; kind: string; payload: Record<string, unknown>; created_at: string };
type LoggedAction = { step?: number; action?: unknown; kind?: unknown; operation?: unknown; target?: unknown; text?: unknown; page_changed?: unknown; elapsed_ms?: unknown; healed?: unknown; heal_reason?: unknown };

const statusLabel: Record<string, string> = { passed: "Superato", failed: "Non superato", blocked: "Non verificabile", running: "In corso", pending: "In attesa" };

export function ActionTimeline({ steps, results, events, active }: { steps: TestStep[]; results: StepResult[]; events: SessionEvent[]; active: boolean }) {
  const actions = events.filter((event) => event.kind === "action_logged");
  const progressByStep = new Map<number, number>();
  for (const event of events) {
    if (event.kind !== "agent_progress" || typeof event.payload.position !== "number" || typeof event.payload.actionCount !== "number") continue;
    progressByStep.set(event.payload.position, Math.max(progressByStep.get(event.payload.position) ?? 0, event.payload.actionCount));
  }

  return <section className="action-timeline" aria-label="Azioni eseguite per step">
    <header className="action-timeline-header">
      <div><h3>Step e azioni</h3><p>Condizione, valutazione del modello e attività registrate</p></div>
      <span className="badge neutral">{actions.length} {actions.length === 1 ? "azione" : "azioni"}</span>
    </header>
    <div className="action-timeline-scroll">
      {steps.map((step, position) => {
        const result = results.find((item) => item.position === position);
        const stepActions = actions.filter((event) => event.payload.position === position);
        const started = events.some((event) => event.kind === "step_started" && event.payload.position === position);
        const status = result?.status ?? (started && active ? "running" : started ? "blocked" : "pending");
        const latestProgress = progressByStep.get(position) ?? 0;
        const legacyOnly = latestProgress > 0 && stepActions.length === 0;
        return <article className="action-step" key={position}>
          <div className="action-step-heading">
            <span className="step-number">{position + 1}</span>
            <div className="action-step-title"><strong>{step.instruction}</strong><span className={`badge ${status === "passed" ? "passed" : status === "failed" ? "failed" : status === "running" ? "running" : status === "pending" ? "neutral" : "blocked"}`}>{statusLabel[status] ?? status}</span></div>
          </div>
          {(step.completionCondition ?? step.expected) && <div className="action-step-condition"><small>Condizione di completamento</small><p>{step.completionCondition ?? step.expected}</p></div>}
          {result?.observed && <p className="action-step-explanation">{result.observed}</p>}
          {result?.error_detail && <p className="action-step-error">{result.error_detail}</p>}
          <ol className="action-list">
            {stepActions.map((event) => {
              const action = record(event.payload.action);
              return <li className="action-item" key={event.sequence}>
                <span className="action-marker" aria-hidden="true">{actionGlyph(action.kind)}</span>
                <div className="action-content">
                  <div className="action-primary"><strong>{display(action.action) || display(action.operation) || "Azione browser"}</strong><time dateTime={event.created_at}>{new Date(event.created_at).toLocaleTimeString("it-IT")}</time></div>
                  <div className="action-details"><span>{operationLabel(action.kind, action.operation)}</span>{action.page_changed === true && <span>Pagina aggiornata</span>}{action.healed === true && <span>Recupero automatico</span>}</div>
                  {display(action.text) && <div className="action-typed-text"><span>Testo inserito</span><p>{display(action.text)}</p></div>}
                  {action.healed === true && display(action.heal_reason) && <p className="action-reason">{display(action.heal_reason)}</p>}
                </div>
              </li>;
            })}
          </ol>
          {stepActions.length === 0 && <p className="action-empty">{legacyOnly ? `${latestProgress} azioni rilevate; il dettaglio non è stato conservato per questa esecuzione.` : active && status === "running" ? "In attesa delle azioni…" : status === "pending" ? "Step non ancora avviato." : "Nessun dettaglio delle azioni disponibile per questo step."}</p>}
        </article>;
      })}
    </div>
  </section>;
}

function record(value: unknown): LoggedAction {
  return typeof value === "object" && value !== null && !Array.isArray(value) ? value as LoggedAction : {};
}

function display(value: unknown): string {
  if (typeof value === "string") return value.trim();
  if (typeof value === "number" || typeof value === "boolean") return String(value);
  return "";
}

function operationLabel(kind: unknown, operation: unknown): string {
  const value = display(operation || kind).toUpperCase();
  if (value === "CLICK") return "Clic";
  if (value === "TYPE_TEXT" || value === "FILL") return "Inserimento testo";
  if (value === "SELECT") return "Selezione";
  return value || "Interazione browser";
}

function actionGlyph(kind: unknown): string {
  const value = display(kind).toLowerCase();
  if (value === "click") return "↗";
  if (value === "fill") return "⌨";
  if (value === "select") return "⌄";
  return "•";
}
