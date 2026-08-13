import { useState, useCallback } from "react";

export interface AccountRequest {
  id: string;
  submittedAt: string;
  submitterEmail: string;                // The user's email sending the request
  // Step 1 – Project Info
  division: string;
  projectName: string;
  accountEnvironment: string;          // e.g. "DEV, UAT, PROD" (Text input)
  businessJustification?: string;      // Optional
  pointOfContact: string;
  accountManager: string;
  // Step 2 – Account Config
  adminEmails: string[];
  managedByCoforge: string;              // "Yes" | "No"
  externalAudienceAccess: string;        // "Yes" | "No"
  storesCustomerData: string;            // "Yes" | "No"
  customerDataDetails?: string;          // populated if storesCustomerData === "Yes"
  storesConfidentialData: string;        // "Yes" | "No"
  // Step 3 – Financials
  estimatedMonthlyCost: string;
  costChargedBack: string;               // "Yes" | "No"
  foreseenInBudget: string;              // "Yes" | "No"
  wbsCode?: string;                      // Optional
  costCenter?: string;                   // Optional
  awsPartnershipRelated: string;         // "Yes" | "No"
  budgetAlertEmails?: string[];          // Optional
  buFinanceController?: string;          // Optional
}

const STORAGE_KEY = "aws_account_requests";

function loadRecords(): AccountRequest[] {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) return [];
    const parsed = JSON.parse(raw);
    return Array.isArray(parsed)
      ? parsed.map((r) => ({
          ...r,
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

function saveRecords(records: AccountRequest[]) {
  localStorage.setItem(STORAGE_KEY, JSON.stringify(records));
}

export function useAccountRequests() {
  const [records, setRecords] = useState<AccountRequest[]>(loadRecords);

  const addRecord = useCallback((data: Omit<AccountRequest, "id" | "submittedAt">) => {
    const newRecord: AccountRequest = {
      ...data,
      id: crypto.randomUUID(),
      submittedAt: new Date().toISOString(),
    };
    setRecords((prev) => {
      const updated = [newRecord, ...prev];
      saveRecords(updated);
      return updated;
    });
    return newRecord;
  }, []);

  const updateRecord = useCallback((id: string, data: Partial<Omit<AccountRequest, "id" | "submittedAt">>) => {
    setRecords((prev) => {
      const updated = prev.map((r) => (r.id === id ? { ...r, ...data } : r));
      saveRecords(updated);
      return updated;
    });
  }, []);

  const deleteRecord = useCallback((id: string) => {
    setRecords((prev) => {
      const updated = prev.filter((r) => r.id !== id);
      saveRecords(updated);
      return updated;
    });
  }, []);

  return { records, addRecord, updateRecord, deleteRecord };
}
