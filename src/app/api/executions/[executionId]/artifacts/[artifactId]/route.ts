import { NextResponse } from "next/server";
import { database, isUuid } from "@/server/db";
import { signedReadUrl } from "@/server/storage";

export const runtime = "nodejs";

export async function GET(_: Request, { params }: { params: Promise<{ executionId: string; artifactId: string }> }) {
  const { executionId, artifactId } = await params;
  if (!isUuid(executionId) || !isUuid(artifactId)) return NextResponse.json({ error: "Invalid artifact reference." }, { status: 400 });
  try {
    const artifact = await database().artifact.findFirst({ where: { id: artifactId, executionId, status: "ready" }, select: { objectKey: true } });
    if (!artifact) return NextResponse.json({ error: "Artifact not found." }, { status: 404 });
    return NextResponse.redirect(await signedReadUrl(artifact.objectKey), { status: 302, headers: { "cache-control": "no-store" } });
  } catch {
    return NextResponse.json({ error: "Could not create a temporary artifact link." }, { status: 503 });
  }
}
