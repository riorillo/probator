import { GetObjectCommand } from "@aws-sdk/client-s3";
import { NextResponse } from "next/server";
import { database, isUuid } from "@/server/db";
import { bucket, storage } from "@/server/storage";

export const runtime = "nodejs";

export async function GET(_: Request, { params }: { params: Promise<{ executionId: string }> }) {
  const { executionId } = await params;
  if (!isUuid(executionId)) return NextResponse.json({ error: "Invalid execution id." }, { status: 400 });
  try {
    const [execution, artifacts] = await Promise.all([
      database().execution.findUnique({ where: { id: executionId }, select: { mode: true, status: true } }),
      database().artifact.findMany({ where: { executionId, kind: { in: ["rrweb_chunk", "manifest"] }, status: "ready" }, orderBy: { objectKey: "asc" }, select: { kind: true, objectKey: true } }),
    ]);
    if (!execution) return NextResponse.json({ error: "Execution not found." }, { status: 404 });
    const [chunks, manifest] = await Promise.all([Promise.all(artifacts.filter(({ kind }) => kind === "rrweb_chunk").map(async ({ objectKey }) => {
      const object = await storage().send(new GetObjectCommand({ Bucket: bucket(), Key: objectKey }));
      const body = await object.Body?.transformToString();
      return body ? JSON.parse(body) as unknown[] : [];
    })), (async () => {
      const artifact = artifacts.find(({ kind }) => kind === "manifest");
      if (!artifact) return null;
      const object = await storage().send(new GetObjectCommand({ Bucket: bucket(), Key: artifact.objectKey }));
      const body = await object.Body?.transformToString();
      return body ? JSON.parse(body) as { status?: string; eventCount?: number } : null;
    })()]);
    return NextResponse.json({ status: execution.status, manifest, events: chunks.flat() }, { headers: { "cache-control": "no-store" } });
  } catch {
    return NextResponse.json({ error: "Could not load the execution replay." }, { status: 503 });
  }
}
