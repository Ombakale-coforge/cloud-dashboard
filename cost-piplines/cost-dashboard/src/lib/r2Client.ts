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
      const command = new GetObjectCommand({
        Bucket: R2_BUCKET_NAME,
        Key: key,
      });
      const response = await s3Client.send(command);
      if (response.Body) {
        const str = await response.Body.transformToString();
        const parsed = JSON.parse(str);
        return { data: Array.isArray(parsed) ? parsed : defaultValue, actualKey: key };
      }
    } catch (err: any) {
      if (
        err.name === "NoSuchKey" ||
        err.$metadata?.httpStatusCode === 404
      ) {
        continue;
      }
      console.warn(`[R2 Client Read Warning] Key "${key}":`, err.message || err);
    }
  }

  return { data: defaultValue, actualKey: primaryKey };
}

/**
 * Writes JSON array to Cloudflare R2 bucket directly from browser.
 */
export async function writeJsonToR2(key: string, data: any): Promise<void> {
  const jsonStr = JSON.stringify(data, null, 2);
  const command = new PutObjectCommand({
    Bucket: R2_BUCKET_NAME,
    Key: key,
    Body: jsonStr,
    ContentType: "application/json",
  });

  await s3Client.send(command);
}
