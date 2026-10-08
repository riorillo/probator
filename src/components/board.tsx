"use client";

import Link from "next/link";
import { useEffect, useMemo, useState, type CSSProperties, type FormEvent } from "react";
import { PageHeading, Notice, Shell } from "@/components/shell";
import { Modal } from "@/components/modal";
import { StepsEditor, type StepDraft } from "@/components/steps-editor";

type Column = { id: string; name: string; position: number };
type Label = { name: string; color: string };
type TestVariable = { name: string; description?: string; secret?: boolean; defaultValue?: string };
type TestCard = { id: string; title: string; objective: string; column_id: string; column_name: string; position: number; version: number; variables: TestVariable[]; labels: Label[]; latest_status: string | null; latest_execution_id: string | null; latest_mode: "live" | "recording" | null; latest_execution_at: string | null };
type Project = { id: string; name: string; url: string; description: string };
const columnsFallback = ["Da fare", "In corso", "Completato"];
const status = (value: string | null) => value === "passed" ? ["passed", "✓ Superata"] : value === "failed" ? ["failed", "× Fallita"] : value === "blocked" ? ["blocked", "! Bloccata"] : value === "running" ? ["running", "◷ In corso"] : ["neutral", "— Mai eseguito"];
const labelColors = ["#d87986", "#ca8b48", "#b39b3e", "#6b9b66", "#449891", "#5688bc", "#8475b8", "#78849a"];

function localDateStart(value: string) {
  const [year, month, day] = value.split("-").map(Number);
  return new Date(year, month - 1, day).getTime();
}

function localDateEndExclusive(value: string) {
  const [year, month, day] = value.split("-").map(Number);
  return new Date(year, month - 1, day + 1).getTime();
}

