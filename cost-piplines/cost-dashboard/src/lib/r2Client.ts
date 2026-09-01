import {
  S3Client,
  GetObjectCommand,
  PutObjectCommand,
} from "@aws-sdk/client-s3";

// R2 Bucket credentials for Login & Form Data
const R2_ACCOUNT_ID =
  import.meta.env.VITE_R2_ACCOUNT_ID || "6e3f04ba163cf6baef338de059890ce7";

const R2_ACCESS_KEY_ID =
  import.meta.env.VITE_R2_ACCESS_KEY_ID || "19de21e572cf4de37f845ce570f36ec8";

const R2_SECRET_ACCESS_KEY =
  import.meta.env.VITE_R2_SECRET_ACCESS_KEY ||
  "263bf600f05d5ad521a73098d14fc46b1430fa0dfe96cdc1f1755be942ccf667";

const R2_BUCKET_NAME =
  import.meta.env.VITE_R2_BUCKET_NAME || "cost-dashboard-data";

console.log(
  `📦 [R2 Client Init] Target Bucket: "${R2_BUCKET_NAME}", Endpoint: https://${R2_ACCOUNT_ID}.r2.cloudflarestorage.com`
);

const s3Client = new S3Client({
  region: "auto",
  endpoint: `https://${R2_ACCOUNT_ID}.r2.cloudflarestorage.com`,
  credentials: {
    accessKeyId: R2_ACCESS_KEY_ID,
    secretAccessKey: R2_SECRET_ACCESS_KEY,
  },
});

/**
 * Reads JSON array from Cloudflare R2 bucket directly from browser.
 */
export async function readJsonFromR2<T = any>(
  primaryKey: string,
  fallbackKey?: string,
  defaultValue: T[] = []
): Promise<{ data: T[]; actualKey: string }> {
  const keysToTry = [primaryKey, fallbackKey].filter(Boolean) as string[];

  for (const key of keysToTry) {
    try {
      console.log(`📥 [R2 Read Attempt] Bucket: "${R2_BUCKET_NAME}", Key: "${key}"`);
      const command = new GetObjectCommand({
        Bucket: R2_BUCKET_NAME,
        Key: key,
      });
      const response = await s3Client.send(command);
      if (response.Body) {
        const str = await response.Body.transformToString();
        if (!str || !str.trim()) {
          console.warn(`⚠️ [R2 Read Empty File] Key "${key}" is 0 bytes.`);
          return { data: defaultValue, actualKey: key };
        }
        try {
          const parsed = JSON.parse(str);
          console.log(`✅ [R2 Read Success] Key "${key}", Items: ${Array.isArray(parsed) ? parsed.length : 1}`);
          return { data: Array.isArray(parsed) ? parsed : defaultValue, actualKey: key };
        } catch (jsonErr: any) {
          console.error(`❌ [R2 JSON Parse Error] Key "${key}" content is invalid JSON:`, jsonErr.message, str);
          return { data: defaultValue, actualKey: key };
        }
      }
    } catch (err: any) {
      if (
        err.name === "NoSuchKey" ||
        err.$metadata?.httpStatusCode === 404
      ) {
        console.log(`ℹ️ [R2 Key Not Found] "${key}" does not exist in bucket "${R2_BUCKET_NAME}"`);
        continue;
      }
      console.error(`❌ [R2_CLIENT_ERROR] Read failed for Key "${key}":`, err.name, err.message, err);
    }
  }

  return { data: defaultValue, actualKey: primaryKey };
}

/**
 * Writes JSON array to Cloudflare R2 bucket directly from browser.
 */
export async function writeJsonToR2(key: string, data: any): Promise<void> {
  try {
    const jsonStr = JSON.stringify(data, null, 2);
    console.log(`📤 [R2 Write Attempt] Bucket: "${R2_BUCKET_NAME}", Key: "${key}", Length: ${jsonStr.length} bytes`);
    const command = new PutObjectCommand({
      Bucket: R2_BUCKET_NAME,
      Key: key,
      Body: jsonStr,
      ContentType: "application/json",
    });

    await s3Client.send(command);
    console.log(`✅ [R2 Write Success] Key "${key}" successfully saved to bucket "${R2_BUCKET_NAME}"`);
  } catch (err: any) {
    console.error(`❌ [R2_CLIENT_ERROR] Write failed for Key "${key}":`, err.name, err.message, err);
    throw new Error(`[R2 WRITE ERROR] ${err.name || "Error"}: ${err.message || "Failed to write to Cloudflare R2"}`);
  }
}
