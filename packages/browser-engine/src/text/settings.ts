import { read } from "../settings/env.ts";

export const DEFAULT_ADDRESS = "https://api.deepseek.com/v1";
export const DEFAULT_MODEL = "deepseek-chat";

export type Settings = {
  readonly baseUrl?: string | null;
  readonly model?: string | null;
  readonly apiKey?: string | null;
};

/** The text model endpoint: an explicit override, then the environment, then the default. */
export function address(settings: Settings): string {
  return settings.baseUrl || read("TEXT_MODEL_BASE_URL") || DEFAULT_ADDRESS;
}

/** The text model: an explicit override, then the environment, then the default. */
export function identity(settings: Settings): string {
  return settings.model || read("TEXT_MODEL") || DEFAULT_MODEL;
}

/** The text model credential, when one is configured. */
export function credential(settings: Settings): string | undefined {
  return settings.apiKey || read("TEXT_MODEL_API_KEY") || undefined;
}

/** Provider-specific reasoning switch; TEXT_MODEL_REASONING=none disables it for any provider. */
export function reasoning(base: string): Record<string, unknown> {
  if (read("TEXT_MODEL_REASONING") === "none") return { reasoning: { enabled: false } };
  if (base.includes("api.deepseek.com/")) return { thinking: { type: "disabled" } };
  return { reasoning: { effort: "low" } };
}
