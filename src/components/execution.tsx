"use client";

import Link from "next/link";
import { useEffect, useState } from "react";
import { Notice, PageHeading, Shell } from "@/components/shell";
import { Replay } from "@/components/replay";
import { LiveFrame, LivePlayer } from "@/components/live-player";
import { ActionTimeline } from "@/components/action-timeline";

type Result = { id: string; position: number; completion_condition: string; observed: string; status: string; error_detail: string | null };
type CheckResult = { id: string; position: number; expected: string; observed: string; status: string; error_detail: string | null };
type ExecutionData = {
  id: string; test_id: string; project_id: string; project_name: string; test_title: string; status: string; phase: string; mode: string; effective_url: string; environment: string; started_at: string | null; finished_at: string | null; error: string | null;
  definition: { title: string; version: number; steps: Array<{ instruction: string; completionCondition?: string; expected?: string }> };
  steps: Result[]; checks: CheckResult[];
  artifacts: Array<LiveFrame & { kind: string; status: string; mime_type: string; size_bytes: number | null }>;
  events: Array<{ sequence: number; kind: string; payload: Record<string, unknown>; created_at: string }>;
};

const stateText: Record<string, string> = { queued: "In coda", starting: "Avvio browser", executing: "Esecuzione", evaluating: "Valutazione", finished: "Completata" };

function resultBadge(status: string) {
  const [kind, label] = status === "passed" ? ["passed", "Superato"] : status === "failed" ? ["failed", "Fallito"] : status === "running" ? ["running", "In corso"] : status === "pending" ? ["neutral", "In attesa"] : ["blocked", "Non verificabile"];
  return <span className={`badge ${kind}`}>{label}</span>;
}

export function Execution({ executionId }: { executionId: string }) {
  const [data, setData] = useState<ExecutionData | null>(null);
  const [error, setError] = useState("");
  const [replayAvailable, setReplayAvailable] = useState<boolean | null>(null);

  useEffect(() => {
    setReplayAvailable(null);
    let active = true;
    let timer: ReturnType<typeof setTimeout>;
    async function poll() {
      const response = await fetch(`/api/executions/${executionId}`);
      const body = await response.json();
      if (!active) return;
      if (!response.ok) setError(body.error);
      else { setData(body); setError(""); }
      if (!body.finished_at && body.status === "running") timer = setTimeout(poll, 1500);
    }
    void poll();
    return () => { active = false; clearTimeout(timer); };
  }, [executionId]);

  const status = data?.status === "passed" ? ["passed", "✓ Superata"] : data?.status === "failed" ? ["failed", "× Fallita"] : data?.status === "blocked" ? ["blocked", "! Bloccata"] : ["running", data?.phase === "queued" ? "◷ In coda" : "◷ In corso"];
  const liveFrames = data?.artifacts.filter((item) => item.kind === "screenshot" && item.status === "ready") ?? [];

  return <Shell projectId={data?.project_id} projectName={data?.project_name} page="execution" testName={data?.definition.title} testHref={data ? `/projects/${data.project_id}/tests/${data.test_id}` : undefined}>
    <PageHeading title={data?.definition.title ?? "Esecuzione"} description={`${data?.id ?? executionId} · Versione ${data?.definition.version ?? "—"}`}>
      <Link className="button" href={data?.project_id ? `/projects/${data.project_id}` : "/"}>← Board</Link>
    </PageHeading>
    {error && <Notice kind="error">{error}</Notice>}
    {!data && !error && <div className="skeleton" aria-label="Caricamento esecuzione" />}
    {data && <>
      <div className="execution-summary">
        <div><small>Esito</small><span className={`badge ${status[0]}`}>{status[1]}</span></div>
        <div><small>Modalità</small><strong>{data.mode === "recording" ? "Con replay" : "Live"}</strong></div>
        <div><small>Fase</small><strong>{stateText[data.phase] ?? data.phase}</strong></div>
        <div><small>Avvio</small><strong>{data.started_at ? new Date(data.started_at).toLocaleString("it-IT") : "In attesa"}</strong></div>
        <div><small>Ambiente</small><code>{data.environment}</code></div>
      </div>
      {data.status === "running" && <div className="live-notice" role="status">Il worker continua anche se chiudi questa pagina. Aggiornamento automatico attivo.</div>}
      {data.error && <Notice kind="error">{data.error}</Notice>}
      <div className="execution-layout">
        <section className="panel">
          <ActionTimeline steps={data.definition.steps} results={data.steps} events={data.events} active={data.status === "running"} />
          <div className="final-checks">
            <h2>Controlli finali</h2>
            {data.checks.length ? data.checks.map((check) => <div className="check-result" key={check.id}><span>{check.expected}</span>{resultBadge(check.status)}<small>{check.observed}</small></div>) : <p className="muted">Nessun controllo finale definito.</p>}
          </div>
          <p className="note">Il modello valuta la condizione usando le azioni registrate e la pagina finale.</p>
        </section>
        <section className="panel evidence-panel">
          <div className="panel-heading"><h2>{data.mode === "recording" ? "Replay rrweb" : "Sessione Live · Replay"}</h2><span className="mono">{data.id.slice(0, 8)}</span></div>
          {data.mode === "recording" ? <Replay executionId={data.id} active={data.status === "running"} /> : data.status === "running" ? <div className="browser-frame">
            <div className="browser-toolbar"><i/><i/><i/><span>{new URL(data.effective_url).origin}</span></div>
            <LivePlayer executionId={data.id} frames={liveFrames} active={data.status === "running"} />
          </div> : <div className="browser-frame">
            <div className="browser-toolbar"><i/><i/><i/><span>{new URL(data.effective_url).origin}</span></div>
            {replayAvailable === false && <><LivePlayer executionId={data.id} frames={liveFrames} active={false} /><p className="replay-fallback-note">Per questa sessione è disponibile la riproduzione dei frame acquisiti.</p></>}
            {replayAvailable !== false && <Replay executionId={data.id} active={false} onAvailabilityChange={setReplayAvailable} />}
          </div>}
          <div className="artifact-list">
            <h3>Artefatti persistenti</h3>
            {data.artifacts.length ? data.artifacts.map((item) => <div className="artifact-row" key={item.id}>
              <span>{item.kind} · {item.mime_type}</span>
              <span className={`badge ${item.status === "ready" ? "passed" : item.status === "error" ? "failed" : "running"}`}>{item.status === "ready" ? "Disponibile" : item.status}</span>
              {item.status === "ready" && item.kind !== "rrweb_chunk" && <Link href={`/api/executions/${data.id}/artifacts/${item.id}`} target="_blank" rel="noreferrer">Apri</Link>}
            </div>) : <p className="muted">Le prove saranno salvate durante l’esecuzione.</p>}
          </div>
        </section>
      </div>
    </>}
  </Shell>;
}
