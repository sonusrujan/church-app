import { S3Client, PutObjectCommand, DeleteObjectCommand } from "@aws-sdk/client-s3";
import { AWS_REGION } from "../config";
import crypto from "crypto";
import path from "path";

const BUCKET = process.env.S3_UPLOAD_BUCKET || "shalom-uploads-357644040292";
const MAX_FILE_SIZE = 5 * 1024 * 1024; // 5 MB
const ALLOWED_MIME_TYPES = ["image/jpeg", "image/png", "image/webp", "image/gif"];

const MAX_MEDIA_SIZE = 20 * 1024 * 1024; // 20 MB
const ALLOWED_MEDIA_TYPES = ["image/jpeg", "image/png", "image/webp", "image/gif", "video/mp4", "video/webm"];

// C-1 FIX: Magic-byte signatures for file type verification
const MAGIC_BYTES: Record<string, { offset: number; bytes: number[] }[]> = {
  "image/jpeg": [{ offset: 0, bytes: [0xff, 0xd8, 0xff] }],
  "image/png": [{ offset: 0, bytes: [0x89, 0x50, 0x4e, 0x47] }],
  "image/webp": [{ offset: 8, bytes: [0x57, 0x45, 0x42, 0x50] }], // "WEBP" at offset 8
  "image/gif": [
    { offset: 0, bytes: [0x47, 0x49, 0x46, 0x38, 0x37] }, // GIF87a
    { offset: 0, bytes: [0x47, 0x49, 0x46, 0x38, 0x39] }, // GIF89a
  ],
  "video/mp4": [{ offset: 4, bytes: [0x66, 0x74, 0x79, 0x70] }], // "ftyp" at offset 4
  "video/webm": [{ offset: 0, bytes: [0x1a, 0x45, 0xdf, 0xa3] }], // EBML header
};

const ALLOWED_EXTENSIONS = new Set([".jpg", ".jpeg", ".png", ".webp", ".gif"]);
const ALLOWED_MEDIA_EXTENSIONS = new Set([".jpg", ".jpeg", ".png", ".webp", ".gif", ".mp4", ".webm"]);

function verifyMagicBytes(buffer: Buffer, mime: string): boolean {
  const signatures = MAGIC_BYTES[mime];
  if (!signatures) return false;
  return signatures.some((sig) =>
    sig.bytes.every((b, i) => buffer.length > sig.offset + i && buffer[sig.offset + i] === b),
  );
}

function getExtension(filename: string): string {
  return path.extname(filename).toLowerCase();
}

const s3 = new S3Client({
  region: AWS_REGION,
  credentials: process.env.AWS_ACCESS_KEY_ID
    ? { accessKeyId: process.env.AWS_ACCESS_KEY_ID, secretAccessKey: process.env.AWS_SECRET_ACCESS_KEY || "" }
    : undefined, // falls back to IAM role (ECS task role)
});

function publicUrl(key: string): string {
  return `https://${BUCKET}.s3.${AWS_REGION}.amazonaws.com/${key}`;
}

export function validateUpload(file: Express.Multer.File): void {
  if (!ALLOWED_MIME_TYPES.includes(file.mimetype)) {
    throw new Error("Invalid file type. Allowed: JPEG, PNG, WebP, GIF.");
  }
  const ext = getExtension(file.originalname);
  if (!ALLOWED_EXTENSIONS.has(ext)) {
    throw new Error("Invalid file extension. Allowed: .jpg, .jpeg, .png, .webp, .gif");
  }
  if (!verifyMagicBytes(file.buffer, file.mimetype)) {
    throw new Error("File content does not match declared type.");
  }
  if (file.size > MAX_FILE_SIZE) {
    throw new Error("File too large. Maximum size is 5 MB.");
  }
}

export function validateMediaUpload(file: Express.Multer.File): void {
  if (!ALLOWED_MEDIA_TYPES.includes(file.mimetype)) {
    throw new Error("Invalid file type. Allowed: JPEG, PNG, WebP, GIF, MP4, WebM.");
  }
  const ext = getExtension(file.originalname);
  if (!ALLOWED_MEDIA_EXTENSIONS.has(ext)) {
    throw new Error("Invalid file extension. Allowed: .jpg, .jpeg, .png, .webp, .gif, .mp4, .webm");
  }
  if (!verifyMagicBytes(file.buffer, file.mimetype)) {
    throw new Error("File content does not match declared type.");
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
      ContentDisposition: file.mimetype.startsWith("image/svg") ? "attachment" : "inline",
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
