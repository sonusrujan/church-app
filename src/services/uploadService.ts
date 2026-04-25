import { S3Client, PutObjectCommand, DeleteObjectCommand } from "@aws-sdk/client-s3";
import { AWS_REGION, AWS_ACCESS_KEY_ID, AWS_SECRET_ACCESS_KEY } from "../config";
import crypto from "crypto";
import path from "path";

const BUCKET = "shalom-uploads-357644040292";
const MAX_FILE_SIZE = 5 * 1024 * 1024; // 5 MB
const ALLOWED_MIME_TYPES = ["image/jpeg", "image/png", "image/webp", "image/gif"];

const MAX_MEDIA_SIZE = 20 * 1024 * 1024; // 20 MB
const ALLOWED_MEDIA_TYPES = ["image/jpeg", "image/png", "image/webp", "image/gif", "video/mp4", "video/webm"];

const s3 = new S3Client({
  region: AWS_REGION,
  credentials: AWS_ACCESS_KEY_ID
    ? { accessKeyId: AWS_ACCESS_KEY_ID, secretAccessKey: AWS_SECRET_ACCESS_KEY }
    : undefined, // falls back to IAM role (ECS task role)
});

function publicUrl(key: string): string {
  return `https://${BUCKET}.s3.${AWS_REGION}.amazonaws.com/${key}`;
}

export function validateUpload(file: Express.Multer.File): void {
  if (!ALLOWED_MIME_TYPES.includes(file.mimetype)) {
    throw new Error("Invalid file type. Allowed: JPEG, PNG, WebP, GIF.");
  }
  if (file.size > MAX_FILE_SIZE) {
    throw new Error("File too large. Maximum size is 5 MB.");
  }
}

export function validateMediaUpload(file: Express.Multer.File): void {
  if (!ALLOWED_MEDIA_TYPES.includes(file.mimetype)) {
    throw new Error("Invalid file type. Allowed: JPEG, PNG, WebP, GIF, MP4, WebM.");
  }
  if (file.size > MAX_MEDIA_SIZE) {
    throw new Error("File too large. Maximum size is 20 MB.");
  }
}

export async function uploadToS3(
  file: Express.Multer.File,
  folder: string,
  validate: (f: Express.Multer.File) => void = validateUpload,
): Promise<string> {
  validate(file);

  const ext = path.extname(file.originalname).toLowerCase() || ".jpg";
  const key = `uploads/${folder}/${crypto.randomUUID()}${ext}`;

  await s3.send(
    new PutObjectCommand({
      Bucket: BUCKET,
      Key: key,
      Body: file.buffer,
      ContentType: file.mimetype,
      CacheControl: "public, max-age=31536000, immutable",
    })
  );

  return publicUrl(key);
}

export async function deleteFromS3(url: string): Promise<void> {
  if (!url.includes(BUCKET)) return; // not our file, skip
  try {
    const key = new URL(url).pathname.slice(1); // remove leading /
    await s3.send(new DeleteObjectCommand({ Bucket: BUCKET, Key: key }));
  } catch {
    // best-effort deletion — don't block on failures
  }
}
