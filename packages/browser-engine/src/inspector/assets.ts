import { join } from "node:path";

import { RuntimeFailure, messageOf } from "../errors.ts";
import { settle, type Outcome } from "../outcome.ts";

/** One frontend file: the body to send and its content type. */
export type Page = {
  readonly body: string;
  readonly type: string;
};

/** The React client the inspector serves, next to the sources that drive it. */
export const DIRECTORY = join(import.meta.dir, "..", "..", "web");

/** The entry of the client, compiled on the first request for it. */
const ENTRY = "main.tsx";

/** The one route that is not a file. */
const SCRIPT = "/app.js";

const ROUTES: ReadonlyMap<string, { readonly file: string; readonly type: string }> = new Map([
  ["/", { file: "index.html", type: "text/html" }],
  [SCRIPT, { file: ENTRY, type: "text/javascript" }],
  ["/style.css", { file: "style.css", type: "text/css" }],
]);

/** One compilation per directory, shared by every request that follows. */
const bundles = new Map<string, Promise<Outcome<string>>>();

/** A build that stays in memory: `write` is a runtime option the typings do not declare. */
type Recipe = Bun.BuildConfig & { readonly write?: boolean };

/** Reads one frontend file, injecting the token the page has to send back. */
export async function read(path: string, token: string, directory = DIRECTORY): Promise<Page | null> {
  const route = ROUTES.get(path);
  if (route === undefined) return null;
  const body = await content(route.file, directory, token);
  return { body, type: route.type };
}

/** The text of one route: the file as it is, or the compiled client. */
async function content(file: string, directory: string, token: string): Promise<string> {
  if (file === ENTRY) return script(directory);
  const body = await Bun.file(join(directory, file)).text();
  return body.replaceAll("__TOKEN__", token);
}

/** The compiled client, or a stub that tells the console why there is none. */
async function script(directory: string): Promise<string> {
  const outcome = await bundle(directory);
  if (outcome.ok) return outcome.value;
  forget(directory);
  const message = messageOf(outcome.error);
  console.error(message);
  return `console.error(${JSON.stringify(message)});`;
}

/** The client of this directory, compiled once. */
function bundle(directory: string): Promise<Outcome<string>> {
  const built = bundles.get(directory);
  if (built !== undefined) return built;
  const fresh = compile(directory);
  bundles.set(directory, fresh);
  return fresh;
}

/** Compiles the client for the browser: no Node builtins, no debug build of React. */
async function compile(directory: string): Promise<Outcome<string>> {
  const recipe: Recipe = {
    entrypoints: [join(directory, ENTRY)],
    target: "browser",
    format: "esm",
    minify: true,
    write: false,
    define: { "process.env.NODE_ENV": '"production"' },
  };
  return settle(async () => {
    const build = await Bun.build(recipe);
    if (!build.success) throw new RuntimeFailure(reasons(build));
    const [output] = build.outputs;
    if (output === undefined) throw new RuntimeFailure("The client bundle is empty.");
    return await output.text();
  });
}

/** Drops a failed compilation, so the next request tries again. */
function forget(directory: string): void {
  bundles.delete(directory);
}

/** Every complaint the bundler made, in one line. */
function reasons(build: Bun.BuildOutput): string {
  return `The client bundle failed: ${build.logs.map((entry) => entry.message).join(" ")}`;
}
