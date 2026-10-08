"use client";

import Link from "next/link";
import { useEffect, useMemo, useState, type KeyboardEvent, type MouseEvent } from "react";
import { PageHeading, Notice, Shell } from "@/components/shell";

type Run = { id: string; test_id: string; title: string; status: string; phase: string; mode: string; started_at: string | null; finished_at: string | null; created_at: string };
const badge = (run: Run) => run.status === "running" ? ["running", run.phase === "queued" ? "In coda" : run.phase === "starting" ? "Avvio" : "In corso"] : run.status === "passed" ? ["passed", "Superata"] : run.status === "failed" ? ["failed", "Fallita"] : ["blocked", "Bloccata"];

function openExecutionRow(event: MouseEvent<HTMLTableRowElement>, executionId: string) {
  if ((event.target as HTMLElement).closest("a, button, input, select, textarea")) return;
  location.href = `/executions/${executionId}`;
}

function openExecutionRowWithKeyboard(event: KeyboardEvent<HTMLTableRowElement>, executionId: string) {
  if (event.target !== event.currentTarget || (event.key !== "Enter" && event.key !== " ")) return;
  event.preventDefault();
  location.href = `/executions/${executionId}`;
}

export function History({ projectId }: { projectId: string }) {
  const [project, setProject] = useState<{ name: string } | null>(null); const [runs, setRuns] = useState<Run[]>([]); const [cursor, setCursor] = useState<string | null>(null); const [loadingMore, setLoadingMore] = useState(false); const [query, setQuery] = useState(""); const [filter, setFilter] = useState(""); const [error, setError] = useState("");
  async function loadHistory(nextCursor?: string) {
    const testId = new URLSearchParams(location.search).get("test");
    const params = new URLSearchParams(); if (nextCursor) params.set("cursor", nextCursor); if (testId) params.set("test", testId);
    const response = await fetch(`/api/projects/${projectId}/executions?${params}`); const history = await response.json();
    if (!response.ok) throw new Error(history.error ?? "Impossibile caricare la cronologia.");
    setRuns((items) => nextCursor ? [...items, ...history.items] : history.items); setCursor(history.nextCursor);
  }
  useEffect(() => { let active = true; void Promise.all([fetch("/api/projects").then((r) => r.json()), loadHistory()]).then(([projects]) => { if (active) setProject(projects.find((item: { id: string }) => item.id === projectId) ?? null); }).catch((cause) => { if (active) setError(cause instanceof Error ? cause.message : "Impossibile caricare la cronologia."); }); return () => { active = false; }; }, [projectId]);
  const visible = useMemo(() => runs.filter((run) => `${run.title} ${run.id}`.toLowerCase().includes(query.toLowerCase()) && (!filter || run.status === filter)), [runs, query, filter]);
  return <Shell projectId={projectId} projectName={project?.name} page="history"><PageHeading title="Esecuzioni" description={`${project?.name ?? "Progetto"} · Ogni tentativo conserva il proprio risultato e le prove.`}><Link className="button" href={`/projects/${projectId}`}>← Board</Link></PageHeading><div className="tabs"><Link href={`/projects/${projectId}`}>Board dei test</Link><Link className="active" href={`/projects/${projectId}/history`}>Esecuzioni</Link></div>{error && <Notice kind="error">{error}</Notice>}<div className="toolbar"><input className="input search" value={query} onChange={(event) => setQuery(event.target.value)} placeholder="Cerca per test o ID…" aria-label="Cerca esecuzioni" /><select className="input compact" value={filter} onChange={(event) => setFilter(event.target.value)} aria-label="Filtra esito"><option value="">Tutti gli esiti</option><option value="running">In corso</option><option value="passed">Superata</option><option value="failed">Fallita</option><option value="blocked">Bloccata</option></select><span className="toolbar-count">{visible.length} tentativi caricati</span></div><section className="table-surface"><table><thead><tr><th>Test / esecuzione</th><th>Esito</th><th>Modalità</th><th>Avvio</th></tr></thead><tbody>{visible.map((run) => { const [kind, label] = badge(run); return <tr key={run.id} className="execution-row" tabIndex={0} aria-label={`Apri dettaglio esecuzione ${run.title}`} onClick={(event) => openExecutionRow(event, run.id)} onKeyDown={(event) => openExecutionRowWithKeyboard(event, run.id)}><td><Link className="project-name" href={`/executions/${run.id}`}>{run.title}</Link><p className="mono muted">{run.id}</p></td><td><span className={`badge ${kind}`}>{label}</span></td><td>{run.mode === "recording" ? "Con replay" : "Live"}</td><td>{new Date(run.started_at ?? run.created_at).toLocaleString("it-IT")}</td></tr>; })}{visible.length === 0 && <tr><td colSpan={4} className="empty-state">Nessuna esecuzione corrisponde ai filtri.</td></tr>}</tbody></table></section>{cursor && <div className="load-more"><button className="button" disabled={loadingMore} onClick={() => { setLoadingMore(true); void loadHistory(cursor).catch((cause) => setError(cause instanceof Error ? cause.message : "Impossibile caricare altri tentativi.")).finally(() => setLoadingMore(false)); }}>{loadingMore ? "Caricamento…" : "Carica altri tentativi"}</button></div>}</Shell>;
}
