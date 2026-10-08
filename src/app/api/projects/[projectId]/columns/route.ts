import { NextResponse } from "next/server";
import { database, isUuid } from "@/server/db";

export async function GET(_: Request, { params }: { params: Promise<{ projectId: string }> }) {
  const { projectId } = await params;
  if (!isUuid(projectId)) return NextResponse.json({ error: "Invalid project id." }, { status: 400 });
  try {
    const board = await database().board.findUnique({ where: { projectId }, include: { columns: { orderBy: { position: "asc" }, select: { id: true, name: true, position: true } } } });
    return NextResponse.json(board?.columns ?? []);
  }
  catch { return NextResponse.json({ error: "Could not load board columns." }, { status: 503 }); }
}
