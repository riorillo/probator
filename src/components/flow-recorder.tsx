"use client";

import Link from "next/link";
import { useCallback, useEffect, useRef, useState, type KeyboardEvent, type MouseEvent, type PointerEvent } from "react";
import { useRouter } from "next/navigation";
import { Notice, PageHeading, Shell } from "@/components/shell";
import { StepsEditor, type StepDraft } from "@/components/steps-editor";

type RecordingEvent = { sequence: number; kind: string; payload: Record<string, unknown>; created_at: string; key?: string };
type RecordingCommand = { sequence: number; kind: string; status: string; created_at: string };
type RecordingData = { id: string; project_id: string; project_name: string; title: string; status: string; start_url: string; error: string | null; frame_url: string | null; frame_version: number; stream_port: number; events: RecordingEvent[]; commands: RecordingCommand[] };
type VariableDraft = { name: string; description: string; secret: boolean; defaultValue: string };
type Suggestion = { title: string; objective: string; steps: StepDraft[]; variables: VariableDraft[] };
const supportedKeys = new Set(["Enter", "Tab", "Escape", "Backspace", "Delete", "ArrowUp", "ArrowDown", "ArrowLeft", "ArrowRight", "Home", "End", "PageUp", "PageDown", " "]);

export function FlowRecorder({ projectId, recordingId }: { projectId: string; recordingId: string }) {
  const router = useRouter();
  const [data, setData] = useState<RecordingData | null>(null);
  const [suggestion, setSuggestion] = useState<Suggestion | null>(null);
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);
  const [commandBusy, setCommandBusy] = useState(false);
  const [streamConnected, setStreamConnected] = useState(false);
  const [streamAttempted, setStreamAttempted] = useState(false);
  const [liveFrameReceived, setLiveFrameReceived] = useState(false);
  const [screenSelected, setScreenSelected] = useState(false);
  const viewport = useRef<HTMLDivElement>(null);
  const canvas = useRef<HTMLCanvasElement>(null);
  const image = useRef<HTMLImageElement>(null);
  const stream = useRef<WebSocket | null>(null);
  const hasLiveFrame = useRef(false);
  const pendingStreamCommands = useRef(new Map<string, (ok: boolean, error?: string) => void>());
  const commandQueue = useRef<Promise<void>>(Promise.resolve());
  const typedBuffer = useRef("");
  const typedBufferTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const lastEventSequence = useRef(0);
  const lastCommandSequence = useRef(0);
  const suggested = useRef(false);
  const wheelPending = useRef(false);
  const lastPointer = useRef({ x: 560, y: 390 });

  const load = useCallback(async () => {
    const response = await fetch(`/api/recordings/${recordingId}?after=${lastEventSequence.current}&afterCommand=${lastCommandSequence.current}`, { cache: "no-store" });
    const body = await response.json();
    if (!response.ok) { setError(body.error); return; }
    if (body.events.length) lastEventSequence.current = body.events.at(-1).sequence;
    if (body.commands.length) lastCommandSequence.current = body.commands.at(-1).sequence;
    setData((current) => ({ ...body, events: [...(current?.events ?? []), ...body.events], commands: [...(current?.commands ?? []), ...body.commands] }));
  }, [recordingId]);

  useEffect(() => {
    setData(null); lastEventSequence.current = 0; lastCommandSequence.current = 0; suggested.current = false;
    let active = true;
    let timer: ReturnType<typeof setTimeout>;
    async function poll() {
      if (!active) return;
      await load();
      if (!active) return;
      timer = setTimeout(poll, 800);
    }
    void poll();
    return () => { active = false; clearTimeout(timer); };
  }, [load]);

  useEffect(() => {
    if (data?.status !== "recording" || !data.stream_port) return;
    let active = true;
    let retry: ReturnType<typeof setTimeout> | undefined;
    let socket: WebSocket | null = null;
    let pendingFrame: ArrayBuffer | null = null;
    let decoding = false;
    const drawPendingFrames = async () => {
      if (decoding) return;
      decoding = true;
      try {
        while (active && pendingFrame) {
          const frame = pendingFrame;
          pendingFrame = null;
          try {
            const bitmap = await createImageBitmap(new Blob([frame], { type: "image/jpeg" }));
            if (!active) { bitmap.close(); break; }
            const context = canvas.current?.getContext("2d", { alpha: false });
            if (context) {
              context.drawImage(bitmap, 0, 0, canvas.current!.width, canvas.current!.height);
              if (!hasLiveFrame.current) {
                hasLiveFrame.current = true;
                setLiveFrameReceived(true);
              }
            }
            bitmap.close();
          } catch { /* Keep the last complete frame visible if one frame is malformed. */ }
        }
      } finally { decoding = false; }
    };
    setStreamAttempted(false);
    const connect = () => {
      if (!active) return;
      const protocol = window.location.protocol === "https:" ? "wss:" : "ws:";
      socket = new WebSocket(`${protocol}//127.0.0.1:${data.stream_port}/recordings/${recordingId}`);
      socket.binaryType = "arraybuffer";
      stream.current = socket;
      socket.onopen = () => { if (active) setStreamConnected(true); };
      socket.onmessage = (message) => {
        if (message.data instanceof ArrayBuffer) {
          // Decode frames away from the DOM and paint into a persistent canvas.
          // Replacing <img src> for every frame clears the previous image while
          // the next JPEG decodes, which looks like continuous flashing.
          pendingFrame = message.data;
          void drawPendingFrames();
          return;
        }
        if (typeof message.data !== "string") return;
        try {
          const ack = JSON.parse(message.data) as { type?: string; requestId?: string; ok?: boolean; error?: string };
          if (ack.type === "command_error") {
            setError(ack.error ?? "Il browser non ha completato l’azione.");
            return;
          }
          if (ack.type !== "command_ack" || !ack.requestId) return;
          pendingStreamCommands.current.get(ack.requestId)?.(ack.ok === true, ack.error);
          pendingStreamCommands.current.delete(ack.requestId);
        } catch { /* Ignore messages that are not stream acknowledgements. */ }
      };
      socket.onclose = () => {
        if (stream.current === socket) stream.current = null;
        if (active) { setStreamConnected(false); setStreamAttempted(true); retry = setTimeout(connect, 2_000); }
        for (const finish of pendingStreamCommands.current.values()) finish(false, "Connessione live interrotta.");
        pendingStreamCommands.current.clear();
      };
      socket.onerror = () => socket?.close();
    };
    connect();
    return () => {
      active = false;
      if (retry) clearTimeout(retry);
      if (typedBufferTimer.current) clearTimeout(typedBufferTimer.current);
      typedBufferTimer.current = null;
      typedBuffer.current = "";
      socket?.close();
      if (stream.current === socket) stream.current = null;
      setStreamConnected(false);
      setStreamAttempted(false);
      setLiveFrameReceived(false);
      for (const finish of pendingStreamCommands.current.values()) finish(false, "Connessione live chiusa.");
      pendingStreamCommands.current.clear();
      pendingFrame = null;
      hasLiveFrame.current = false;
    };
  }, [data?.status, data?.stream_port, recordingId]);

  useEffect(() => {
    if (!hasLiveFrame.current && data?.frame_url && image.current) image.current.src = `${data.frame_url}&frame=${data.frame_version}`;
  }, [data?.frame_url, data?.frame_version]);

  useEffect(() => {
    const element = viewport.current;
    if (!element || data?.status !== "recording") return;
    const handleWheel = (event: globalThis.WheelEvent) => {
      if (!screenSelected) return;
      event.preventDefault();
      event.stopPropagation();
      event.stopImmediatePropagation();
      if (wheelPending.current) return;
      wheelPending.current = true;
      const bounds = element.getBoundingClientRect();
      if (element.contains(event.target as Node)) {
        lastPointer.current = { x: Math.round((event.clientX - bounds.left) * 1120 / bounds.width), y: Math.round((event.clientY - bounds.top) * 780 / bounds.height) };
      }
      void send("scroll", { ...lastPointer.current, deltaX: Math.round(event.deltaX), deltaY: Math.round(event.deltaY) }).finally(() => {
        setTimeout(() => { wheelPending.current = false; }, 30);
      });
    };
    window.addEventListener("wheel", handleWheel, { passive: false, capture: true });
    return () => window.removeEventListener("wheel", handleWheel, { capture: true });
  }, [data?.status, screenSelected, recordingId]);

  useEffect(() => {
    if (data?.status !== "stopped" || suggested.current) return;
    suggested.current = true;
    setBusy(true);
    void fetch(`/api/recordings/${recordingId}/suggest`, { method: "POST" }).then(async (response) => {
      const body = await response.json();
      if (!response.ok) { setError(body.error); return; }
      setSuggestion(body);
      setError("");
    }).catch((cause) => setError(cause instanceof Error ? cause.message : "Impossibile preparare il flusso.")).finally(() => setBusy(false));
  }, [data?.status, recordingId]);

  async function send(kind: string, payload: Record<string, unknown>) {
    if (data?.status !== "recording") return;
    if (kind !== "type") await flushTypedBuffer();
    const task = commandQueue.current.then(async () => {
      setCommandBusy(true);
      try {
        const socket = stream.current;
        if (socket?.readyState === WebSocket.OPEN) {
          const requestId = crypto.randomUUID();
          let ackError: string | undefined;
          const ok = await new Promise<boolean>((resolve) => {
            const timeout = setTimeout(() => { pendingStreamCommands.current.delete(requestId); resolve(false); }, 5_000);
            pendingStreamCommands.current.set(requestId, (success, message) => { clearTimeout(timeout); ackError = message; resolve(success); });
            socket.send(JSON.stringify({ type: "command", requestId, kind, payload }));
          });
          if (!ok) setError(ackError ?? "Il browser non ha confermato l’azione.");
          return;
        }
        const response = await fetch(`/api/recordings/${recordingId}/commands`, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ kind, ...payload }) });
        const body = await response.json();
        if (!response.ok) setError(body.error);
      } finally { setCommandBusy(false); }
    });
    commandQueue.current = task.catch(() => { setCommandBusy(false); });
    await task;
  }

  function click(event: MouseEvent<HTMLDivElement>) {
    if ((!data?.frame_url && !hasLiveFrame.current) || !viewport.current) return;
    setScreenSelected(true);
    viewport.current.focus();
    const bounds = event.currentTarget.getBoundingClientRect();
    lastPointer.current = { x: Math.round((event.clientX - bounds.left) * 1120 / bounds.width), y: Math.round((event.clientY - bounds.top) * 780 / bounds.height) };
    void send("click", lastPointer.current);
  }

  function pointerMove(event: PointerEvent<HTMLDivElement>) {
    const bounds = event.currentTarget.getBoundingClientRect();
    lastPointer.current = { x: Math.round((event.clientX - bounds.left) * 1120 / bounds.width), y: Math.round((event.clientY - bounds.top) * 780 / bounds.height) };
  }

  function keydown(event: KeyboardEvent<HTMLDivElement>) {
    if (!screenSelected) return;
    event.stopPropagation();
    if (event.key.length === 1 && !event.metaKey && !event.ctrlKey && !event.altKey) {
      event.preventDefault();
      typedBuffer.current += event.key;
      if (typedBufferTimer.current) clearTimeout(typedBufferTimer.current);
      typedBufferTimer.current = setTimeout(() => { typedBufferTimer.current = null; void flushTypedBuffer(); }, 35);
      return;
    }
    event.preventDefault();
    if (supportedKeys.has(event.key)) void send("key", { key: event.key });
  }

  function selectScreen() {
    if (screenSelected) {
      setScreenSelected(false);
      viewport.current?.blur();
      return;
    }
    setScreenSelected(true);
    viewport.current?.focus();
  }

  async function stop() {
    await flushTypedBuffer();
    setBusy(true); setError("");
    const response = await fetch(`/api/recordings/${recordingId}`, { method: "POST" });
    const body = await response.json();
    setBusy(false);
    if (!response.ok) setError(body.error);
    else await load();
  }

  async function cancel() {
    setBusy(true); setError("");
    try {
      const response = await fetch(`/api/recordings/${recordingId}`, { method: "DELETE" });
      const body = await response.json();
      if (!response.ok) { setError(body.error); return; }
      await load();
    } catch (cause) { setError(cause instanceof Error ? cause.message : "Impossibile annullare la registrazione."); }
    finally { setBusy(false); }
  }

  async function flushTypedBuffer() {
    if (typedBufferTimer.current) clearTimeout(typedBufferTimer.current);
    typedBufferTimer.current = null;
    const text = typedBuffer.current;
    typedBuffer.current = "";
    if (text) await send("type", { text });
  }

  async function saveFlow() {
    if (!suggestion) return;
    setBusy(true); setError("");
    const response = await fetch(`/api/recordings/${recordingId}/save`, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(suggestion) });
    const body = await response.json(); setBusy(false);
    if (!response.ok) { setError(body.error); return; }
    router.push(`/projects/${projectId}/tests/${body.id}`);
  }

  const storedCommandSequences = new Set((data?.events ?? []).flatMap((event) => [event.payload.commandSequence, ...(Array.isArray(event.payload.commandSequences) ? event.payload.commandSequences : [])]).map(Number).filter(Number.isFinite));
  const recoveredCommands: RecordingEvent[] = (data?.commands ?? []).filter((command) => command.status === "done" && ["click", "type", "key", "scroll"].includes(command.kind) && !storedCommandSequences.has(command.sequence)).map((command) => ({ sequence: command.sequence, key: `command-${command.sequence}`, kind: command.kind === "type" ? "fill" : command.kind, payload: { recovered: true }, created_at: command.created_at }));
  const events = [...(data?.events.filter((item) => ["click", "fill", "select", "submit", "page_loaded", "scroll", "key"].includes(item.kind)) ?? []), ...recoveredCommands].sort((a, b) => Date.parse(a.created_at) - Date.parse(b.created_at));
  return <Shell projectId={projectId} projectName={data?.project_name} page="recording">
    <PageHeading title={data?.status === "stopped" ? "Rivedi il flusso registrato" : data?.status === "cancelled" ? "Registrazione annullata" : "Registra un flusso"} description={data?.start_url ?? "Preparazione del browser interattivo…"}>
      <Link className="button" href={`/projects/${projectId}`}>← Board</Link>
      {data?.status === "recording" && <><button className="button" disabled={busy} onClick={() => void cancel()}>{busy ? "Annullamento…" : "Annulla e scarta"}</button><button className="button primary" disabled={busy} onClick={() => void stop()}>{busy ? "Chiusura…" : "■ Termina registrazione"}</button></>}
    </PageHeading>
    {error && <Notice kind="error">{error}</Notice>}
    {data?.status === "failed" && <Notice kind="error">{data.error ?? "Il browser non è riuscito ad avviare la registrazione."}</Notice>}
    {data?.status === "saved" && <div className="panel"><h2>Flusso già salvato</h2><p className="muted small">La registrazione è stata convertita in un test riutilizzabile.</p><Link className="button primary" href={`/projects/${projectId}`}>Torna alla board</Link></div>}
    {data?.status === "cancelled" && <div className="panel"><h2>Registrazione annullata</h2><p className="muted small">Il browser è stato chiuso. Non è stata generata alcuna proposta dal modello.</p><Link className="button primary" href={`/projects/${projectId}`}>Torna alla board</Link></div>}
    {data && !["stopped", "failed", "saved", "cancelled"].includes(data.status) && <div className="recorder-layout">
      <section className="panel recorder-browser-panel">
        <div className="panel-heading"><div><h2>Browser interattivo</h2><p className="muted small">Seleziona la schermata per controllare la pagina; spostando il focus sull’app, tastiera e rotella tornano ai controlli dell’app.</p></div><div className="recorder-controls"><button type="button" className={`button ${screenSelected ? "primary" : ""}`} aria-pressed={screenSelected} onMouseDown={(event) => event.preventDefault()} onClick={selectScreen}>Controlli: {screenSelected ? "pagina" : "app"}</button><span className={`badge ${streamConnected ? "running" : "neutral"}`}>{streamConnected ? "● Live continuo" : streamAttempted ? "○ Modalità compatibilità" : data.status === "recording" ? "○ Connessione live…" : "Avvio browser…"}</span></div></div>
        <div ref={viewport} className={`recorder-viewport ${screenSelected ? "recorder-viewport-selected" : ""} ${commandBusy ? "command-pending" : ""}`} tabIndex={0} onClick={click} onPointerMove={pointerMove} onFocus={() => setScreenSelected(true)} onBlur={() => setScreenSelected(false)} onKeyDown={keydown} aria-label="Browser controllato per la registrazione">
          <img ref={image} alt="Pagina web interattiva" draggable={false} hidden={liveFrameReceived || !data.frame_url} decoding="async" />
          <canvas ref={canvas} className="recorder-live-canvas" width={1120} height={780} hidden={!liveFrameReceived} aria-label="Flusso live del browser" />
          {!data.frame_url && !liveFrameReceived && <div className="recorder-placeholder">Collegamento al browser…</div>}
          {commandBusy && <span className="recorder-pending">Invio azione…</span>}
        </div>
        <p className="muted small recorder-help">Per compilare un campo, cliccalo nell’anteprima e digita. I valori inseriti saranno proposti come parametri prima di salvare il test.</p>
      </section>
      <aside className="panel recorder-log"><h2>Azioni rilevate <span className="badge neutral">{events.length}</span></h2><div className="recorded-events">{events.slice(-30).reverse().map((event) => <div className="recorded-event" key={event.sequence}><span className="action-marker">{event.kind === "click" ? "↗" : event.kind === "fill" ? "⌨" : event.kind === "page_loaded" ? "↻" : event.kind === "scroll" ? "↕" : "•"}</span><div><strong>{eventTitle(event.kind)}</strong><small>{eventDetail(event)}</small></div></div>)}{events.length === 0 && <p className="muted small">Le interazioni appariranno qui.</p>}</div></aside>
    </div>}
    {data?.status === "stopped" && (busy || !suggestion) && <div className="panel flow-generating"><div className="spinner"/><div><h2>Preparazione del flusso</h2><p className="muted">Il modello sta proponendo gli step e le condizioni di passing dalla registrazione.</p></div></div>}
    {suggestion && <section className="panel flow-review">
      <div className="panel-heading"><div><h2>Rivedi gli step e il passing</h2><p className="muted small">Le condizioni suggerite sono modificabili. Confermale prima di salvare il test.</p></div><span className="badge neutral">{suggestion.steps.length} step · {suggestion.variables.length} parametri</span></div>
      <label className="field">Titolo<input value={suggestion.title} onChange={(event) => setSuggestion({ ...suggestion, title: event.target.value })} /></label>
      <label className="field">Obiettivo<textarea rows={2} value={suggestion.objective} onChange={(event) => setSuggestion({ ...suggestion, objective: event.target.value })} /></label>
      <div className="field"><span>Step e condizioni di passing</span><small>Il modello le propone dalla pagina osservata; rivedi che descrivano il risultato che ti aspetti.</small><StepsEditor steps={suggestion.steps} onChange={(steps) => setSuggestion({ ...suggestion, steps })} /></div>
      <div className="field"><span>Parametri riutilizzabili</span><small>Questi valori verranno richiesti o potranno essere modificati a ogni esecuzione.</small><div className="recorded-variables">{suggestion.variables.map((variable, index) => <div className="recorded-variable" key={`${variable.name}-${index}`}><label className="field">Nome<input value={variable.name} onChange={(event) => updateVariable(index, { name: event.target.value })} /></label><label className="field">Descrizione<input value={variable.description} onChange={(event) => updateVariable(index, { description: event.target.value })} /></label><label className="field">Valore predefinito<input type={variable.secret ? "password" : "text"} value={variable.defaultValue} onChange={(event) => updateVariable(index, { defaultValue: event.target.value })} placeholder={variable.secret ? "Valore segreto richiesto al run" : "Valore iniziale"} /></label><div className="recorded-variable-footer"><label className="checkbox-field"><input type="checkbox" checked={variable.secret} onChange={(event) => updateVariable(index, { secret: event.target.checked, defaultValue: event.target.checked ? "" : variable.defaultValue })} /><span>Valore segreto</span></label><button className="text-button" type="button" onClick={() => setSuggestion({ ...suggestion, variables: suggestion.variables.filter((_, at) => at !== index) })}>Rimuovi parametro</button></div></div>)}{suggestion.variables.length === 0 && <p className="muted small">Nessun parametro rilevato. Puoi inserirli nei testi usando la sintassi {"{{nome}}"}.</p>}</div></div>
      <div className="dialog-actions"><button className="button primary" disabled={busy || suggestion.steps.length === 0} onClick={() => void saveFlow()}>{busy ? "Salvataggio…" : "Salva come test"}</button></div>
    </section>}
  </Shell>;

  function updateVariable(index: number, patch: Partial<VariableDraft>) {
    if (!suggestion) return;
    setSuggestion({ ...suggestion, variables: suggestion.variables.map((variable, at) => at === index ? { ...variable, ...patch } : variable) });
  }
}

