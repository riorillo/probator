export {};

const timeoutMs = 1_500;

function endpoints(): URL[] {
  const configuredHttp = process.env.BU_CDP_URL?.trim();
  if (configuredHttp) return [jsonVersionUrl(configuredHttp)];

  const configuredWebSocket = process.env.BU_CDP_WS?.trim();
  if (configuredWebSocket) return [jsonVersionUrl(configuredWebSocket)];

  return [9222, 9223].map((port) => new URL(`http://127.0.0.1:${port}/json/version`));
}

function jsonVersionUrl(value: string): URL {
  const parsed = new URL(value);
  if (parsed.protocol === "ws:") parsed.protocol = "http:";
  if (parsed.protocol === "wss:") parsed.protocol = "https:";
  if (!["http:", "https:"].includes(parsed.protocol)) {
    throw new Error("BU_CDP_URL/BU_CDP_WS deve usare HTTP(S) o WS(S).");
  }
  parsed.pathname = "/json/version";
  parsed.search = "";
  parsed.hash = "";
  return parsed;
}

async function probe(endpoint: URL): Promise<"ready" | "forbidden" | "absent"> {
  try {
    const response = await fetch(endpoint, { signal: AbortSignal.timeout(timeoutMs) });
    if (response.status === 403) return "forbidden";
    if (!response.ok) return "absent";
    const body: unknown = await response.json();
    if (typeof body !== "object" || body === null) return "absent";
    const webSocketDebuggerUrl = (body as Record<string, unknown>).webSocketDebuggerUrl;
    return typeof webSocketDebuggerUrl === "string" && webSocketDebuggerUrl.length > 0 ? "ready" : "absent";
  } catch {
    return "absent";
  }
}

async function main() {
  let forbidden = false;
  for (const endpoint of endpoints()) {
    const result = await probe(endpoint);
    if (result === "ready") {
      console.info(`✓ Chrome CDP disponibile su ${endpoint.host}.`);
      return;
    }
    forbidden ||= result === "forbidden";
  }

  if (forbidden) {
    console.warn("⚠ Chrome risponde, ma rifiuta l’accesso CDP. Abilita il remote debugging per il browser dedicato.");
    return;
  }

  const configured = process.env.BU_CDP_URL?.trim() || process.env.BU_CDP_WS?.trim();
  const target = configured || "http://127.0.0.1:9222 (fallback: porta 9223)";
  console.warn(`⚠ Chrome CDP non raggiungibile su ${target}. Avvia il Chrome dedicato con --remote-debugging-port=<porta> --user-data-dir=<directory dedicata>.`);
}

try {
  await main();
} catch (error) {
  const message = error instanceof Error ? error.message : "configurazione non valida";
  console.warn(`⚠ Verifica Chrome CDP non riuscita: ${message}`);
}
