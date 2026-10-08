import { NextResponse } from "next/server";
import { isUuid } from "@/server/db";
import { create, getList } from "@/server/tests";

export const runtime = "nodejs";

export async function GET(_: Request, { params }: { params: Promise<{ projectId: string }> }) {
  const { projectId } = await params;
  if (!isUuid(projectId)) return NextResponse.json({ error: "Invalid project id." }, { status: 400 });
  try { return NextResponse.json(await getList(projectId)); }
  catch { return NextResponse.json({ error: "Could not load tests." }, { status: 503 }); }
}

export async function POST(request: Request, { params }: { params: Promise<{ projectId: string }> }) {
  const { projectId } = await params;
  if (!isUuid(projectId)) return NextResponse.json({ error: "Invalid project id." }, { status: 400 });
  try { return NextResponse.json(await create({ projectId, ...(await request.json()) }), { status: 201 }); }
  catch (error) { return NextResponse.json({ error: error instanceof Error ? error.message : "Could not create test." }, { status: 400 }); }
}
