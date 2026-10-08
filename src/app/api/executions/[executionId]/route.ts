import { NextResponse } from "next/server";
import { isUuid } from "@/server/db";
import { get } from "@/server/executions";

export async function GET(_: Request, { params }: { params: Promise<{ executionId: string }> }) {
  const { executionId } = await params;
  if (!isUuid(executionId)) return NextResponse.json({ error: "Invalid execution id." }, { status: 400 });
  try {
    const execution = await get(executionId);
    return execution ? NextResponse.json(execution) : NextResponse.json({ error: "Execution not found." }, { status: 404 });
  } catch { return NextResponse.json({ error: "Could not load execution." }, { status: 503 }); }
}
