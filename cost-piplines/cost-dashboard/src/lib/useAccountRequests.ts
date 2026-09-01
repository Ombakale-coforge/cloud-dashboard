import { useState, useCallback, useEffect } from "react";
import { readJsonFromR2, writeJsonToR2 } from "@/lib/r2Client";

export type RequestStatus = "pending" | "approved" | "rejected" | "under_review";

export interface AccountRequest {
  id: string;
  submittedAt: string;
  submitterEmail: string;
  submitterName?: string;
  status?: RequestStatus;
  adminNotes?: string;
  reviewedBy?: string;
  reviewedAt?: string;
  
  // Step 1 – Project Info
  division: string;
  projectName: string;
  accountEnvironment: string;
  businessJustification?: string;
  pointOfContact: string;
  accountManager: string;
  
  // Step 2 – Account Config
  adminEmails: string[];
  managedByCoforge: string;
  externalAudienceAccess: string;
  storesCustomerData: string;
  customerDataDetails?: string;
  storesConfidentialData: string;
  
  // Step 3 – Financials
  estimatedMonthlyCost: string;
  costChargedBack: string;
  foreseenInBudget: string;
  wbsCode?: string;
  costCenter?: string;
  awsPartnershipRelated: string;
  budgetAlertEmails?: string[];
  buFinanceController?: string;
}

const STORAGE_KEY = "aws_account_requests";

function loadLocalRecords(): AccountRequest[] {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) return [];
    const parsed = JSON.parse(raw);
    return Array.isArray(parsed)
      ? parsed.map((r) => ({
          ...r,
          status: r.status || "pending",
          accountEnvironment: Array.isArray(r.accountEnvironment)
            ? r.accountEnvironment.join(", ")
            : r.accountEnvironment || "",
          submitterEmail: r.submitterEmail || r.pointOfContact || "",
        }))
      : [];
  } catch {
    return [];
  }
}

export function useAccountRequests() {
  const [records, setRecords] = useState<AccountRequest[]>(loadLocalRecords);

  // Fetch live account requests directly from Cloudflare R2 bucket
  useEffect(() => {
    let isMounted = true;

    async function syncFromR2() {
      try {
        const { data: remoteData } = await readJsonFromR2(
          "accound_request.json",
          "account_requests.json",
          []
        );
        if (Array.isArray(remoteData) && remoteData.length > 0 && isMounted) {
          setRecords(remoteData);
          localStorage.setItem(STORAGE_KEY, JSON.stringify(remoteData));
        }
      } catch (err) {
        console.warn("Using local cache for account requests:", err);
      }
    }

    syncFromR2();
    return () => {
      isMounted = false;
    };
  }, []);

  const addRecord = useCallback(async (data: Omit<AccountRequest, "id" | "submittedAt">) => {
    const newRecord: AccountRequest = {
      ...data,
      id: `req-${Date.now().toString(36)}`,
      submittedAt: new Date().toISOString(),
      status: "pending",
    };

    // 1. Optimistically update local state & cache
    setRecords((prev) => {
      const updated = [newRecord, ...prev];
      localStorage.setItem(STORAGE_KEY, JSON.stringify(updated));
      return updated;
    });

    // 2. Persist directly to Cloudflare R2 bucket accound_request.json
    try {
      const { data: currentRequests, actualKey } = await readJsonFromR2(
        "accound_request.json",
        "account_requests.json",
        []
      );
      const updatedRequests = [newRecord, ...currentRequests.filter((r) => r.id !== newRecord.id)];
      await writeJsonToR2(actualKey || "accound_request.json", updatedRequests);
    } catch (err) {
      console.error("Failed to sync new request directly to R2 bucket:", err);
    }

    return newRecord;
  }, []);

  const updateStatus = useCallback(
    async (id: string, status: RequestStatus, adminNotes?: string, adminEmail?: string) => {
      // 1. Optimistically update state & cache
      setRecords((prev) => {
        const updated = prev.map((r) =>
          r.id === id
            ? {
                ...r,
                status,
                adminNotes: adminNotes ?? r.adminNotes,
                reviewedBy: adminEmail || "Admin",
                reviewedAt: new Date().toISOString(),
              }
            : r
        );
        localStorage.setItem(STORAGE_KEY, JSON.stringify(updated));
        return updated;
      });

      // 2. Persist status update directly to Cloudflare R2 bucket accound_request.json
      try {
        const { data: currentRequests, actualKey } = await readJsonFromR2(
          "accound_request.json",
          "account_requests.json",
          []
        );
        const index = currentRequests.findIndex((r) => r.id === id);
        if (index !== -1) {
          currentRequests[index] = {
            ...currentRequests[index],
            status: status || currentRequests[index].status,
            adminNotes: adminNotes ?? currentRequests[index].adminNotes,
            reviewedBy: adminEmail || "Admin",
            reviewedAt: new Date().toISOString(),
          };
          await writeJsonToR2(actualKey || "accound_request.json", currentRequests);
        }
      } catch (err) {
        console.error("Failed to update status directly in R2 bucket:", err);
      }
    },
    []
  );

  const deleteRecord = useCallback((id: string) => {
    setRecords((prev) => {
      const updated = prev.filter((r) => r.id !== id);
      localStorage.setItem(STORAGE_KEY, JSON.stringify(updated));
      return updated;
    });
  }, []);

  return { records, addRecord, updateStatus, deleteRecord };
}
