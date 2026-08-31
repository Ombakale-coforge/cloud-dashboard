import { useState, useCallback, useEffect } from "react";

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

  // Fetch live from backend / Cloudflare R2 on mount
  useEffect(() => {
    let isMounted = true;
    async function fetchFromR2() {
      try {
        const res = await fetch("/api/requests");
        if (res.ok) {
          const json = await res.json();
          if (json.data && Array.isArray(json.data) && isMounted) {
            setRecords(json.data);
            localStorage.setItem(STORAGE_KEY, JSON.stringify(json.data));
          }
        }
      } catch (err) {
        console.warn("Using local cache for account requests:", err);
      }
    }
    fetchFromR2();
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

    // 2. Persist directly to Cloudflare R2 bucket via server API
    try {
      const res = await fetch("/api/requests", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(newRecord),
      });
      if (res.ok) {
        const json = await res.json();
        if (json.data) {
          setRecords((prev) =>
            prev.map((r) => (r.id === newRecord.id ? json.data : r))
          );
        }
      }
    } catch (err) {
      console.error("Failed to sync new request with Cloudflare R2:", err);
    }

    return newRecord;
  }, []);

  const updateStatus = useCallback(
    async (id: string, status: RequestStatus, adminNotes?: string, adminEmail?: string) => {
      // 1. Optimistically update state
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

      // 2. Persist status update to Cloudflare R2
      try {
        await fetch(`/api/requests/${id}/status`, {
          method: "PUT",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            status,
            adminNotes,
            reviewedBy: adminEmail || "Admin",
          }),
        });
      } catch (err) {
        console.error("Failed to update request status in Cloudflare R2:", err);
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
