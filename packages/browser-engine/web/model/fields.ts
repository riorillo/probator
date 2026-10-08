/** The form in the side panel: which fields exist, what they show, what they send. */

import { record, text } from "./read.ts";

/** Every value the form holds. */
export type Key =
  | "goal"
  | "typesafe_api_url"
  | "typesafe_model"
  | "typesafe_api_key"
  | "text_model_base_url"
  | "text_model"
  | "text_model_api_key";

/** The goal plus the two model settings, as edited text. */
export type Values = Readonly<Record<Key, string>>;

/** One labelled input. */
export type Spec = {
  readonly key: Key;
  readonly label: string;
  readonly type: "text" | "url" | "password";
  readonly placeholder: string;
  readonly required: boolean;
};

/** One titled block of settings. */
export type Group = { readonly title: string; readonly specs: readonly Spec[] };

/** The task, the only field the run cannot start without. */
export const GOAL: Spec = {
  key: "goal",
  label: "WHAT WOULD YOU LIKE TO DO?",
  type: "text",
  placeholder: "...",
  required: true,
};

/** The two model endpoints the inspector can drive. */
export const GROUPS: readonly Group[] = [
  {
    title: "TYPESAFE",
    specs: [
      { key: "typesafe_api_url", label: "ADDRESS", type: "url", placeholder: "", required: true },
      { key: "typesafe_model", label: "MODEL", type: "text", placeholder: "", required: true },
      {
        key: "typesafe_api_key",
        label: "API KEY",
        type: "password",
        placeholder: "LEAVE EMPTY = TYPESAFE_API_KEY",
        required: false,
      },
    ],
  },
  {
    title: "TEXT MODEL · TYPE_TEXT ONLY",
    specs: [
      { key: "text_model_base_url", label: "ADDRESS", type: "url", placeholder: "", required: true },
      { key: "text_model", label: "MODEL", type: "text", placeholder: "", required: true },
      {
        key: "text_model_api_key",
        label: "API KEY",
        type: "password",
        placeholder: "LEAVE EMPTY = TEXT_MODEL_API_KEY",
        required: false,
      },
    ],
  },
];

/** The form before anything was typed or reported. */
export const BLANK: Values = {
  goal: "",
  typesafe_api_url: "",
  typesafe_model: "",
  typesafe_api_key: "",
  text_model_base_url: "",
  text_model: "",
  text_model_api_key: "",
};

/** The settings the server reports back, so a reload shows what is in effect. */
const REPORTED: readonly Key[] = ["typesafe_api_url", "typesafe_model", "text_model_base_url", "text_model"];

/** What one field shows: what the user typed, else what the server reports. */
export function shown(values: Values | null, state: unknown, key: Key): string {
  const typed = values?.[key];
  if (typed !== undefined) return typed;
  if (!REPORTED.includes(key)) return BLANK[key];
  return text(record(state)[key]);
}

/** Every value of the form, with the reported settings filled in. */
export function filled(values: Values | null, state: unknown): Values {
  return {
    goal: shown(values, state, "goal"),
    typesafe_api_url: shown(values, state, "typesafe_api_url"),
    typesafe_model: shown(values, state, "typesafe_model"),
    typesafe_api_key: shown(values, state, "typesafe_api_key"),
    text_model_base_url: shown(values, state, "text_model_base_url"),
    text_model: shown(values, state, "text_model"),
    text_model_api_key: shown(values, state, "text_model_api_key"),
  };
}

/** One edited field, with the rest of the form left as it is. */
export function edited(values: Values | null, state: unknown, key: Key, next: string): Values {
  return { ...filled(values, state), [key]: next };
}

/** The body of a reset: the goal and the two model settings. */
export function body(values: Values): Record<string, string> {
  return {
    goal: values.goal,
    typesafe_api_url: values.typesafe_api_url,
    typesafe_model: values.typesafe_model,
    typesafe_api_key: values.typesafe_api_key,
    text_model_base_url: values.text_model_base_url,
    text_model: values.text_model,
    text_model_api_key: values.text_model_api_key,
  };
}