export function Board({ projectId }: { projectId: string }) {
  const [project, setProject] = useState<Project | null>(null);
  const [columns, setColumns] = useState<Column[]>([]);
  const [tests, setTests] = useState<TestCard[]>([]);
  const [draftSteps, setDraftSteps] = useState<StepDraft[]>([{ instruction: "", completionCondition: "", required: true }]);
  const [query, setQuery] = useState(""); const [label, setLabel] = useState(""); const [mobileColumn, setMobileColumn] = useState(0); const [draggedTest, setDraggedTest] = useState<string | null>(null);
  const [runDateFrom, setRunDateFrom] = useState(""); const [runDateTo, setRunDateTo] = useState("");
  const [error, setError] = useState(""); const [formOpen, setFormOpen] = useState(false); const [busy, setBusy] = useState(false);
  const [recordingOpen, setRecordingOpen] = useState(false);
  const [pendingRunTest, setPendingRunTest] = useState<TestCard | null>(null);
  const [pendingRunValues, setPendingRunValues] = useState<Record<string, string>>({});
  async function load() {
    const [p, c, t] = await Promise.all([fetch("/api/projects"), fetch(`/api/projects/${projectId}/columns`), fetch(`/api/projects/${projectId}/tests`)]);
    const projects = await p.json(); const columnRows = await c.json(); const testRows = await t.json();
    if (!p.ok || !c.ok || !t.ok) { setError(projects.error ?? columnRows.error ?? testRows.error ?? "Impossibile caricare la board."); return; }
    setProject(projects.find((item: Project) => item.id === projectId) ?? null); setColumns(columnRows); setTests(testRows); setError("");
  }
  useEffect(() => { void load(); }, [projectId]);
  const labels = useMemo(() => [...new Map(tests.flatMap((test) => test.labels).map((item) => [item.name, item])).values()].sort((a, b) => a.name.localeCompare(b.name)), [tests]);
  const hasRunningExecution = tests.some((test) => test.latest_status === "running");
  useEffect(() => {
    if (!hasRunningExecution) return;
    const interval = window.setInterval(() => { void load(); }, 2000);
    return () => window.clearInterval(interval);
  }, [hasRunningExecution, projectId]);
  const visible = tests.filter((test) => {
    const timestamp = test.latest_execution_at ? new Date(test.latest_execution_at).getTime() : null;
    const from = runDateFrom ? localDateStart(runDateFrom) : null;
    const to = runDateTo ? localDateEndExclusive(runDateTo) : null;
    const matchesDate = (!from && !to) || (timestamp !== null && (from === null || timestamp >= from) && (to === null || timestamp < to));
    return `${test.title} ${test.objective} ${test.labels.map((item) => item.name).join(" ")}`.toLowerCase().includes(query.toLowerCase()) && (!label || test.labels.some((item) => item.name === label)) && matchesDate;
  });
  function openCreate() { setDraftSteps([{ instruction: "", completionCondition: "", required: true }]); setFormOpen(true); }
  async function move(test: TestCard, columnId: string, position?: number) {
    const target = columns.find((column) => column.id === columnId);
    const shouldRun = target?.name.trim().toLocaleLowerCase() === "in corso" && test.column_id !== columnId && test.latest_status !== "running";
    setBusy(true); setError("");
    try {
      const response = await fetch(`/api/tests/${test.id}/move`, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ columnId, position }) });
      const body = await response.json();
      if (!response.ok) throw new Error(body.error ?? "Impossibile spostare il test.");
      await load();
      if (shouldRun) {
        const values = Object.fromEntries(test.variables.map((variable) => [variable.name, variable.defaultValue ?? ""]));
        const needsInput = test.variables.some((variable) => !values[variable.name]?.trim());
        if (needsInput) { setPendingRunValues(values); setPendingRunTest(test); }
        else await queueExecution(test, values);
      }
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "Impossibile spostare il test.");
      await load();
    } finally { setBusy(false); }
  }
  async function queueExecution(test: TestCard, parameters: Record<string, string>) {
    const response = await fetch(`/api/tests/${test.id}/executions`, {
      method: "POST",
      headers: { "content-type": "application/json", "idempotency-key": crypto.randomUUID() },
      body: JSON.stringify({ mode: test.latest_mode ?? "recording", parameters }),
    });
    const body = await response.json();
    if (!response.ok) { setError(body.error ?? "Impossibile avviare il test."); return; }
    setTests((current) => current.map((item) => item.id === test.id ? { ...item, latest_status: "running", latest_execution_id: body.id, latest_mode: test.latest_mode ?? "recording" } : item));
    await load();
  }
  async function create(event: FormEvent<HTMLFormElement>) {
    event.preventDefault(); const data = new FormData(event.currentTarget); setError("");
    const response = await fetch(`/api/projects/${projectId}/tests`, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ title: data.get("title"), objective: data.get("objective"), steps: draftSteps, labels: String(data.get("labels") ?? "").split(",") }) });
    const body = await response.json(); if (!response.ok) { setError(body.error); return; }
    setFormOpen(false); await load();
  }
  async function startRecording(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const title = new FormData(event.currentTarget).get("title");
    setError("");
    const response = await fetch(`/api/projects/${projectId}/recordings`, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ title }) });
    const body = await response.json();
    if (!response.ok) { setError(body.error); return; }
    setRecordingOpen(false); location.href = `/projects/${projectId}/recordings/${body.id}`;
  }
  return <Shell projectId={projectId} projectName={project?.name} page="board"><PageHeading title={project?.name ?? "Board dei test"} description={<>{project?.url} · {project?.description}</>}><Link className="button board-header-button" href={`/projects/${projectId}/history`}>◷ Cronologia</Link><button className="button board-header-button" onClick={() => setRecordingOpen(true)}>◉ Registra un flusso</button><button className="button primary board-header-button" onClick={openCreate}>＋ Nuovo test</button></PageHeading>
    <div className="tabs"><Link className="active" href={`/projects/${projectId}`}>Board dei test</Link><Link href={`/projects/${projectId}/history`}>Esecuzioni</Link></div>
    {error && <Notice kind="error">{error}</Notice>}
    <div className="toolbar board-toolbar"><input className="input search" value={query} onChange={(event) => setQuery(event.target.value)} placeholder="Cerca test…" aria-label="Cerca test" /><select className="input compact" aria-label="Filtra etichetta" value={label} onChange={(event) => setLabel(event.target.value)}><option value="">Tutte le etichette</option>{labels.map((value) => <option key={value.name}>{value.name}</option>)}</select><details className="board-date-filter"><summary>{runDateFrom || runDateTo ? "⌁ Date filtrate" : "◷ Ultima esecuzione"}</summary><div className="board-date-panel"><label>Da<input type="date" value={runDateFrom} max={runDateTo || undefined} onChange={(event) => setRunDateFrom(event.target.value)} /></label><label>A<input type="date" value={runDateTo} min={runDateFrom || undefined} onChange={(event) => setRunDateTo(event.target.value)} /></label><button className="text-button" type="button" disabled={!runDateFrom && !runDateTo} onClick={() => { setRunDateFrom(""); setRunDateTo(""); }}>Rimuovi filtro</button></div></details><span className="toolbar-count">{visible.length} di {tests.length} test · {tests.filter((test) => test.latest_status === "running").length} in esecuzione</span></div>
    <select className="input mobile-column" aria-label="Colonna board" value={mobileColumn} onChange={(event) => setMobileColumn(Number(event.target.value))}>{(columns.length ? columns : columnsFallback.map((name, position) => ({ id: String(position), name, position }))).map((column) => <option key={column.id} value={column.position}>{column.name}</option>)}</select>
    <div className="board">{(columns.length ? columns : columnsFallback.map((name, position) => ({ id: String(position), name, position }))).map((column) => { const cards = visible.filter((test) => test.column_id === column.id); return <section className={`board-column ${mobileColumn === column.position ? "mobile-active" : ""} ${draggedTest ? "drop-ready" : ""}`} key={column.id} onDragOver={(event) => { if (draggedTest) { event.preventDefault(); event.dataTransfer.dropEffect = "move"; } }} onDrop={(event) => { event.preventDefault(); const test = tests.find((item) => item.id === (event.dataTransfer.getData("text/plain") || draggedTest)); if (test && test.column_id !== column.id) void move(test, column.id); setDraggedTest(null); }}><div className="column-heading"><h2>{column.name} <span>{cards.length}</span></h2></div>{cards.map((test,index) => { const [kind, text] = status(test.latest_status); return <article className={`test-card ${test.latest_status === "running" ? "is-running" : ""}`} key={test.id} draggable onDragStart={(event) => { if (event.target instanceof HTMLElement && event.target.closest("button, input, select, a, label")) { event.preventDefault(); return; } setDraggedTest(test.id); event.dataTransfer.effectAllowed = "move"; event.dataTransfer.setData("text/plain", test.id); }} onDragEnd={() => setDraggedTest(null)} onDragOver={(event) => { if (draggedTest && draggedTest !== test.id) event.preventDefault(); }} onDrop={(event) => { event.preventDefault(); event.stopPropagation(); const moved = tests.find((item) => item.id === (event.dataTransfer.getData("text/plain") || draggedTest)); if (moved) void move(moved, column.id, test.position); setDraggedTest(null); }}><div className="card-top"><code>{test.id.slice(0, 8).toUpperCase()}</code><label className="sr-only" htmlFor={`move-${test.id}`}>Sposta {test.title}</label><select id={`move-${test.id}`} aria-label={`Sposta ${test.title}`} value={test.column_id} onChange={(event) => void move(test, event.target.value)} disabled={busy}>{columns.map((target) => <option key={target.id} value={target.id}>Sposta in {target.name}</option>)}</select></div><h3><Link href={`/projects/${projectId}/tests/${test.id}`}>{test.title}</Link></h3>{test.objective && <p className="muted card-objective">{test.objective}</p>}<LabelPicker testId={test.id} selected={test.labels} available={labels} onSaved={() => void load()} /><div className="card-meta"><span className={`badge ${kind}`}>{text}</span><span>v{test.version}</span></div><div className="card-last-run"><span>Ultima esecuzione</span>{test.latest_execution_at ? <time dateTime={test.latest_execution_at}>{new Date(test.latest_execution_at).toLocaleString("it-IT", { dateStyle: "medium", timeStyle: "short", timeZone: "Europe/Rome" })}</time> : <span>Mai eseguito</span>}</div><div className="card-actions"><Link className="card-action history-action" href={`/projects/${projectId}/history?test=${test.id}`}><span aria-hidden="true">◷</span><span>Cronologia</span></Link><Link className="card-action open-action" href={`/projects/${projectId}/tests/${test.id}`}><span>Apri test</span><span aria-hidden="true">→</span></Link></div><div className="reorder-actions"><button className="text-button" aria-label={`Sposta ${test.title} in alto`} disabled={busy || index === 0} onClick={() => void move(test, column.id, index - 1)}>↑ Su</button><button className="text-button" aria-label={`Sposta ${test.title} in basso`} disabled={busy || index === cards.length - 1} onClick={() => void move(test, column.id, index + 1)}>↓ Giù</button></div></article>; })}<button className="add-test" onClick={openCreate}>＋ Aggiungi test</button></section>; })}</div>
    <p className="board-note">Le esecuzioni attive restano in “In corso”; se superate passano in “Completato”, se falliscono o si bloccano tornano in “Da fare”.</p>
    {formOpen && <Modal onClose={() => setFormOpen(false)}><form onSubmit={create}><div className="dialog-header"><div><h2>Nuovo test</h2><p>Definizione riutilizzabile; ogni avvio crea un tentativo distinto.</p></div><button type="button" className="icon-button" aria-label="Chiudi" onClick={() => setFormOpen(false)}>×</button></div><label className="field">Titolo<input required maxLength={200} name="title" autoFocus /></label><label className="field">Obiettivo<textarea name="objective" rows={2} /></label><div className="field"><span>Step del test</span><small>Descrivi l’azione e la condizione che il modello dovrà verificare sulla pagina finale.</small><StepsEditor steps={draftSteps} onChange={setDraftSteps} /></div><label className="field">Etichette, separate da virgole<input name="labels" placeholder="autenticazione, regressione" /></label>{error && <Notice kind="error">{error}</Notice>}<div className="dialog-actions"><button type="button" className="button" onClick={() => setFormOpen(false)}>Annulla</button><button className="button primary">Crea test</button></div></form></Modal>}
    {recordingOpen && <Modal onClose={() => setRecordingOpen(false)}><form onSubmit={startRecording}><div className="dialog-header"><div><h2>Registra un nuovo flusso</h2><p>Si aprirà il browser sul sito del progetto; potrai navigarlo e compilare i campi.</p></div><button type="button" className="icon-button" aria-label="Chiudi" onClick={() => setRecordingOpen(false)}>×</button></div><label className="field">Nome del flusso<input required maxLength={200} name="title" autoFocus placeholder="Accesso e ricerca" /></label>{error && <Notice kind="error">{error}</Notice>}<div className="dialog-actions"><button type="button" className="button" onClick={() => setRecordingOpen(false)}>Annulla</button><button className="button primary">Apri browser</button></div></form></Modal>}
    {pendingRunTest && <Modal onClose={() => setPendingRunTest(null)}><form onSubmit={(event) => { event.preventDefault(); const test = pendingRunTest; setPendingRunTest(null); void queueExecution(test, pendingRunValues); }}><div className="dialog-header"><div><h2>Test spostato in corso</h2><p>Inserisci i parametri richiesti per avviare automaticamente una nuova esecuzione di “{pendingRunTest.title}”.</p></div><button type="button" className="icon-button" aria-label="Chiudi" onClick={() => setPendingRunTest(null)}>×</button></div>{pendingRunTest.variables.map((variable) => <label className="field" key={variable.name}>{variable.description || variable.name}<input type={variable.secret ? "password" : "text"} required value={pendingRunValues[variable.name] ?? ""} onChange={(event) => setPendingRunValues((current) => ({ ...current, [variable.name]: event.target.value }))} /></label>)}<div className="dialog-actions"><button type="button" className="button" onClick={() => setPendingRunTest(null)}>Annulla</button><button className="button primary">Avvia esecuzione</button></div></form></Modal>}
  </Shell>;
}

