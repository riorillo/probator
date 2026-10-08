import { NextResponse } from "next/server";
import { isUuid } from "@/server/db";
import { cancel, finish, get } from "@/server/recordings";

export const runtime = "nodejs";

export async function GET(request: Request, { params }: { params: Promise<{ recordingId: string }> }) {
  const { recordingId } = await params;
  if (!isUuid(recordingId)) return NextResponse.json({ error: "ID registrazione non valido." }, { status: 400 });
  try {
    const after = Number(new URL(request.url).searchParams.get("after") ?? 0);
    const afterCommand = Number(new URL(request.url).searchParams.get("afterCommand") ?? 0);
    const recording = await get(recordingId, Number.isInteger(after) && after >= 0 ? after : 0, Number.isInteger(afterCommand) && afterCommand >= 0 ? afterCommand : 0);
    return recording ? NextResponse.json(recording, { headers: { "cache-control": "no-store" } }) : NextResponse.json({ error: "Registrazione non trovata." }, { status: 404 });
  } catch { return NextResponse.json({ error: "Impossibile caricare la registrazione." }, { status: 503 }); }
}

export async function POST(_: Request, { params }: { params: Promise<{ recordingId: string }> }) {
  const { recordingId } = await params;
  if (!isUuid(recordingId)) return NextResponse.json({ error: "ID registrazione non valido." }, { status: 400 });
  try {
    const result = await finish(recordingId);
    return result ? NextResponse.json(result, { status: 202 }) : NextResponse.json({ error: "Registrazione non trovata." }, { status: 404 });
  } catch { return NextResponse.json({ error: "Impossibile terminare la registrazione." }, { status: 503 }); }
}

export async function DELETE(_: Request, { params }: { params: Promise<{ recordingId: string }> }) {
  const { recordingId } = await params;
  if (!isUuid(recordingId)) return NextResponse.json({ error: "ID registrazione non valido." }, { status: 400 });
  try {
    const result = await cancel(recordingId);
    return result ? NextResponse.json(result) : NextResponse.json({ error: "Registrazione non trovata." }, { status: 404 });
  } catch { return NextResponse.json({ error: "Impossibile annullare la registrazione." }, { status: 503 }); }
}
