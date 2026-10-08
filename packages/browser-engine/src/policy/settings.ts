import { read } from "../settings/env.ts";

export const DEFAULT_ADDRESS = "https://api.typesafe.ai/v1/systemone";
export const DEFAULT_MODEL = "jev-latest";

export type Settings = {
  readonly apiUrl?: string | null;
  readonly apiKey?: string | null;
  readonly model?: string | null;
};

/** The TypeSafe endpoint: an explicit override, then the environment, then the public service. */
export function address(settings: Settings): string {
  return settings.apiUrl || read("TYPESAFE_API_URL") || DEFAULT_ADDRESS;
}

/** The decision model: an explicit override, then the environment, then the default. */
export function identity(settings: Settings): string {
  return settings.model || read("TYPESAFE_MODEL") || DEFAULT_MODEL;
}

/** The TypeSafe credential, when one is configured. */
export function credential(settings: Settings): string | undefined {
  return settings.apiKey || read("TYPESAFE_API_KEY") || undefined;
}
