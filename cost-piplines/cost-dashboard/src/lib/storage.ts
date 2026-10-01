/**
 * Storage and Export Utilities
 *
 * Provides utilities for exporting requests and data audit backups.
 */

import type { AccountRequest } from "./useAccountRequests";

export function exportRequestsToJSON(requests: AccountRequest[]) {
  const blob = new Blob([JSON.stringify(requests, null, 2)], { type: "application/json" });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = `account-requests-export-${new Date().toISOString().slice(0, 10)}.json`;
  a.click();
  URL.revokeObjectURL(url);
}
