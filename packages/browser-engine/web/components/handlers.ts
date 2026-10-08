/** Everything a component can ask for, so no component reaches into the store itself. */

import type { FormEvent } from "react";

import { save } from "../download.ts";
import * as fields from "../model/fields.ts";
import * as trace from "../model/trace.ts";
import * as drive from "../store/drive.ts";

/** One edited field. */
export function set(key: fields.Key, value: string): void {
  drive.edit(key, value);
}

/** Starts a run, leaving the goal to the validation of the browser itself. */
export function submit(event: FormEvent<HTMLFormElement>): void {
  event.preventDefault();
  void drive.start();
}

/** Pauses after the request in flight. */
export function pauseRun(): void {
  drive.pause();
}

/** The overlay on and off. */
export function markOverlays(next: boolean): void {
  drive.mark(next);
}

/** The shortcut on and off. */
export function speedUp(next: boolean): void {
  drive.speed(next);
}

/** The snapshot of the next run: text, or a frame with the numbered boxes of the elements. */
export function snapshotAsImage(next: boolean): void {
  drive.vision(next);
}

/** Saves the trace of the run in hand. */
export function traceIt(state: unknown): void {
  save(trace.trace(state), trace.NAME);
}
