import { CreateBucketCommand, GetObjectCommand, HeadBucketCommand, S3Client } from "@aws-sdk/client-s3";
import { getSignedUrl } from "@aws-sdk/s3-request-presigner";

let client: S3Client | undefined;

export function bucket(): string {
  const value = process.env.MINIO_BUCKET;
  if (!value) throw new Error("MINIO_BUCKET is required.");
  return value;
}

export function storage(): S3Client {
  if (client) return client;
  const endpoint = process.env.MINIO_ENDPOINT;
  const accessKeyId = process.env.MINIO_ACCESS_KEY;
  const secretAccessKey = process.env.MINIO_SECRET_KEY;
  if (!endpoint || !accessKeyId || !secretAccessKey) throw new Error("MinIO endpoint and credentials are required.");
  client = new S3Client({
    endpoint,
    region: process.env.MINIO_REGION || "us-east-1",
    forcePathStyle: process.env.MINIO_FORCE_PATH_STYLE !== "false",
    credentials: { accessKeyId, secretAccessKey },
  });
  return client;
}

export async function signedReadUrl(objectKey: string): Promise<string> {
  return getSignedUrl(storage(), new GetObjectCommand({ Bucket: bucket(), Key: objectKey }), { expiresIn: 60 });
}

export async function ensureBucket(): Promise<void> {
  const client = storage();
  try {
    await client.send(new HeadBucketCommand({ Bucket: bucket() }));
  } catch (error) {
    const response = error as { name?: string; $metadata?: { httpStatusCode?: number } };
    if (response.name !== "NotFound" && response.name !== "NoSuchBucket" && response.$metadata?.httpStatusCode !== 404) throw error;
    try { await client.send(new CreateBucketCommand({ Bucket: bucket() })); }
    catch (createError) {
      const exists = createError as { name?: string };
      if (exists.name !== "BucketAlreadyOwnedByYou" && exists.name !== "BucketAlreadyExists") throw createError;
    }
  }
}
