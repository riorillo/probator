import type { BrowserPort } from "../browser/types.ts";
import type { Options as HealOptions } from "../heal/decision.ts";
import * as healSettings from "../heal/settings.ts";
import type { Http } from "../http/client.ts";
import type { Options as DecisionOptions } from "../policy/decision.ts";
import * as settings from "../policy/settings.ts";
import type { Options as TextOptions } from "../text/field.ts";
import * as textSettings from "../text/settings.ts";

/** Everything a run is configured with. Nothing is read from the environment here. */
export type Config = {
  readonly port?: BrowserPort;
  readonly http?: Http;
  readonly recordDir?: string | null;
  /** Prebuilt, privacy-configured browser recorder bootstrap. */
  readonly recordingScript?: string | null;
  readonly screenshots?: boolean;
  /** Sends the snapshot to the decision model as a frame with the numbered boxes of the elements. */
  readonly vision?: boolean;
  readonly decisionAddress?: string | null;
  readonly decisionCredential?: string | null;
  readonly decisionIdentity?: string | null;
  readonly textAddress?: string | null;
  readonly textCredential?: string | null;
  readonly textIdentity?: string | null;
  /** The model that is asked for a way out when a run repeats itself; without it a run only blocks. */
  readonly healAddress?: string | null;
  readonly healCredential?: string | null;
  readonly healIdentity?: string | null;
};

/** The settings of a run as they are in effect, with the environment and the defaults applied. */
export type Description = {
  readonly decisionAddress: string;
  readonly decisionIdentity: string;
  readonly textAddress: string;
  readonly textIdentity: string;
};

/** The decision model settings of a run. */
export function decision(config: Config): DecisionOptions {
  return {
    apiUrl: config.decisionAddress,
    apiKey: config.decisionCredential,
    model: config.decisionIdentity,
    http: config.http,
    vision: vision(config),
  };
}

/** Whether the decision model reads the snapshot as a frame with numbered boxes. */
export function vision(config: Config): boolean {
  return Boolean(config.vision);
}

/** The text model settings of a run. */
export function text(config: Config): TextOptions {
  return {
    baseUrl: config.textAddress,
    apiKey: config.textCredential,
    model: config.textIdentity,
    http: config.http,
  };
}

/** The heal model settings of a run; a run without a credential for it never reaches the model. */
export function heal(config: Config): HealOptions {
  return {
    baseUrl: config.healAddress,
    apiKey: config.healCredential,
    model: config.healIdentity,
    http: config.http,
  };
}

/** A run heals only when a credential was given for it: there is no fallback to another model. */
export function healing(config: Config): boolean {
  return Boolean(healSettings.credential(settingsOfHeal(config)));
}

/** Reads the settings of both models, with the environment and the defaults applied. */
export function describe(config: Config): Description {
  const decisionSettings = settingsOf(config);
  const textModelSettings = textSettingsOf(config);
  return {
    decisionAddress: settings.address(decisionSettings),
    decisionIdentity: settings.identity(decisionSettings),
    textAddress: textSettings.address(textModelSettings),
    textIdentity: textSettings.identity(textModelSettings),
  };
}

/** The directory that collects one screenshot per step, when the run records. */
export function frames(config: Config): string | null {
  return config.recordDir ?? null;
}

/** Browser-side recorder setup passed to the owned CDP tab. */
export function recorder(config: Config): string | null {
  return config.recordingScript ?? null;
}

/** Screenshots are only read when the run, its recording, or the image mode needs them. */
export function screenshots(config: Config): boolean {
  return Boolean(config.screenshots) || Boolean(config.recordDir) || vision(config);
}

function settingsOf(config: Config): settings.Settings {
  return {
    apiUrl: config.decisionAddress,
    apiKey: config.decisionCredential,
    model: config.decisionIdentity,
  };
}

function textSettingsOf(config: Config): textSettings.Settings {
  return {
    baseUrl: config.textAddress,
    apiKey: config.textCredential,
    model: config.textIdentity,
  };
}

function settingsOfHeal(config: Config): healSettings.Settings {
  return {
    baseUrl: config.healAddress,
    apiKey: config.healCredential,
    model: config.healIdentity,
  };
}
