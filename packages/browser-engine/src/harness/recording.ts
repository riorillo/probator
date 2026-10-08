import { join } from "node:path";
import { mkdir } from "node:fs/promises";
import type { Page } from "../browser/types.ts";

const FIRST = "000000.jpg";

/** Starts a recording: the directory is created and the first frame is stored. */
export async function start(dir: string, page: Page): Promise<void> {
  await mkdir(dir, { recursive: true });
  await store(dir, FIRST, page.screenshot);
}

/** Stores one step of a recording, named after the elapsed milliseconds of the run. */
export async function store(dir: string, name: string, screenshot: string | undefined): Promise<void> {
  if (!screenshot) return;
  await Bun.write(join(dir, name), Buffer.from(screenshot, "base64"));
}

/** The frame name of a step: the elapsed milliseconds, zero padded to six digits. */
export function frame(elapsedMs: number): string {
  return `${String(elapsedMs).padStart(6, "0")}.jpg`;
}