function asRecord(value: unknown): Record<string, unknown> { return typeof value === "object" && value !== null && !Array.isArray(value) ? value as Record<string, unknown> : {}; }

function eventTitle(kind: string) {
  if (kind === "page_loaded") return "Pagina aperta";
  if (kind === "fill") return "Campo compilato";
  if (kind === "select") return "Opzione selezionata";
  if (kind === "submit") return "Modulo inviato";
  if (kind === "scroll") return "Scorrimento pagina";
  if (kind === "key") return "Tasto premuto";
  return "Elemento cliccato";
}

function eventDetail(event: RecordingEvent) {
  if (event.payload.recovered === true) {
    if (event.kind === "fill") return "Testo inserito · dettaglio non recuperabile in questa sessione";
    if (event.kind === "scroll") return "Scorrimento · direzione non recuperabile in questa sessione";
    if (event.kind === "key") return "Tasto · dettaglio non recuperabile in questa sessione";
    return "Click · elemento non identificabile in questa sessione";
  }
  if (event.kind === "key" && typeof event.payload.key === "string") return event.payload.key;
  const element = asRecord(event.payload.element);
  if (element.name || element.role) return String(element.name ?? element.role);
  if (event.kind === "scroll") {
    const deltaY = Number(event.payload.deltaY ?? 0);
    const deltaX = Number(event.payload.deltaX ?? 0);
    if (Math.abs(deltaY) >= Math.abs(deltaX)) return deltaY >= 0 ? "Verso il basso" : "Verso l’alto";
    return deltaX >= 0 ? "Verso destra" : "Verso sinistra";
  }
  return String(event.payload.url ?? "Elemento rilevato");
}
