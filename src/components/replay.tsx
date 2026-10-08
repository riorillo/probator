"use client";

import { Replayer } from "rrweb";
import { useEffect, useRef, useState } from "react";

export function Replay({ executionId, active, onAvailabilityChange }: { executionId: string; active: boolean; onAvailabilityChange?: (available: boolean) => void }) {
  const host = useRef<HTMLDivElement>(null);
  const replayerRef = useRef<Replayer | undefined>(undefined);
  const [error, setError] = useState("");
  const [count, setCount] = useState(0);
  const [recordingStatus, setRecordingStatus] = useState<string | null>(null);
  const [position, setPosition] = useState(0);
  const [duration, setDuration] = useState(0);
  const [playing, setPlaying] = useState(true);
  const [speed, setSpeed] = useState(1);
  useEffect(() => {
    let current = true;
    let timer: ReturnType<typeof setTimeout>;
    let replayer: Replayer | undefined;
    const load = async () => {
      try {
        const response = await fetch(`/api/executions/${executionId}/replay`, { cache: "no-store" });
        const data = await response.json() as { events?: unknown[]; error?: string; status?: string; manifest?: { status?: string } | null };
        if (!current) return;
        if (!response.ok) throw new Error(data.error || "Replay non disponibile.");
        onAvailabilityChange?.(Boolean(data.events?.length));
        if (data.events?.length && host.current) {
          replayer?.destroy();
          host.current.replaceChildren();
          replayer = new Replayer(data.events as never[], { root: host.current, showWarning: false, showDebug: false, skipInactive: true });
          replayerRef.current = replayer;
          replayer.play();
          setCount(data.events.length);
          setDuration(replayer.getMetaData().totalTime);
          setPosition(0);
          setPlaying(true);
        }
        setRecordingStatus(data.manifest?.status ?? (data.status === "running" ? null : "partial"));
        setError("");
        if (active && data.status === "running") timer = setTimeout(load, 2500);
      } catch (cause) {
        if (current) setError(cause instanceof Error ? cause.message : "Replay non disponibile.");
        if (current) onAvailabilityChange?.(false);
        if (current && active) timer = setTimeout(load, 4000);
      }
    };
    void load();
    return () => { current = false; clearTimeout(timer); replayer?.destroy(); if (replayerRef.current === replayer) replayerRef.current = undefined; };
  }, [executionId, active, onAvailabilityChange]);
  useEffect(() => {
    if (!replayerRef.current) return;
    const ticker = setInterval(() => setPosition(replayerRef.current?.getCurrentTime() ?? 0), 250);
    return () => clearInterval(ticker);
  }, [count]);
  function togglePlayback() {
    const player = replayerRef.current;
    if (!player) return;
    if (playing) player.pause(); else player.resume();
    setPlaying(!playing);
  }
  function seek(time: number) {
    replayerRef.current?.play(time);
    setPosition(time);
    setPlaying(true);
  }
  function changeSpeed(value: number) {
    setSpeed(value);
    replayerRef.current?.setConfig({ speed: value });
  }
  const waiting = recordingStatus === "partial" ? "Registrazione parziale: replay non disponibile per questo tentativo." : recordingStatus === "complete" ? "La registrazione è completa ma non contiene eventi riproducibili." : "In attesa dei primi eventi registrati…";
  const eventsLabel = `${count.toLocaleString("it-IT")} eventi · ${recordingStatus === "partial" ? "registrazione parziale · " : ""}contenuti acquisiti integralmente`;
  return <div className="replay-wrap"><div className="replay-status" role="status">{error || (count ? eventsLabel : waiting)}</div><div className="replay-controls"><button className="button" onClick={togglePlayback} disabled={!count}>{playing ? "Pausa" : "Riprendi"}</button><span className="mono">{format(position)} / {format(duration)}</span><input aria-label="Posizione replay" type="range" min="0" max={Math.max(1, duration)} step="100" value={Math.min(position, duration)} disabled={!count} onChange={(event) => seek(Number(event.target.value))} /><label>Velocità<select aria-label="Velocità replay" value={speed} onChange={(event) => changeSpeed(Number(event.target.value))}><option value="0.5">0,5×</option><option value="1">1×</option><option value="2">2×</option><option value="4">4×</option></select></label></div><div className="replay-host" ref={host} /></div>;
}

function format(milliseconds: number) {
  const seconds = Math.max(0, Math.floor(milliseconds / 1000));
  return `${Math.floor(seconds / 60).toString().padStart(2, "0")}:${(seconds % 60).toString().padStart(2, "0")}`;
}
