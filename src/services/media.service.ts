import { Client as MinioClient } from "minio";
import { config } from "../config";
import { logger } from "../utils/logger";

const minioClient = new MinioClient({
  endPoint: config.minio.endpoint,
  port: config.minio.port,
  useSSL: config.minio.useSSL,
  accessKey: config.minio.accessKey,
  secretKey: config.minio.secretKey,
});

const BUCKET = config.minio.bucket;

/**
 * Ensure the media bucket exists, creating it if necessary.
 */
export async function ensureBucket(): Promise<void> {
  const exists = await minioClient.bucketExists(BUCKET);
  if (!exists) {
    await minioClient.makeBucket(BUCKET, "us-east-1");
    logger.info({ bucket: BUCKET }, "Created Minio bucket");
  }
}

/**
 * Map a MIME type to a file extension.
 */
function mimeToExt(mimetype: string): string {
  const map: Record<string, string> = {
    "image/jpeg": "jpg",
    "image/png": "png",
    "image/webp": "webp",
    "audio/opus": "opus",
    "audio/m4a": "m4a",
    "audio/mp4": "m4a",
    "audio/x-m4a": "m4a",
    "audio/mpeg": "mp3",
  };
  return map[mimetype] ?? "bin";
}

/**
 * Build the base URL for the Minio endpoint (without trailing slash).
 */
function getBaseUrl(): string {
  const protocol = config.minio.useSSL ? "https" : "http";
  const defaultPort = config.minio.useSSL ? 443 : 80;
  const portSuffix = config.minio.port === defaultPort ? "" : `:${config.minio.port}`;
  return `${protocol}://${config.minio.endpoint}${portSuffix}`;
}

/**
 * Construct the public URL for a given object path.
 */
export function getPublicUrl(objectPath: string): string {
  return `${getBaseUrl()}/${BUCKET}/${objectPath}`;
}

/**
 * Upload a file buffer to a specific bucket path.
 * Returns the public URL of the uploaded object.
 */
export async function uploadFile(
  bucket: string,
  objectPath: string,
  buffer: Buffer,
  contentType: string,
): Promise<string> {
  await minioClient.putObject(bucket, objectPath, buffer, buffer.length, {
    "Content-Type": contentType,
  });
  return `${getBaseUrl()}/${bucket}/${objectPath}`;
}

/**
 * Delete a file from a specific bucket path.
 */
export async function deleteFile(bucket: string, objectPath: string): Promise<void> {
  await minioClient.removeObject(bucket, objectPath);
}

/**
 * Upload a user's avatar image.
 * Stored at: avatars/{userId}.{ext}
 * Returns the public URL.
 */
export async function uploadAvatar(
  userId: string,
  buffer: Buffer,
  mimetype: string,
): Promise<string> {
  const ext = mimeToExt(mimetype);
  const objectPath = `avatars/${userId}.${ext}`;
  await minioClient.putObject(BUCKET, objectPath, buffer, buffer.length, {
    "Content-Type": mimetype,
  });
  return getPublicUrl(objectPath);
}

/**
 * Upload a photo for a list item.
 * Stored at: photos/{itemId}/{index}.{ext}
 * Returns the public URL.
 */
export async function uploadItemPhoto(
  itemId: string,
  index: number,
  buffer: Buffer,
  mimetype: string,
): Promise<string> {
  const ext = mimeToExt(mimetype);
  const objectPath = `photos/${itemId}/${index}.${ext}`;
  await minioClient.putObject(BUCKET, objectPath, buffer, buffer.length, {
    "Content-Type": mimetype,
  });
  return getPublicUrl(objectPath);
}

/**
 * Upload a voice note for a list item.
 * Stored at: voice/{itemId}/note.{ext}
 * Returns the public URL.
 */
export async function uploadItemVoice(
  itemId: string,
  buffer: Buffer,
  mimetype: string,
): Promise<string> {
  const ext = mimeToExt(mimetype);
  const objectPath = `voice/${itemId}/note.${ext}`;
  await minioClient.putObject(BUCKET, objectPath, buffer, buffer.length, {
    "Content-Type": mimetype,
  });
  return getPublicUrl(objectPath);
}
