import { RuntimeFailure, StalePage } from "../errors.ts";
import { canonical } from "../canonical.ts";
import { isRecord } from "../json.ts";
import { plan } from "../marks.ts";
import { settle } from "../outcome.ts";
import type { Action, Page } from "./types.ts";
import { navigated, type Client } from "./client.ts";
import * as scripts from "./scripts.ts";

const POLL_MS = 20;
const NAVIGATION_MS = 10_000;
const NAVIGATING = "The document is navigating.";

export type ObserveOptions = {
  readonly screenshot: boolean;
  /** Number the observed elements on the page, so the frame shows the ids the model picks by. */
  readonly vision?: boolean;
  readonly afterInput: Action | null;
  /** How long a document that is being replaced may take to become readable again. */
  readonly navigationMs?: number;
};

/** One read of the page: the document it produced, or why it could not produce one yet. */
type Read = { readonly page: Page | null; readonly failure: StalePage | null };

/**
 * Reads the page. A click that navigates tears the document down, so an unreadable
 * document is retried until the new one exists, or the navigation budget runs out.
 */
export async function observe(client: Client, options: ObserveOptions): Promise<Page> {
  if (options.afterInput) await client.read(scripts.settle(options.afterInput), { awaitPromise: true });
  return attempt(client, options);
}

async function attempt(client: Client, options: ObserveOptions): Promise<Page> {
  const deadline = Date.now() + (options.navigationMs ?? NAVIGATION_MS);
  let failure: StalePage = new StalePage(NAVIGATING);
  while (Date.now() < deadline) {
    const read = await probe(client, options);
    if (read.page) return read.page;
    failure = read.failure ?? failure;
    await Bun.sleep(POLL_MS);
  }
  throw failure;
}

async function probe(client: Client, options: ObserveOptions): Promise<Read> {
  const response = await client.read(scripts.READ_STATE);
  if (!response.ok) return { page: null, failure: stale(response.error) };
  return { page: await capture(client, response.value, options), failure: null };
}

/** A document without a body is a navigation in flight, not a page. */
async function capture(client: Client, state: unknown, options: ObserveOptions): Promise<Page | null> {
  if (state === null || state === undefined) return null;
  const page = { ...(state as Page), fingerprint: fingerprint(state as Page) };
  if (!options.screenshot) return page;
  const data = options.vision ? await marked(client, page) : await shot(client);
  if (data === null) return null;
  page.screenshot = data;
  return page;
}

/**
 * Captures the frame with the numbers of the snapshot on it: the boxes are drawn from the
 * very ids the page reader produced, so what the model sees and answers about is one page.
 * A navigation between the draw and the capture retries the whole read.
 */
async function marked(client: Client, page: Page): Promise<string | null> {
  const drawn = await client.read(scripts.draw(plan(page.actions)));
  if (!drawn.ok) {
    if (drawn.error instanceof StalePage) return null;
    throw drawn.error;
  }
  try {
    return await shot(client);
  } finally {
    // Best effort: a frame without the overlay matters more than a failed cleanup.
    await settle(() => client.read(scripts.CLEAR));
  }
}

/** The screenshot of the page, or nothing when the browser was between documents. */
async function shot(client: Client): Promise<string | null> {
  const answer = await settle(() => client.call("Page.captureScreenshot", { format: "jpeg", quality: 72 }));
  if (!answer.ok && navigated(answer.error)) return null;
  if (!answer.ok) throw answer.error;
  if (!isRecord(answer.value) || typeof answer.value.data !== "string") {
    throw new RuntimeFailure("The browser did not return a screenshot.");
  }
  return answer.value.data;
}

/** A read failure that is a document change is retried; anything else is a real failure. */
function stale(error: unknown): StalePage {
  if (error instanceof StalePage) return error;
  throw error;
}

/** Only the visible page state feeds the digest, so re-reads of an unchanged page match. */
export function fingerprint(state: Page): string {
  const content = { url: state.url, text: state.text, actions: state.actions, scroll: state.scroll };
  return new Bun.CryptoHasher("sha256").update(canonical(content)).digest("hex");
}
