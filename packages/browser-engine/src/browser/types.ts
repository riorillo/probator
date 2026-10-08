import type { StalePage } from "../errors.ts";

export type Rect = { readonly x: number; readonly y: number; readonly w: number; readonly h: number };

export type Action = {
  id: string;
  kind: string;
  node?: number;
  label?: string;
  role?: string;
  value?: string;
  current_value?: string;
  delta?: number;
  rect?: Rect;
  [field: string]: unknown;
};

export type Scroll = { readonly y: number; readonly height: number };

export type Page = {
  url: string;
  title: string;
  w: number;
  h: number;
  text: string;
  scroll: Scroll;
  actions: Action[];
  marker: unknown;
  page_key: unknown[];
  guards: Record<string, unknown>;
  omitted_actions: number;
  fingerprint: string;
  screenshot?: string;
};

/** The result of asking the page whether an observation still describes it. */
export type Freshness =
  | { readonly kind: "fresh" }
  | { readonly kind: "changed" }
  | { readonly kind: "unreadable"; readonly failure: StalePage };

export type BrowserPort = {
  observe(screenshot: boolean): Promise<Page>;
  fresh(page: Page, action?: Action): Promise<Freshness>;
  act(action: Action, page: Page, text?: string | null): Promise<unknown>;
  drainRecordingEvents?(): Promise<unknown[]>;
  captureScreenshot?(): Promise<string | null>;
  close(): Promise<void>;
};
