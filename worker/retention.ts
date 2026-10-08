import { DeleteObjectCommand, HeadObjectCommand, ListObjectsV2Command } from "@aws-sdk/client-s3";
import { database } from "../src/server/db.ts";
import { bucket, ensureBucket, storage } from "../src/server/storage.ts";

const DAY = 24 * 60 * 60 * 1000;

/** Delete expired run rows and their objects; reconcile uploads interrupted between S3 and Prisma. */
export async function retentionSweep(now = new Date()) {
  const days = Math.min(Math.max(Number(process.env.PROBATOR_RETENTION_DAYS || 30), 1), 3650);
  const cutoff = new Date(now.getTime() - days * DAY);
  const db = database();
  const expired = await db.execution.findMany({
    where: { status: { in: ["passed", "failed", "blocked"] }, finishedAt: { lt: cutoff } },
    select: { id: true, artifacts: { select: { id: true, objectKey: true } } },
  });
  for (const execution of expired) {
    let complete = true;
    for (const artifact of execution.artifacts) {
      try {
        await storage().send(new DeleteObjectCommand({ Bucket: bucket(), Key: artifact.objectKey }));
        await db.artifact.delete({ where: { id: artifact.id } });
      } catch {
        complete = false;
      }
    }
    if (complete) await db.execution.delete({ where: { id: execution.id } });
  }

  const expiredRecordings = await db.flowRecording.findMany({ where: { status: { in: ["stopped", "saved", "failed"] }, updatedAt: { lt: cutoff } }, select: { id: true, frameObjectKey: true } });
  for (const recording of expiredRecordings) {
    try {
      if (recording.frameObjectKey) await storage().send(new DeleteObjectCommand({ Bucket: bucket(), Key: recording.frameObjectKey }));
      await db.flowRecording.delete({ where: { id: recording.id } });
    } catch { /* Keep the row and retry its frame cleanup at the next sweep. */ }
  }

  const rows = await db.artifact.findMany({ select: { id: true, objectKey: true, status: true, createdAt: true } });
  const byKey = new Map(rows.map((row) => [row.objectKey, row]));
  const seen = new Set<string>();
  await ensureBucket();
  let continuationToken: string | undefined;
  do {
    const page = await storage().send(new ListObjectsV2Command({ Bucket: bucket(), Prefix: "replay/", ContinuationToken: continuationToken }));
    for (const object of page.Contents ?? []) {
      if (!object.Key) continue;
      seen.add(object.Key);
      const row = byKey.get(object.Key);
      if (!row) {
        if (object.LastModified && object.LastModified.getTime() < now.getTime() - DAY) {
          await storage().send(new DeleteObjectCommand({ Bucket: bucket(), Key: object.Key }));
        }
        continue;
      }
      if (row.status !== "ready") {
        try {
          const head = await storage().send(new HeadObjectCommand({ Bucket: bucket(), Key: object.Key }));
          await db.artifact.update({ where: { id: row.id }, data: { status: "ready", sizeBytes: head.ContentLength === undefined ? undefined : BigInt(head.ContentLength) } });
        } catch {
          // Keep failed/pending metadata for diagnosis; a future sweep checks again.
        }
      }
    }
    continuationToken = page.IsTruncated ? page.NextContinuationToken : undefined;
  } while (continuationToken);
  const stalePending = rows.filter((row) => row.status === "pending" && row.createdAt.getTime() < now.getTime() - DAY && !seen.has(row.objectKey));
  await Promise.all(stalePending.map((row) => db.artifact.update({ where: { id: row.id }, data: { status: "error" } })));

  const recordingKeys = new Set((await db.flowRecording.findMany({ select: { frameObjectKey: true } })).map((row) => row.frameObjectKey).filter((key): key is string => Boolean(key)));
  let recordingToken: string | undefined;
  do {
    const page = await storage().send(new ListObjectsV2Command({ Bucket: bucket(), Prefix: "recordings/", ContinuationToken: recordingToken }));
    for (const object of page.Contents ?? []) {
      if (!object.Key || recordingKeys.has(object.Key)) continue;
      if (object.LastModified && object.LastModified.getTime() < now.getTime() - DAY) await storage().send(new DeleteObjectCommand({ Bucket: bucket(), Key: object.Key }));
    }
    recordingToken = page.IsTruncated ? page.NextContinuationToken : undefined;
  } while (recordingToken);
}
