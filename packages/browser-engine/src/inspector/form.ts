import { join } from "node:path";
import { InputError } from "../errors.ts";
import type { Config, Description } from "../harness/config.ts";
import { isRecord } from "../json.ts";

/** The page every inspector run starts from. */
export const START = "https://www.google.com/";

/** Where recorded frames go, relative to the directory the inspector was started in. */
export const RECORDING = join("artifacts", "frames");

const GOAL_LIMIT = 2000;
const BODY = "The request body must be a JSON object.";
const GOAL = "Write a goal of 1 to 2,000 characters.";
const MISSING = "Both model names and both API addresses are required.";

/** A validated reset form: everything a session needs to open. */
export type Reset = {
  readonly url: string;
  readonly goal: string;
  readonly config: Config;
};

type Field = {
  readonly key: string;
  readonly label: string;
  readonly maximum: number;
  readonly required: boolean;
  readonly fallback: (settings: Description) => string;
};

const REQUIRED = true;
const OPTIONAL = false;
const BLANK = (): string => "";

const FIELDS: readonly Field[] = [
  {
    key: "typesafe_api_url",
    label: "TypeSafe address",
    maximum: 2000,
    required: REQUIRED,
    fallback: (settings) => settings.decisionAddress,
  },
  {
    key: "typesafe_model",
    label: "TypeSafe model",
    maximum: 200,
    required: REQUIRED,
    fallback: (settings) => settings.decisionIdentity,
  },
  {
    key: "text_model_base_url",
    label: "Text model address",
    maximum: 2000,
    required: REQUIRED,
    fallback: (settings) => settings.textAddress,
  },
  {
    key: "text_model",
    label: "Text model",
    maximum: 200,
    required: REQUIRED,
    fallback: (settings) => settings.textIdentity,
  },
  {
    key: "typesafe_api_key",
    label: "TypeSafe API key",
    maximum: 4096,
    required: OPTIONAL,
    fallback: BLANK,
  },
  {
    key: "text_model_api_key",
    label: "Text model API key",
    maximum: 4096,
    required: OPTIONAL,
    fallback: BLANK,
  },
];

/**
 * Validates a reset body. Anything the client left out keeps the value already in effect,
 * and the two credentials are never carried over from a previous run.
 */
export function read(body: unknown, settings: Description): Reset {
  if (!isRecord(body)) throw new InputError(BODY);
  const goal = goalOf(body);
  const values: Record<string, string> = {};
  for (const field of FIELDS) values[field.key] = valueOf(body, field, settings);
  for (const field of FIELDS) require(field, values);
  return { url: START, goal, config: configuration(body, values) };
}

function goalOf(body: Record<string, unknown>): string {
  const raw = body.goal;
  const goal = typeof raw === "string" ? raw.trim() : "";
  if (!goal || goal.length > GOAL_LIMIT) throw new InputError(GOAL);
  return goal;
}

function valueOf(body: Record<string, unknown>, field: Field, settings: Description): string {
  if (!Object.hasOwn(body, field.key)) return field.fallback(settings);
  const raw = body[field.key];
  if (typeof raw !== "string" || raw.length > field.maximum) throw new InputError(tooLong(field));
  return raw;
}

function require(field: Field, values: Record<string, string>): void {
  if (!field.required) return;
  if (values[field.key].trim()) return;
  throw new InputError(MISSING);
}

function configuration(body: Record<string, unknown>, values: Record<string, string>): Config {
  return {
    decisionAddress: values.typesafe_api_url.trim(),
    decisionCredential: credential(values.typesafe_api_key),
    decisionIdentity: values.typesafe_model.trim(),
    textAddress: values.text_model_base_url.trim(),
    textCredential: credential(values.text_model_api_key),
    textIdentity: values.text_model.trim(),
    screenshots: true,
    recordDir: body.record ? join(process.cwd(), RECORDING) : null,
    vision: Boolean(body.vision),
  };
}

function credential(value: string): string | null {
  return value.trim() || null;
}

function tooLong(field: Field): string {
  return `${field.label}: at most ${field.maximum} characters.`;
}
