import { NextResponse } from "next/server";
import { isUuid } from "@/server/db";
import { create } from "@/server/recordings";

export async function POST(request: Request, { params }: { params: Promise<{ projectId: string }> }) {
  const { projectId } = await params;
  if (!isUuid(projectId)) return NextResponse.json({ error: "ID progetto non valido." }, { status: 400 });
  const body = await request.json().catch(() => ({})) as { title?: unknown };
  try { return NextResponse.json(await create(projectId, typeof body.title === "string" ? body.title : ""), { status: 201 }); }
  catch (error) { return NextResponse.json({ error: error instanceof Error ? error.message : "Impossibile avviare la registrazione." }, { status: 400 }); }
}
