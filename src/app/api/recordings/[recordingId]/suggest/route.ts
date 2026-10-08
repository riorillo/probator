import { NextResponse } from "next/server";
import { isUuid } from "@/server/db";
import { suggest } from "@/server/recordings";

export async function POST(_: Request, { params }: { params: Promise<{ recordingId: string }> }) {
  const { recordingId } = await params;
  if (!isUuid(recordingId)) return NextResponse.json({ error: "ID registrazione non valido." }, { status: 400 });
  try { return NextResponse.json(await suggest(recordingId)); }
  catch (error) { return NextResponse.json({ error: error instanceof Error ? error.message : "Impossibile generare il flusso." }, { status: 400 }); }
}
