"use client";

import Link from "next/link";
import { useEffect, useState, type FormEvent, type KeyboardEvent, type MouseEvent } from "react";
import { useRouter } from "next/navigation";
import { PageHeading, Notice, Shell } from "@/components/shell";
import { Modal } from "@/components/modal";

type Project = { id: string; name: string; url: string; description: string; test_count: number; latest_status: string | null; preview_artifact_id: string | null; preview_execution_id: string | null; preview_status: string | null };

function statusLabel(status: string | null) { return status === "passed" ? ["passed", "✓ Superata"] : status === "failed" ? ["failed", "× Fallita"] : status === "blocked" ? ["blocked", "! Bloccata"] : status === "running" ? ["running", "◷ In corso"] : ["neutral", "— Nessuna esecuzione"]; }

export function Projects() {
  const router = useRouter();
  const [projects, setProjects] = useState<Project[]>([]);
  const [query, setQuery] = useState("");
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(true);
  const [formOpen, setFormOpen] = useState(false);
  function openProject(projectId: string) { router.push(`/projects/${projectId}`); }
  function onProjectRowClick(event: MouseEvent<HTMLTableRowElement>, projectId: string) {
    if (event.target instanceof Element && event.target.closest("a,button,input,select,textarea")) return;
    openProject(projectId);
  }
  function onProjectRowKeyDown(event: KeyboardEvent<HTMLTableRowElement>, projectId: string) {
    if (event.target !== event.currentTarget || !["Enter", " "].includes(event.key)) return;
    event.preventDefault();
    openProject(projectId);
  }
  async function load(value = query) {
    setLoading(true);
    const response = await fetch(`/api/projects?q=${encodeURIComponent(value)}`);
    const body = await response.json();
    setLoading(false);
    if (!response.ok) { setError(body.error); return; }
    setError(""); setProjects(body);
  }
  useEffect(() => { void load(""); }, []);
  async function create(event: FormEvent<HTMLFormElement>) {
    event.preventDefault(); setError("");
    const data = new FormData(event.currentTarget);
    try {
      const response = await fetch("/api/projects", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ name: data.get("name"), url: data.get("url"), description: data.get("description") }) });
      const body: { id?: string; error?: string } | null = await response.json().catch(() => null);
      if (!response.ok) { setError(body?.error ?? `Impossibile creare il progetto (errore ${response.status}).`); return; }
      if (!body?.id) { setError("Il server non ha restituito il progetto creato."); return; }
      location.href = `/projects/${body.id}`;
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "Impossibile contattare il server.");
    }
  }
  return <Shell page="projects"><PageHeading title="Progetti" description="Siti e applicazioni del workspace."><button className="button primary" onClick={() => setFormOpen(true)}>＋ Nuovo progetto</button></PageHeading>
    {error && <Notice kind="error">{error}</Notice>}
    <div className="toolbar"><input className="input search" placeholder="Cerca per nome o URL…" aria-label="Cerca progetti" value={query} onChange={(event) => { setQuery(event.target.value); void load(event.target.value); }} /><span className="toolbar-count">{loading ? "Caricamento…" : `${projects.length} progetti`}</span></div>
    <section className="table-surface"><table><thead><tr><th>Progetto</th><th className="optional">URL</th><th className="optional">Test</th><th>Ultimo esito</th></tr></thead><tbody>{projects.map((project) => { const [kind, label] = statusLabel(project.latest_status); const previewUrl = project.preview_status === "ready" && project.preview_artifact_id && project.preview_execution_id ? `/api/executions/${project.preview_execution_id}/artifacts/${project.preview_artifact_id}` : null; return <tr key={project.id} className="project-row" tabIndex={0} aria-label={`Apri progetto ${project.name}`} onClick={(event) => onProjectRowClick(event, project.id)} onKeyDown={(event) => onProjectRowKeyDown(event, project.id)}><td><div className="project-cell">{previewUrl ? <img className="preview" src={previewUrl} alt={`Anteprima di ${project.name}`} loading="lazy" /> : <div className="preview" aria-hidden="true"><i/><i/><i/></div>}<div><Link href={`/projects/${project.id}`} className="project-name">{project.name}</Link><p className="muted">{project.description || "Nessuna descrizione"}</p></div></div></td><td className="mono muted optional">{project.url}</td><td className="optional">{project.test_count}</td><td><span className={`badge ${kind}`}>{label}</span></td></tr>; })}{!loading && projects.length === 0 && <tr><td colSpan={4} className="empty-state">{query ? "Nessun progetto trovato." : "Crea il primo progetto per iniziare a organizzare i test."}</td></tr>}</tbody></table><div className="table-footer">Le anteprime mostrano l’ultimo frame Live acquisito senza mascheramento.</div></section>
    {formOpen && <Modal onClose={() => setFormOpen(false)}><form onSubmit={create}><div className="dialog-header"><div><h2>Nuovo progetto</h2><p>La board con le tre colonne iniziali verrà creata automaticamente.</p></div><button type="button" className="icon-button" aria-label="Chiudi" onClick={() => setFormOpen(false)}>×</button></div><label className="field">Nome<input required maxLength={120} name="name" autoFocus placeholder="Acme Store" /></label><label className="field">URL<input required type="url" name="url" placeholder="https://store.example.com" /></label><label className="field">Descrizione<textarea name="description" rows={3} /></label>{error && <Notice kind="error">{error}</Notice>}<div className="dialog-actions"><button type="button" className="button" onClick={() => setFormOpen(false)}>Annulla</button><button className="button primary">Crea progetto</button></div></form></Modal>}
  </Shell>;
}
