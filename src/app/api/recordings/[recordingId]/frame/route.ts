import { NextResponse } from "next/server";
import { database, isUuid } from "@/server/db";
import { signedReadUrl } from "@/server/storage";

export const runtime = "nodejs";

export async function GET(_: Request, { params }: { params: Promise<{ recordingId: string }> }) {
  const { recordingId } = await params;
  if (!isUuid(recordingId)) return NextResponse.json({ error: "ID registrazione non valido." }, { status: 400 });
  try {
    const recording = await database().flowRecording.findUnique({ where: { id: recordingId }, select: { frameObjectKey: true } });
    if (!recording?.frameObjectKey) return NextResponse.json({ error: "Frame non disponibile." }, { status: 404 });
    return NextResponse.redirect(await signedReadUrl(recording.frameObjectKey), { status: 302, headers: { "cache-control": "no-store" } });
  } catch { return NextResponse.json({ error: "Impossibile caricare il frame." }, { status: 503 }); }
}
