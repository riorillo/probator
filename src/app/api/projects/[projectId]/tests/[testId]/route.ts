import { NextResponse } from "next/server";
import { isUuid } from "@/server/db";
import { getOne, update } from "@/server/tests";

export async function GET(_: Request, { params }: { params: Promise<{ projectId: string; testId: string }> }) {
  const { projectId, testId } = await params;
  if (!isUuid(projectId) || !isUuid(testId)) return NextResponse.json({ error: "Invalid project or test id." }, { status: 400 });
  try {
    const test = await getOne(projectId, testId);
    return test ? NextResponse.json(test) : NextResponse.json({ error: "Test not found." }, { status: 404 });
  } catch { return NextResponse.json({ error: "Could not load test." }, { status: 503 }); }
}

export async function PATCH(request: Request, { params }: { params: Promise<{ projectId: string; testId: string }> }) {
  const { projectId, testId } = await params;
  if (!isUuid(projectId) || !isUuid(testId)) return NextResponse.json({ error: "Invalid project or test id." }, { status: 400 });
  try { return NextResponse.json(await update({ projectId, testId, ...(await request.json()) })); }
  catch (error) { return NextResponse.json({ error: error instanceof Error ? error.message : "Could not update test." }, { status: 400 }); }
}
