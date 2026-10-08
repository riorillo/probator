import { NextResponse } from "next/server";
import { isUuid } from "@/server/db";
import { move } from "@/server/tests";

export async function POST(request: Request, { params }: { params: Promise<{ testId: string }> }) {
  const { testId } = await params;
  if (!isUuid(testId)) return NextResponse.json({ error: "Invalid test id." }, { status: 400 });
  const { columnId, position } = await request.json();
  if (!isUuid(columnId)) return NextResponse.json({ error: "Invalid column id." }, { status: 400 });
  if (position !== undefined && (!Number.isInteger(position) || position < 0 || position > 10_000)) return NextResponse.json({ error: "Invalid target position." }, { status: 400 });
  try { await move(testId, columnId, position); return NextResponse.json({ ok: true }); }
  catch (error) { return NextResponse.json({ error: error instanceof Error ? error.message : "Could not move test." }, { status: 400 }); }
}
