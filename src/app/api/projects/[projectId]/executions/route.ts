import { NextResponse } from "next/server";
import { isUuid } from "@/server/db";
import { getList } from "@/server/executions";

export async function GET(request: Request, { params }: { params: Promise<{ projectId: string }> }) {
  const { projectId } = await params;
  if (!isUuid(projectId)) return NextResponse.json({ error: "Invalid project id." }, { status: 400 });
  const url = new URL(request.url);
  const cursor = url.searchParams.get("cursor") ?? undefined;
  const testId = url.searchParams.get("test") ?? undefined;
  if ((cursor && !isUuid(cursor)) || (testId && !isUuid(testId))) return NextResponse.json({ error: "Invalid history filter." }, { status: 400 });
  try { return NextResponse.json(await getList(projectId, { cursor, testId })); }
  catch { return NextResponse.json({ error: "Could not load execution history." }, { status: 503 }); }
}
