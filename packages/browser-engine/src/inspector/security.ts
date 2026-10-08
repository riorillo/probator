/**
 * The inspector is a loopback tool: one local host, one session token, no foreign origin.
 */

/** The values a request has to agree with before the inspector answers it. */
export type Guard = {
  readonly host: string;
  readonly origin: string;
  readonly token: string;
};

/** The local host and origin of an inspector bound to one port. */
export function loopback(port: number): Omit<Guard, "token"> {
  return { host: `127.0.0.1:${port}`, origin: `http://127.0.0.1:${port}` };
}

/** A fresh unguessable token. */
export function token(): string {
  return Buffer.from(crypto.getRandomValues(new Uint8Array(32))).toString("base64url");
}

/** Reading state is local-only: a remote caller never sees the run, even with a leaked token. */
export function local(request: Request, guard: Guard): boolean {
  return request.headers.get("host") === guard.host;
}

/** Writing state also needs the session token, and no foreign origin may have sent it. */
export function trusted(request: Request, guard: Guard): boolean {
  if (!local(request, guard)) return false;
  if (request.headers.get("x-demo-token") !== guard.token) return false;
  const origin = request.headers.get("origin");
  return origin === null || origin === guard.origin;
}
