"use client";

import Link from "next/link";
import { useEffect, useState, type FormEvent } from "react";
import { Notice, PageHeading, Shell } from "@/components/shell";
import { Modal } from "@/components/modal";
import { StepsEditor, type StepDraft } from "@/components/steps-editor";

type ExecutionSummary = { id: string; status: string; phase: string; mode: "live" | "recording"; started_at: string | null; created_at: string; finished_at: string | null };
type VariableDraft = { name: string; description: string; secret: boolean; defaultValue: string };
type Definition = { id: string; title: string; objective: string; version: number; steps: StepDraft[]; checks: Array<{ kind: "text_visible" | "url_contains"; value: string; required: boolean }>; variables: VariableDraft[]; labels: string[]; latest_execution: ExecutionSummary | null };

function executionStatus(status: string, phase: string) {
  if (status === "running") return ["running", phase === "queued" ? "In coda" : phase === "starting" ? "Avvio" : "In corso"];
  if (status === "passed") return ["passed", "Superata"];
  if (status === "failed") return ["failed", "Fallita"];
  return ["blocked", "Bloccata"];
}

export function TestEditor({ projectId, testId }: { projectId: string; testId: string }) {
  const [projectName, setProjectName] = useState("");
  const [definition, setDefinition] = useState<Definition | null>(null);
  const [steps, setSteps] = useState<StepDraft[]>([]);
  const [variables, setVariables] = useState<VariableDraft[]>([]);
  const [error, setError] = useState("");
  const [saved, setSaved] = useState(false);
  const [busy, setBusy] = useState(false);
  const [runMode, setRunMode] = useState<"live" | "recording" | null>(null);
  const [runValues, setRunValues] = useState<Record<string, string>>({});

  useEffect(() => {
    void Promise.all([
      fetch("/api/projects").then((response) => response.json()),
      fetch(`/api/projects/${projectId}/tests/${testId}`).then(async (response) => ({ ok: response.ok, body: await response.json() })),
    ]).then(([projects, test]) => {
      setProjectName(projects.find((item: { id: string }) => item.id === projectId)?.name ?? "Progetto");
      if (!test.ok) { setError(test.body.error); return; }
      const next = test.body as Definition;
      setDefinition(next);
      setSteps(next.steps.map((step) => ({ instruction: step.instruction, completionCondition: step.completionCondition, required: step.required })));
      setVariables(next.variables ?? []);
    }).catch((cause) => setError(cause instanceof Error ? cause.message : "Impossibile caricare il test."));
  }, [projectId, testId]);

  async function save(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!definition) return;
    setBusy(true); setSaved(false); setError("");
    const data = new FormData(event.currentTarget);
    const checks = String(data.get("checks") ?? "").split("\n").map((line) => line.trim()).filter(Boolean).map((line) => {
      const separator = line.indexOf(":");
      const key = line.slice(0, separator).trim().toLowerCase();
      const value = line.slice(separator + 1).trim();
      return { kind: key === "url" ? "url_contains" as const : "text_visible" as const, value, required: true };
    });
    const labels = String(data.get("labels") ?? "").split(",").map((label) => label.trim()).filter(Boolean);
    const title = String(data.get("title") ?? "");
    const objective = String(data.get("objective") ?? "");
    const response = await fetch(`/api/projects/${projectId}/tests/${testId}`, {
      method: "PATCH",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ title, objective, steps, checks, labels, variables }),
    });
    const body = await response.json(); setBusy(false);
    if (!response.ok) { setError(body.error); return; }
    setDefinition({ ...definition, title, objective, version: body.version, steps, checks, variables, labels });
    setSaved(true);
  }

  async function run(mode: "live" | "recording", parameters?: Record<string, string>) {
    if (variables.length > 0 && !parameters) {
      setRunValues(Object.fromEntries(variables.map((variable) => [variable.name, variable.defaultValue ?? ""])));
      setRunMode(mode);
      return;
    }
    setError("");
    const response = await fetch(`/api/tests/${testId}/executions`, {
      method: "POST",
      headers: { "content-type": "application/json", "idempotency-key": crypto.randomUUID() },
      body: JSON.stringify({ mode, parameters: parameters ?? Object.fromEntries(variables.map((variable) => [variable.name, variable.defaultValue ?? ""])) }),
    });
    const body = await response.json();
    if (!response.ok) { setError(body.error); return; }
    location.href = `/executions/${body.id}`;
  }

  const latestStatus = definition?.latest_execution ? executionStatus(definition.latest_execution.status, definition.latest_execution.phase) : null;

  return <Shell projectId={projectId} projectName={projectName} page="test">
    <PageHeading title={definition?.title ?? "Definizione test"} description={`${projectName} · ${definition ? `Versione ${definition.version}` : "Caricamento…"}`}>
      <Link className="button" href={`/projects/${projectId}`}>← Board</Link>
      {definition && <>
        <button className="button" type="button" onClick={() => void run("recording")}>◉ Esegui con replay</button>
        <button className="button primary" type="button" onClick={() => void run("live")}>▶ Avvia Live</button>
      </>}
    </PageHeading>
    {error && <Notice kind="error">{error}</Notice>}
    {saved && <Notice>Nuova versione salvata. Le esecuzioni precedenti mantengono la definizione acquisita all’avvio.</Notice>}
    {!definition && !error ? <div className="skeleton" /> : definition && <form className="editor-grid" onSubmit={save}>
      <section className="panel">
        <h2>Obiettivo e step</h2>
        <label className="field">Titolo<input required maxLength={200} name="title" defaultValue={definition.title} /></label>
        <label className="field">Obiettivo<textarea name="objective" rows={3} defaultValue={definition.objective} /></label>
        <div className="field"><span>Step del test</span><small>Il modello controllerà le azioni eseguite e la pagina finale per valutare ogni condizione.</small><StepsEditor steps={steps} onChange={setSteps} /></div>
        <div className="field"><span>Parametri</span><small>I valori cambiano a ogni esecuzione; usa {"{{nome}}"} negli step per riutilizzarli.</small><div className="recorded-variables">{variables.map((variable, index) => <div className="recorded-variable" key={`${variable.name}-${index}`}><label className="field">Nome<input value={variable.name} onChange={(event) => updateVariable(index, { name: event.target.value })} /></label><label className="field">Descrizione<input value={variable.description} onChange={(event) => updateVariable(index, { description: event.target.value })} /></label><label className="field">Valore predefinito<input type={variable.secret ? "password" : "text"} value={variable.defaultValue} onChange={(event) => updateVariable(index, { defaultValue: event.target.value })} /></label><div className="recorded-variable-footer"><label className="checkbox-field"><input type="checkbox" checked={variable.secret} onChange={(event) => updateVariable(index, { secret: event.target.checked, defaultValue: event.target.checked ? "" : variable.defaultValue })} /><span>Valore segreto</span></label><button type="button" className="text-button" onClick={() => setVariables(variables.filter((_, at) => at !== index))}>Rimuovi parametro</button></div></div>)}<button type="button" className="button" onClick={() => setVariables([...variables, { name: `parametro${variables.length + 1}`, description: "Nuovo parametro", secret: false, defaultValue: "" }])}>＋ Aggiungi parametro</button></div></div>
        <label className="field">Controlli finali<textarea name="checks" rows={4} defaultValue={definition.checks.map((check) => `${check.kind === "url_contains" ? "url" : "text"}: ${check.value}`).join("\n")} /><small>Una verifica per riga: text: Contenuto visibile oppure url: /percorso.</small></label>
      </section>
      <section>
        <div className="panel">
          <h2>Organizzazione</h2>
          <label className="field">Etichette<input name="labels" defaultValue={definition.labels.join(", ")} /></label>
          <p className="muted small">Le etichette classificano il test e non rappresentano l’esito.</p>
          <div className="dialog-actions"><button className="button primary" disabled={busy}>{busy ? "Salvataggio…" : "Salva nuova versione"}</button></div>
        </div>
        <div className="panel history-card latest-execution">
          <h2>Ultima esecuzione</h2>
          {definition.latest_execution && latestStatus ? <>
            <div className="latest-execution-meta">
              <span className={`badge ${latestStatus[0]}`}>{latestStatus[1]}</span>
              <span>{definition.latest_execution.mode === "recording" ? "Replay registrato" : "Live"}</span>
              <span>{new Date(definition.latest_execution.started_at ?? definition.latest_execution.created_at).toLocaleString("it-IT")}</span>
            </div>
            <Link href={`/executions/${definition.latest_execution.id}`}>Apri dettaglio e replay →</Link>
            <button className="button primary" type="button" disabled={definition.latest_execution.status === "running"} onClick={() => void run(definition.latest_execution!.mode)}>{definition.latest_execution.status === "running" ? "Test in corso" : "↻ Ripeti test"}</button>
          </> : <p>Il test non è ancora stato eseguito.</p>}
        </div>
        <div className="panel history-card">
          <h2>Cronologia</h2><p>Ogni tentativo conserva la definizione e i propri risultati.</p>
          <Link href={`/projects/${projectId}/history?test=${testId}`}>Apri cronologia →</Link>
        </div>
      </section>
    </form>}
    {runMode && <Modal onClose={() => setRunMode(null)}><form onSubmit={(event) => { event.preventDefault(); const values = Object.fromEntries(variables.map((variable) => [variable.name, runValues[variable.name] ?? ""])); setRunMode(null); void run(runMode, values); }}><div className="dialog-header"><div><h2>Parametri dell’esecuzione</h2><p>Inserisci i valori che il flusso userà nel browser.</p></div><button type="button" className="icon-button" onClick={() => setRunMode(null)} aria-label="Chiudi">×</button></div>{variables.map((variable) => <label className="field" key={variable.name}>{variable.description || variable.name}<input type={variable.secret ? "password" : "text"} required value={runValues[variable.name] ?? ""} onChange={(event) => setRunValues({ ...runValues, [variable.name]: event.target.value })} /></label>)}<div className="dialog-actions"><button type="button" className="button" onClick={() => setRunMode(null)}>Annulla</button><button className="button primary">Avvia test</button></div></form></Modal>}
  </Shell>;

  function updateVariable(index: number, patch: Partial<VariableDraft>) {
    setVariables((current) => current.map((variable, at) => at === index ? { ...variable, ...patch } : variable));
  }
}
