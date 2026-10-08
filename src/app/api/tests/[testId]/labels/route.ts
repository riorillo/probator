import { NextResponse } from "next/server";
import { isUuid } from "@/server/db";
import { updateLabels } from "@/server/tests";

export async function PUT(request: Request, { params }: { params: Promise<{ testId: string }> }) {
  const { testId } = await params;
  if (!isUuid(testId)) return NextResponse.json({ error: "Invalid test id." }, { status: 400 });
  const body: unknown = await request.json().catch(() => null);
  if (!body || typeof body !== "object" || Array.isArray(body) || !Array.isArray((body as { labels?: unknown }).labels)) {
    return NextResponse.json({ error: "Labels must be provided as an array." }, { status: 400 });
  }
  const labels = (body as { labels: unknown[] }).labels;
  if (labels.some((item) => !item || typeof item !== "object" || Array.isArray(item) || typeof (item as { name?: unknown }).name !== "string" || typeof (item as { color?: unknown }).color !== "string")) {
    return NextResponse.json({ error: "Each label needs a name and color." }, { status: 400 });
  }
  try {
    return NextResponse.json({ labels: await updateLabels(testId, labels as Array<{ name: string; color: string }>) });
  } catch (error) {
    return NextResponse.json({ error: error instanceof Error ? error.message : "Could not update labels." }, { status: 400 });
  }
}
