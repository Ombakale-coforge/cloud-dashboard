import { useState, useCallback, useEffect } from "react";

export type RequestStatus = "pending" | "approved" | "rejected" | "under_review";

export interface AccountRequest {
  id: string;
  sqlId?: number;
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
  managedByCoforge: string | boolean;
  externalAudienceAccess: string | boolean;
  storesCustomerData: string | boolean;
  customerDataDetails?: string;
  storesConfidentialData: string | boolean;
  
  // Step 3 – Financials
  estimatedMonthlyCost: string | number;
  costChargedBack: string | boolean;
  foreseenInBudget: string | boolean;
  wbsCode?: string;
  costCenter?: string;
  awsPartnershipRelated: string | boolean;
  budgetAlertEmails?: string[];
  buFinanceController?: string;
}

export function useAccountRequests() {
  const [records, setRecords] = useState<AccountRequest[]>([]);
  const [loading, setLoading] = useState(true);

  // Fetch live account requests directly from SQL Server API
  const fetchRequests = useCallback(async () => {
    try {
      setLoading(true);
      const res = await fetch("/api/requests");
      if (res.ok) {
        const json = await res.json();
        if (json.success && Array.isArray(json.data)) {
          setRecords(json.data);
        }
      }
    } catch (err) {
      console.error("Failed to fetch requests from SQL Server:", err);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    fetchRequests();
  }, [fetchRequests]);

  const addRecord = useCallback(async (data: Omit<AccountRequest, "id" | "submittedAt">) => {
    try {
      const res = await fetch("/api/requests", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(data),
      });
      if (res.ok) {
        const json = await res.json();
        if (json.success && json.data) {
          setRecords((prev) => [json.data, ...prev]);
          return json.data;
        }
      }
    } catch (err) {
      console.error("Failed to save request to SQL Server:", err);
    }
    return null;
  }, []);

  const updateStatus = useCallback(
    async (id: string, status: RequestStatus, adminNotes?: string, adminEmail?: string) => {
      try {
        const res = await fetch(`/api/requests/${encodeURIComponent(id)}/status`, {
          method: "PUT",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            status,
            adminNotes,
            reviewedBy: adminEmail || "Admin",
          }),
        });
        if (res.ok) {
          const json = await res.json();
          if (json.success && json.data) {
            setRecords((prev) =>
              prev.map((r) => (r.id === id || String(r.sqlId) === id ? { ...r, ...json.data } : r))
            );
          }
        }
      } catch (err) {
        console.error("Failed to update status in SQL Server:", err);
      }
    },
    []
  );

  const deleteRecord = useCallback((id: string) => {
    setRecords((prev) => prev.filter((r) => r.id !== id));
  }, []);

  return { records, loading, addRecord, updateStatus, deleteRecord, refresh: fetchRequests };
}
