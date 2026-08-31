import {
  S3Client,
  GetObjectCommand,
  PutObjectCommand,
} from '@aws-sdk/client-s3';

// Build the R2 S3 client from Cloudflare Pages environment variables
function getR2Client(env) {
  const accountId = env.R2_ACCOUNT_ID || '';
  const accessKeyId =
    env.R2_ACCESS_KEY_ID_FOR_FORM ||
    env.R2_ACCESS_KEY_ID ||
    '';
  const secretAccessKey =
    env.R2_SECRET_ACCESS_KEY_FOR_FORM ||
    env.R2_SECRET_ACCESS_KEY ||
    '';

  return new S3Client({
    region: 'auto',
    endpoint: `https://${accountId}.r2.cloudflarestorage.com`,
    credentials: { accessKeyId, secretAccessKey },
  });
}

function getBucketName(env) {
  return env.R2_BUCKET_NAME_FOR_FORM || 'cost-dashboard-data';
}

// Read JSON from R2 with a primary and fallback key
export async function readFromR2(env, primaryKey, fallbackKey, defaultValue = []) {
  const s3 = getR2Client(env);
  const bucket = getBucketName(env);
  const keysToTry = [primaryKey, fallbackKey].filter(Boolean);

  for (const key of keysToTry) {
    try {
      const response = await s3.send(
        new GetObjectCommand({ Bucket: bucket, Key: key })
      );
      const str = await response.Body.transformToString();
      return { data: JSON.parse(str), actualKey: key };
    } catch (err) {
      if (err.name === 'NoSuchKey' || err.$metadata?.httpStatusCode === 404) {
        continue;
      }
      throw err;
    }
  }

  return { data: defaultValue, actualKey: primaryKey };
}

// Write JSON to R2
export async function writeToR2(env, key, data) {
  const s3 = getR2Client(env);
  const bucket = getBucketName(env);

  await s3.send(
    new PutObjectCommand({
      Bucket: bucket,
      Key: key,
      Body: JSON.stringify(data, null, 2),
      ContentType: 'application/json',
    })
  );
}

// Helper to create JSON responses
export function jsonResponse(body, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: {
      'Content-Type': 'application/json',
      'Access-Control-Allow-Origin': '*',
    },
  });
}

// Helper to handle CORS preflight
export function handleCors() {
  return new Response(null, {
    status: 204,
    headers: {
      'Access-Control-Allow-Origin': '*',
      'Access-Control-Allow-Methods': 'GET, POST, PUT, DELETE, OPTIONS',
      'Access-Control-Allow-Headers': 'Content-Type',
    },
  });
}
