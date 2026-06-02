import { CreateBucketCommand, HeadBucketCommand, PutObjectCommand, GetObjectCommand, S3Client } from "@aws-sdk/client-s3";
import { config } from "../config.js";
import { logger } from "../logger.js";

// Initialize S3 client for MinIO compatibility
const s3Client = new S3Client({
  endpoint: config.S3_ENDPOINT,
  region: config.S3_REGION,
  credentials: {
    accessKeyId: config.S3_ACCESS_KEY || "minioadmin",
    secretAccessKey: config.S3_SECRET_KEY || "minioadmin"
  },
  forcePathStyle: true // Mandatory for MinIO local deployments
});

export const bucketName = config.S3_BUCKET;

/**
 * Initializes object storage by ensuring the target bucket exists.
 */
export async function initializeStorage(): Promise<void> {
  if (!config.S3_ENDPOINT) {
    logger.warn("S3_ENDPOINT not set. Object storage operations will fail.");
    return;
  }

  try {
    // Check if the bucket exists
    await s3Client.send(new HeadBucketCommand({ Bucket: bucketName }));
    logger.info({ bucket: bucketName }, "Object storage bucket verified");
  } catch (error: any) {
    if (error.name === "NotFound" || error.$metadata?.httpStatusCode === 404) {
      logger.info({ bucket: bucketName }, "Creating object storage bucket");
      try {
        await s3Client.send(new CreateBucketCommand({ Bucket: bucketName }));
        logger.info({ bucket: bucketName }, "Object storage bucket created successfully");
      } catch (createError) {
        logger.error({ error: createError }, "Failed to create S3 bucket");
      }
    } else {
      logger.error({ error }, "Error connecting to object storage service");
    }
  }
}

/**
 * Uploads a file to the S3/MinIO bucket.
 */
export async function uploadFile(key: string, body: Buffer, mimeType: string): Promise<string> {
  await s3Client.send(
    new PutObjectCommand({
      Bucket: bucketName,
      Key: key,
      Body: body,
      ContentType: mimeType
    })
  );

  const fileUrl = `${config.S3_ENDPOINT || ""}/${bucketName}/${key}`;
  logger.info({ key, fileUrl }, "File uploaded successfully to storage");
  return fileUrl;
}

/**
 * Retrieves a file from the S3/MinIO bucket as a Buffer.
 */
export async function getFile(key: string): Promise<Buffer> {
  const response = await s3Client.send(
    new GetObjectCommand({
      Bucket: bucketName,
      Key: key
    })
  );

  if (!response.Body) {
    throw new Error("Empty storage response body");
  }

  const chunks: Uint8Array[] = [];
  for await (const chunk of response.Body as any) {
    chunks.push(chunk);
  }
  return Buffer.concat(chunks);
}
