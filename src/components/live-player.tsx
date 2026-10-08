"use client";

import { useEffect, useRef, useState } from "react";

export type LiveFrame = {
  id: string;
  checksum: string | null;
  step_position: number | null;
  created_at: string;
};

export function LivePlayer({ executionId, frames, active }: { executionId: string; frames: LiveFrame[]; active: boolean }) {
  const [position, setPosition] = useState(0);
  const [playing, setPlaying] = useState(false);
  const [speed, setSpeed] = useState(1);
  const [following, setFollowing] = useState(active);
  const wasActive = useRef(active);
  const current = frames[position];

  useEffect(() => {
    if (active && following) setPosition(Math.max(0, frames.length - 1));
  }, [active, following, frames.length]);

  useEffect(() => {
    if (wasActive.current && !active) {
      setFollowing(false);
      setPosition(0);
      setPlaying(frames.length > 1);
    } else if (!wasActive.current && active) {
      setFollowing(true);
      setPlaying(false);
    }
    wasActive.current = active;
  }, [active, frames.length]);

  useEffect(() => {
    if (!playing || following || frames.length < 2) return;
    if (position >= frames.length - 1) {
      setPlaying(false);
      return;
    }
    const currentTime = new Date(frames[position].created_at).getTime();
    const nextTime = new Date(frames[position + 1].created_at).getTime();
    const delay = Math.max(350, Math.min(2500, nextTime - currentTime || 1000)) / speed;
    const timer = setTimeout(() => setPosition((value) => Math.min(value + 1, frames.length - 1)), delay);
    return () => clearTimeout(timer);
  }, [playing, following, frames, position, speed]);

  function seek(value: number) {
    setFollowing(false);
    setPlaying(false);
    setPosition(value);
  }

  return <div className="live-player">
    {current ? <figure className="live-frame">
      <img src={`/api/executions/${executionId}/artifacts/${current.id}?v=${current.checksum ?? ""}`} alt={`Frame ${position + 1}, step ${(current.step_position ?? 0) + 1}`} />
      <figcaption>Frame {position + 1} di {frames.length} · Step {(current.step_position ?? 0) + 1} · {new Date(current.created_at).toLocaleTimeString("it-IT")}</figcaption>
    </figure> : <div className="evidence-empty">{active ? "In attesa del primo frame…" : "Nessun frame Live salvato."}</div>}
    <div className="replay-controls live-player-controls">
      <button className="button" type="button" onClick={() => { setFollowing(false); setPosition(0); setPlaying(false); }} disabled={!frames.length} aria-label="Vai al primo frame">|◀</button>
      <button className="button" type="button" onClick={() => { if (position >= frames.length - 1) setPosition(0); setFollowing(false); setPlaying((value) => !value); }} disabled={frames.length < 2} aria-label={playing ? "Pausa replay" : "Riproduci replay"}>{playing ? "❚❚" : "▶"}</button>
      <input aria-label="Posizione nel replay" type="range" min="0" max={Math.max(0, frames.length - 1)} value={Math.min(position, Math.max(0, frames.length - 1))} onChange={(event) => seek(Number(event.target.value))} disabled={frames.length < 2} />
      <span className="mono live-player-count">{frames.length ? `${position + 1}/${frames.length}` : "0/0"}</span>
      <label>Velocità <select value={speed} onChange={(event) => setSpeed(Number(event.target.value))}><option value={0.5}>0,5×</option><option value={1}>1×</option><option value={2}>2×</option><option value={4}>4×</option></select></label>
      {active && <button className={`button ${following ? "is-live" : ""}`} type="button" onClick={() => { setFollowing(true); setPosition(Math.max(0, frames.length - 1)); setPlaying(false); }}>● Live</button>}
      <span className="sr-only" aria-live="polite">{active ? following ? "Live: segue l’ultimo frame" : "Esecuzione attiva, replay in pausa" : playing ? "Replay in riproduzione" : "Replay in pausa"}</span>
    </div>
  </div>;
}
