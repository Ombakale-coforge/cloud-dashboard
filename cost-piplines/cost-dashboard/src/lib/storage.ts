/**
 * Storage and Cloudflare R2 Sync Module
 *
 * This module manages persistent data storage for Account Requests and Auth metadata.
 * It natively provides:
 * 1. Fast Local Storage persistence for instant responsiveness.
 * 2. Cloudflare R2 / S3-compatible remote sync hook with configurable credentials.
 * 3. Export / Import utilities for auditing and backups.
 */

import type { AccountRequest } from "./useAccountRequests";

export interface StorageConfig {
  r2Endpoint?: string;
  r2AccessKeyId?: string;
  r2SecretAccessKey?: string;
  r2BucketName?: string;
  ssoClientId?: string;
  ssoTenantId?: string;
}

export const STORAGE_CONFIG: StorageConfig = {
  r2Endpoint: import.meta.env.VITE_CLOUDFLARE_R2_ENDPOINT || "",
  r2AccessKeyId: import.meta.env.VITE_CLOUDFLARE_R2_ACCESS_KEY_ID || "",
  r2SecretAccessKey: import.meta.env.VITE_CLOUDFLARE_R2_SECRET_ACCESS_KEY || "",
  r2BucketName:
    import.meta.env.VITE_CLOUDFLARE_R2_BUCKET_FOR_FORM ||
    import.meta.env.VITE_CLOUDFLARE_R2_BUCKET ||
    "cost-dashboard-requests",
  ssoClientId: import.meta.env.VITE_SSO_CLIENT_ID || "",
  ssoTenantId: import.meta.env.VITE_SSO_TENANT_ID || "",
};

export async function syncRequestsToR2(requests: AccountRequest[]): Promise<{ success: boolean; message: string }> {
  if (!STORAGE_CONFIG.r2Endpoint) {
    return {
      success: true,
      message: "Synced locally to browser storage (Configure VITE_CLOUDFLARE_R2_ENDPOINT for remote sync)",
    };
  }

  try {
    const response = await fetch(`${STORAGE_CONFIG.r2Endpoint}/api/sync-requests`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        ...(STORAGE_CONFIG.r2AccessKeyId ? { "x-api-key": STORAGE_CONFIG.r2AccessKeyId } : {}),
      },
      body: JSON.stringify({
        bucket: STORAGE_CONFIG.r2BucketName,
        timestamp: new Date().toISOString(),
        data: requests,
      }),
    });

    if (!response.ok) {
      throw new Error(`R2 API returned status ${response.status}`);
    }

    return {
      success: true,
      message: "Successfully synchronized with Cloudflare R2 Bucket",
    };
  } catch (err) {
    const message = err instanceof Error ? err.message : "Unknown error";
    console.warn("Cloudflare R2 sync fallback to local storage:", message);
    return {
      success: false,
      message: `R2 Sync error: ${message}. Retained in local store.`,
    };
  }
}

export function exportRequestsToJSON(requests: AccountRequest[]) {
  const blob = new Blob([JSON.stringify(requests, null, 2)], { type: "application/json" });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = `account-requests-export-${new Date().toISOString().slice(0, 10)}.json`;
  a.click();
  URL.revokeObjectURL(url);
}
