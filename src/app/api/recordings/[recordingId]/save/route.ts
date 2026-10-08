import { NextResponse } from "next/server";
import { isUuid } from "@/server/db";
import { save } from "@/server/recordings";

export async function POST(request: Request, { params }: { params: Promise<{ recordingId: string }> }) {
  const { recordingId } = await params;
  if (!isUuid(recordingId)) return NextResponse.json({ error: "ID registrazione non valido." }, { status: 400 });
  const body = await request.json().catch(() => null);
  if (!body || typeof body !== "object" || Array.isArray(body)) return NextResponse.json({ error: "Definizione del flusso non valida." }, { status: 400 });
  try { return NextResponse.json(await save(recordingId, body as Parameters<typeof save>[1]), { status: 201 }); }
  catch (error) { return NextResponse.json({ error: error instanceof Error ? error.message : "Impossibile salvare il flusso." }, { status: 400 }); }
}
