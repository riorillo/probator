import { NextResponse } from "next/server";
import { isUuid } from "@/server/db";
import { command } from "@/server/recordings";

const KEYS = new Set(["Enter", "Tab", "Escape", "Backspace", "Delete", "ArrowUp", "ArrowDown", "ArrowLeft", "ArrowRight", " "]);

export async function POST(request: Request, { params }: { params: Promise<{ recordingId: string }> }) {
  const { recordingId } = await params;
  if (!isUuid(recordingId)) return NextResponse.json({ error: "ID registrazione non valido." }, { status: 400 });
  const body = await request.json().catch(() => null) as Record<string, unknown> | null;
  if (!body || typeof body.kind !== "string") return NextResponse.json({ error: "Comando browser non valido." }, { status: 400 });
  const kind = body.kind;
  if (kind === "click" && validPoint(body.x, body.y)) return enqueue(recordingId, kind, { x: body.x, y: body.y });
  if (kind === "type" && typeof body.text === "string" && body.text.length > 0 && body.text.length <= 2000) return enqueue(recordingId, kind, { text: body.text });
  if (kind === "key" && typeof body.key === "string" && KEYS.has(body.key)) return enqueue(recordingId, kind, { key: body.key });
  if (kind === "scroll" && validPoint(body.x, body.y) && typeof body.deltaY === "number" && Math.abs(body.deltaY) <= 2000 && typeof body.deltaX === "number" && Math.abs(body.deltaX) <= 2000) return enqueue(recordingId, kind, { x: body.x, y: body.y, deltaX: body.deltaX, deltaY: body.deltaY });
  return NextResponse.json({ error: "Comando browser non supportato." }, { status: 400 });
}

async function enqueue(recordingId: string, kind: string, payload: Record<string, unknown>) {
  try { return NextResponse.json(await command(recordingId, kind, payload), { status: 202 }); }
  catch (error) { return NextResponse.json({ error: error instanceof Error ? error.message : "Comando non accettato." }, { status: 409 }); }
}

function validPoint(x: unknown, y: unknown): x is number { return typeof x === "number" && typeof y === "number" && Number.isFinite(x) && Number.isFinite(y) && x >= 0 && y >= 0 && x <= 1120 && y <= 780; }