function LabelPicker({ testId, selected, available, onSaved }: { testId: string; selected: Label[]; available: Label[]; onSaved: () => void }) {
  const [open, setOpen] = useState(false);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState("");
  const [selectedNames, setSelectedNames] = useState<string[]>([]);
  const [colors, setColors] = useState<Record<string, string>>({});
  const [newName, setNewName] = useState("");
  const [newColor, setNewColor] = useState(labelColors[0]);

  function showPicker() {
    setSelectedNames(selected.map((item) => item.name));
    setColors(Object.fromEntries([...available, ...selected].map((item) => [item.name, item.color])));
    setError("");
    setOpen((value) => !value);
  }
  function toggle(name: string) {
    setSelectedNames((current) => current.includes(name) ? current.filter((item) => item !== name) : [...current, name]);
  }
  function addNewLabel(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const name = newName.trim();
    if (!name) return;
    const existing = available.find((item) => item.name.toLocaleLowerCase() === name.toLocaleLowerCase());
    const canonical = existing?.name ?? name;
    if (!selectedNames.includes(canonical)) setSelectedNames((current) => [...current, canonical]);
    setColors((current) => ({ ...current, [canonical]: existing?.color ?? newColor }));
    setNewName("");
  }
  async function save() {
    setSaving(true); setError("");
    try {
      const labels = selectedNames.map((name) => ({ name, color: colors[name] ?? labelColors[7] }));
      const response = await fetch(`/api/tests/${testId}/labels`, { method: "PUT", headers: { "content-type": "application/json" }, body: JSON.stringify({ labels }) });
      const body = await response.json();
      if (!response.ok) throw new Error(body.error ?? "Impossibile aggiornare le etichette.");
      setOpen(false);
      onSaved();
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "Impossibile aggiornare le etichette.");
    } finally { setSaving(false); }
  }

  return <div className="label-picker">
    <div className="tag-row">
      {selected.map((item) => <span className="tag colored-tag" key={item.name} style={{ "--label-color": item.color } as CSSProperties}>{item.name}</span>)}
      <button className="label-add-button" type="button" onClick={showPicker} aria-expanded={open}>{selected.length ? "＋ Etichette" : "＋ Aggiungi etichetta"}</button>
    </div>
    {open && <div className="label-popover">
      <div className="label-popover-heading"><strong>Etichette</strong><button type="button" className="icon-button" aria-label="Chiudi" onClick={() => setOpen(false)}>×</button></div>
      {available.length > 0 && <div className="label-options">{available.map((item) => <button type="button" className={`label-option ${selectedNames.includes(item.name) ? "selected" : ""}`} key={item.name} onClick={() => toggle(item.name)}><span className="label-option-check">{selectedNames.includes(item.name) ? "✓" : "＋"}</span><span className="label-option-name">{item.name}</span></button>)}</div>}
      {selectedNames.length > 0 && <div className="label-color-list">{selectedNames.map((name) => <div className="label-color-row" key={name}><span className="label-color-name">{name}</span><div className="label-swatches">{labelColors.map((color) => <button key={color} type="button" className={`label-swatch ${colors[name] === color ? "active" : ""}`} style={{ backgroundColor: color }} aria-label={`Colore ${color} per ${name}`} aria-pressed={colors[name] === color} onClick={() => setColors((current) => ({ ...current, [name]: color }))} />)}</div></div>)}</div>}
      <form className="label-create" onSubmit={addNewLabel}><input aria-label="Nuova etichetta" maxLength={48} value={newName} onChange={(event) => setNewName(event.target.value)} placeholder="Crea un’etichetta…" /><div className="label-create-colors" aria-label="Colore nuova etichetta">{labelColors.map((color) => <button key={color} type="button" className={`label-swatch ${newColor === color ? "active" : ""}`} style={{ backgroundColor: color }} aria-label={`Scegli colore ${color}`} aria-pressed={newColor === color} onClick={() => setNewColor(color)} />)}</div><button className="button" type="submit" disabled={!newName.trim()}>Aggiungi</button></form>
      {error && <p className="label-error">{error}</p>}
      <div className="label-popover-actions"><button className="text-button" type="button" onClick={() => setOpen(false)}>Annulla</button><button className="button primary" type="button" disabled={saving} onClick={() => void save()}>{saving ? "Salvataggio…" : "Salva"}</button></div>
    </div>}
  </div>;
}
