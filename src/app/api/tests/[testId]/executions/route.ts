import { NextResponse } from "next/server";
import { isUuid } from "@/server/db";
import { create } from "@/server/executions";

export async function POST(request: Request, { params }: { params: Promise<{ testId: string }> }) {
  const { testId } = await params;
  if (!isUuid(testId)) return NextResponse.json({ error: "Invalid test id." }, { status: 400 });
  const body: unknown = await request.json().catch(() => ({}));
  if (!body || typeof body !== "object" || Array.isArray(body)) return NextResponse.json({ error: "Request body must be an object." }, { status: 400 });
  const mode = (body as { mode?: unknown }).mode;
  if (mode !== "live" && mode !== "recording") return NextResponse.json({ error: "Execution mode must be live or recording." }, { status: 400 });
  try {
    const rawParameters = (body as { parameters?: unknown }).parameters;
    if (rawParameters !== undefined && (!rawParameters || typeof rawParameters !== "object" || Array.isArray(rawParameters) || Object.values(rawParameters).some((value) => typeof value !== "string"))) return NextResponse.json({ error: "I parametri devono essere valori testuali." }, { status: 400 });
    const key = request.headers.get("idempotency-key") ?? (body as { idempotencyKey?: unknown }).idempotencyKey;
    if (key !== undefined && (typeof key !== "string" || key.length > 255)) return NextResponse.json({ error: "Idempotency key must be a string of at most 255 characters." }, { status: 400 });
    const execution = await create({ testId, mode, idempotencyKey: key, parameters: rawParameters as Record<string, string> | undefined });
    return NextResponse.json(execution, { status: 202 });
  } catch (error) {
    return NextResponse.json({ error: error instanceof Error ? error.message : "Could not queue execution." }, { status: 400 });
  }
}
