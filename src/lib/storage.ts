/**
 * Cloudflare R2 (S3-compatible) storage.
 * Los archivos se guardan privados y se sirven vía signed URLs temporales.
 */
import { S3Client, PutObjectCommand, GetObjectCommand, DeleteObjectCommand } from '@aws-sdk/client-s3';
import { getSignedUrl } from '@aws-sdk/s3-request-presigner';

const requiredEnv = ['R2_ACCOUNT_ID', 'R2_ACCESS_KEY_ID', 'R2_SECRET_ACCESS_KEY', 'R2_BUCKET_NAME', 'R2_ENDPOINT'] as const;

function getClient() {
  for (const key of requiredEnv) {
    if (!process.env[key]) {
      throw new Error(`Falta variable de entorno ${key} para Cloudflare R2`);
    }
  }
  return new S3Client({
    region: 'auto',
    endpoint: process.env.R2_ENDPOINT,
    credentials: {
      accessKeyId: process.env.R2_ACCESS_KEY_ID!,
      secretAccessKey: process.env.R2_SECRET_ACCESS_KEY!,
    },
  });
}

const BUCKET = () => process.env.R2_BUCKET_NAME!;

export function buildStorageKey(opts: { patientId: string; filename: string }) {
  const safe = opts.filename.replace(/[^a-zA-Z0-9._-]+/g, '_');
  return `patients/${opts.patientId}/${Date.now()}-${safe}`;
}

export async function uploadFile(params: {
  key: string;
  body: Buffer | Uint8Array;
  contentType: string;
}) {
  const client = getClient();
  await client.send(
    new PutObjectCommand({
      Bucket: BUCKET(),
      Key: params.key,
      Body: params.body,
      ContentType: params.contentType,
    }),
  );
  return params.key;
}

export async function getSignedDownloadUrl(key: string, expiresInSeconds = 300) {
  const client = getClient();
  return getSignedUrl(client, new GetObjectCommand({ Bucket: BUCKET(), Key: key }), {
    expiresIn: expiresInSeconds,
  });
}

export async function deleteFile(key: string) {
  const client = getClient();
  await client.send(new DeleteObjectCommand({ Bucket: BUCKET(), Key: key }));
}
