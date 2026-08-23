import crypto from 'node:crypto';
import { S3Client, PutObjectCommand, GetObjectCommand, HeadObjectCommand, DeleteObjectsCommand } from '@aws-sdk/client-s3';
import { getSignedUrl } from '@aws-sdk/s3-request-presigner';

const endpoint = process.env.AWS_ENDPOINT_URL || process.env.BUCKET_ENDPOINT || process.env.ENDPOINT;
const accessKeyId = process.env.AWS_ACCESS_KEY_ID || process.env.BUCKET_ACCESS_KEY_ID || process.env.ACCESS_KEY_ID;
const secretAccessKey = process.env.AWS_SECRET_ACCESS_KEY || process.env.BUCKET_SECRET_ACCESS_KEY || process.env.SECRET_ACCESS_KEY;
export const bucket = process.env.AWS_S3_BUCKET_NAME || process.env.BUCKET || process.env.BUCKET_NAME;
if (!endpoint || !accessKeyId || !secretAccessKey || !bucket) throw new Error('Railway Bucket credentials are required.');

export const s3 = new S3Client({
  endpoint,
  region: process.env.AWS_DEFAULT_REGION || 'auto',
  credentials: { accessKeyId, secretAccessKey },
  forcePathStyle: String(process.env.AWS_S3_URL_STYLE || '').toLowerCase() === 'path',
});

export function safeFileName(name = 'asset') {
  return String(name).replace(/[^a-zA-Z0-9._-]+/g, '-').replace(/^-+|-+$/g, '').slice(-120) || 'asset';
}
export function objectKey({ wallet, purpose = 'project', filename = 'asset' }) {
  const date = new Date().toISOString().slice(0, 10);
  return `${purpose}/${date}/${String(wallet).toLowerCase()}/${crypto.randomUUID()}-${safeFileName(filename)}`;
}
export async function presignPut(key, contentType, expiresIn = 900) {
  return getSignedUrl(s3, new PutObjectCommand({ Bucket: bucket, Key: key, ContentType: contentType }), { expiresIn });
}
export async function presignGet(key, expiresIn = 86400) {
  return getSignedUrl(s3, new GetObjectCommand({ Bucket: bucket, Key: key }), { expiresIn });
}
export async function headObject(key) {
  return s3.send(new HeadObjectCommand({ Bucket: bucket, Key: key }));
}
export async function getBuffer(key) {
  const result = await s3.send(new GetObjectCommand({ Bucket: bucket, Key: key }));
  if (!result.Body) throw new Error('Bucket object has no body.');
  if (typeof result.Body.transformToByteArray === 'function') return Buffer.from(await result.Body.transformToByteArray());
  const chunks = [];
  for await (const chunk of result.Body) chunks.push(Buffer.from(chunk));
  return Buffer.concat(chunks);
}
export async function putBuffer(key, body, contentType) {
  await s3.send(new PutObjectCommand({ Bucket: bucket, Key: key, Body: body, ContentType: contentType, CacheControl: 'public, max-age=31536000, immutable' }));
}


export async function deleteObjects(keys = []) {
  const unique = [...new Set((keys || []).filter(Boolean))];
  for (let i = 0; i < unique.length; i += 1000) {
    const batch = unique.slice(i, i + 1000);
    if (!batch.length) continue;
    const result = await s3.send(new DeleteObjectsCommand({ Bucket: bucket, Delete: { Objects: batch.map(Key => ({ Key })), Quiet: true } }));
    if (result.Errors?.length) throw new Error(`Railway Bucket failed to delete ${result.Errors.length} object(s).`);
  }
  return unique.length;
}
