import { existsSync } from "node:fs";
import { readFile } from "node:fs/promises";
import { join } from "node:path";

export const DEFAULT_PORT = "8766";

/**
 * Reads `.env` from the working directory into the environment.
 * Existing variables win.
 */
export async function load(cwd: string): Promise<void> {
  const path = join(cwd, ".env");
  if (!existsSync(path)) return;
  const content = await readFile(path, "utf8");
  for (const line of content.split("\n")) apply(line);
}

export function read(name: string): string | undefined {
  return process.env[name];
}

export function port(): number {
  return Number.parseInt(read("TYPESAFE_DEMO_PORT") || DEFAULT_PORT, 10);
}

function apply(raw: string): void {
  const line = raw.trim();
  if (!line || line.startsWith("#") || !line.includes("=")) return;
  const separator = line.indexOf("=");
  const name = line.slice(0, separator).trim();
  const value = unquote(line.slice(separator + 1).trim());
  process.env[name] ??= value;
}

function unquote(value: string): string {
  return value.replace(/^"+|"+$/g, "").replace(/^'+|'+$/g, "");
}
