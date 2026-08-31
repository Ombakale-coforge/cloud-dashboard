import React, { useState, useMemo } from "react";
import {
  useAccountRequests,
  type AccountRequest,
  type RequestStatus,
} from "@/lib/useAccountRequests";
import { exportRequestsToJSON, syncRequestsToR2 } from "@/lib/storage";
import {
  X,
  CheckCircle,
  XCircle,
  Clock,
  Search,
  Download,
  CloudUpload,
  Layers,
  Building,
  DollarSign,
  User,
  Shield,
  Eye,
  Check,
  AlertCircle,
  Sparkles,
} from "lucide-react";
import { Badge } from "@/components/ui/badge";

interface AdminRequestsModalProps {
  isOpen: boolean;
  onClose: () => void;
}

export function AdminRequestsModal({ isOpen, onClose }: AdminRequestsModalProps) {
  const { records, updateStatus, deleteRecord } = useAccountRequests();
  const [searchQuery, setSearchQuery] = useState("");
  const [statusFilter, setStatusFilter] = useState<string>("all");
  const [selectedRequest, setSelectedRequest] = useState<AccountRequest | null>(null);
  const [adminNote, setAdminNote] = useState("");
  const [syncStatus, setSyncStatus] = useState<string | null>(null);

  const filteredRequests = useMemo(() => {
    return records.filter((r) => {
      const matchesStatus =
        statusFilter === "all" || (r.status || "pending") === statusFilter;
      const q = searchQuery.toLowerCase();
      const matchesSearch =
        r.projectName?.toLowerCase().includes(q) ||
        r.submitterEmail?.toLowerCase().includes(q) ||
        r.division?.toLowerCase().includes(q) ||
        r.pointOfContact?.toLowerCase().includes(q);
      return matchesStatus && matchesSearch;
    });
  }, [records, statusFilter, searchQuery]);

  if (!isOpen) return null;

  const handleStatusChange = (id: string, newStatus: RequestStatus) => {
    updateStatus(id, newStatus, adminNote || undefined);
    if (selectedRequest && selectedRequest.id === id) {
      setSelectedRequest({
        ...selectedRequest,
        status: newStatus,
        adminNotes: adminNote || selectedRequest.adminNotes,
      });
    }
    setAdminNote("");
  };

  const handleSyncToR2 = async () => {
    setSyncStatus("Syncing with Cloudflare R2...");
    const result = await syncRequestsToR2(records);
    setSyncStatus(result.message);
    setTimeout(() => setSyncStatus(null), 4000);
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4 sm:p-6 bg-black/70 backdrop-blur-sm animate-in fade-in duration-200">
      <div className="relative w-full max-w-6xl max-h-[90vh] bg-background border border-border rounded-2xl shadow-2xl flex flex-col overflow-hidden text-foreground">
        {/* Header */}
        <div className="flex items-center justify-between px-6 py-4 border-b border-border bg-muted/20">
          <div className="flex items-center gap-3">
            <div className="flex h-10 w-10 items-center justify-center rounded-xl bg-indigo-500/10 border border-indigo-500/20 text-indigo-500">
              <Shield className="w-5 h-5" />
            </div>
            <div>
              <div className="flex items-center gap-2">
                <h2 className="text-lg font-bold text-foreground">Account Provisioning Requests</h2>
                <Badge variant="outline" className="text-xs bg-indigo-50 text-indigo-700 dark:bg-indigo-950/50 dark:text-indigo-300 border-indigo-200 dark:border-indigo-800">
                  {records.length} Total
                </Badge>
              </div>
              <p className="text-xs text-muted-foreground">Admin review, approval workflows, and Cloudflare R2 persistence</p>
            </div>
          </div>

          <div className="flex items-center gap-2">
            <button
              onClick={handleSyncToR2}
              className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg border border-border text-xs font-medium hover:bg-muted transition-colors"
              title="Sync with Cloudflare R2 Bucket"
            >
              <CloudUpload className="w-3.5 h-3.5 text-sky-500" />
              <span>Sync to R2</span>
            </button>
            <button
              onClick={() => exportRequestsToJSON(records)}
              className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg border border-border text-xs font-medium hover:bg-muted transition-colors"
              title="Export all requests to JSON"
            >
              <Download className="w-3.5 h-3.5 text-indigo-500" />
              <span>Export</span>
            </button>
            <button
              onClick={onClose}
              className="p-1.5 rounded-lg text-muted-foreground hover:text-foreground hover:bg-muted transition-colors"
            >
              <X className="w-5 h-5" />
            </button>
          </div>
        </div>

        {/* Sync status toast message */}
        {syncStatus && (
          <div className="px-6 py-2 bg-indigo-500/10 border-b border-indigo-500/20 text-xs text-indigo-400 flex items-center gap-2">
            <Sparkles className="w-3.5 h-3.5 animate-spin" />
            <span>{syncStatus}</span>
          </div>
        )}

        {/* Body content */}
        <div className="flex-1 overflow-hidden grid grid-cols-1 md:grid-cols-12 divide-y md:divide-y-0 md:divide-x divide-border">
          {/* Left: Request List (7 cols) */}
          <div className="md:col-span-7 flex flex-col h-full overflow-hidden p-4">
            {/* Filter toolbar */}
            <div className="flex flex-col sm:flex-row gap-2 mb-3">
              <div className="relative flex-1">
                <Search className="w-3.5 h-3.5 text-muted-foreground absolute left-3 top-2.5" />
                <input
                  type="text"
                  value={searchQuery}
                  onChange={(e) => setSearchQuery(e.target.value)}
                  placeholder="Search project, email, division..."
                  className="w-full pl-8 pr-3 py-1.5 text-xs bg-muted/40 border border-border rounded-lg focus:outline-none focus:ring-1 focus:ring-primary"
                />
              </div>

              <div className="flex gap-1 overflow-x-auto pb-1 sm:pb-0">
                {(["all", "pending", "approved", "rejected", "under_review"] as const).map((st) => (
                  <button
                    key={st}
                    onClick={() => setStatusFilter(st)}
                    className={`px-2.5 py-1 text-xs rounded-md capitalize font-medium transition-colors ${
                      statusFilter === st
                        ? "bg-primary text-primary-foreground font-semibold"
                        : "bg-muted/50 text-muted-foreground hover:bg-muted"
                    }`}
                  >
                    {st.replace("_", " ")}
                  </button>
                ))}
              </div>
            </div>

            {/* List */}
            <div className="flex-1 overflow-y-auto space-y-2 pr-1">
              {filteredRequests.length === 0 ? (
                <div className="text-center py-12 text-muted-foreground text-xs">
                  <AlertCircle className="w-8 h-8 mx-auto mb-2 opacity-40" />
                  <p>No requests found matching the current filters.</p>
                </div>
              ) : (
                filteredRequests.map((req) => {
                  const isSelected = selectedRequest?.id === req.id;
                  const currentStatus = req.status || "pending";

                  return (
                    <div
                      key={req.id}
                      onClick={() => setSelectedRequest(req)}
                      className={`p-3 rounded-xl border transition-all cursor-pointer ${
                        isSelected
                          ? "bg-primary/5 border-primary shadow-sm"
                          : "bg-card hover:bg-muted/40 border-border"
                      }`}
                    >
                      <div className="flex items-start justify-between gap-2 mb-1.5">
                        <div>
                          <span className="text-xs font-bold text-foreground">
                            {req.projectName || "Unnamed Project"}
                          </span>
                          <span className="text-[11px] text-muted-foreground ml-2">
                            {req.division}
                          </span>
                        </div>
                        <Badge
                          variant="outline"
                          className={`text-[10px] uppercase font-semibold ${
                            currentStatus === "approved"
                              ? "bg-emerald-500/10 text-emerald-600 dark:text-emerald-400 border-emerald-500/30"
                              : currentStatus === "rejected"
                              ? "bg-rose-500/10 text-rose-600 dark:text-rose-400 border-rose-500/30"
                              : currentStatus === "under_review"
                              ? "bg-amber-500/10 text-amber-600 dark:text-amber-400 border-amber-500/30"
                              : "bg-blue-500/10 text-blue-600 dark:text-blue-400 border-blue-500/30"
                          }`}
                        >
                          {currentStatus.replace("_", " ")}
                        </Badge>
                      </div>

                      <div className="flex items-center justify-between text-[11px] text-muted-foreground">
                        <div className="flex items-center gap-1.5">
                          <User className="w-3 h-3" />
                          <span>{req.submitterEmail || req.pointOfContact}</span>
                        </div>
                        <div className="flex items-center gap-1">
                          <Clock className="w-3 h-3" />
                          <span>{new Date(req.submittedAt).toLocaleDateString()}</span>
                        </div>
                      </div>

                      {req.estimatedMonthlyCost && (
                        <div className="mt-1.5 text-[11px] text-foreground font-medium flex items-center gap-1">
                          <span className="text-muted-foreground">Est. Cost:</span>
                          <span>${req.estimatedMonthlyCost}/mo</span>
                          <span className="text-muted-foreground ml-2">Env:</span>
                          <span className="text-primary font-semibold">{req.accountEnvironment}</span>
                        </div>
                      )}
                    </div>
                  );
                })
              )}
            </div>
          </div>

          {/* Right: Selected Request Detail & Review Panel (5 cols) */}
          <div className="md:col-span-5 flex flex-col h-full overflow-y-auto p-5 bg-muted/10">
            {selectedRequest ? (
              <div className="space-y-4">
                <div className="border-b border-border pb-3">
                  <div className="flex items-center justify-between mb-1">
                    <h3 className="font-bold text-base text-foreground">
                      {selectedRequest.projectName}
                    </h3>
                    <Badge variant="outline" className="text-xs">
                      {selectedRequest.accountEnvironment}
                    </Badge>
                  </div>
                  <p className="text-xs text-muted-foreground">
                    Division: <span className="text-foreground font-medium">{selectedRequest.division}</span>
                  </p>
                </div>

                {/* Details grid */}
                <div className="space-y-2.5 text-xs">
                  <div>
                    <span className="text-muted-foreground block text-[11px]">Submitter / Point of Contact</span>
                    <span className="font-medium text-foreground">{selectedRequest.pointOfContact} ({selectedRequest.submitterEmail})</span>
                  </div>

                  <div>
                    <span className="text-muted-foreground block text-[11px]">Account Manager</span>
                    <span className="font-medium text-foreground">{selectedRequest.accountManager}</span>
                  </div>

                  <div>
                    <span className="text-muted-foreground block text-[11px]">Estimated Monthly Spend</span>
                    <span className="font-bold text-emerald-600 dark:text-emerald-400">
                      ${selectedRequest.estimatedMonthlyCost || "0"} / month
                    </span>
                  </div>

                  {selectedRequest.businessJustification && (
                    <div>
                      <span className="text-muted-foreground block text-[11px]">Business Justification</span>
                      <p className="mt-0.5 p-2 bg-background rounded-lg border border-border text-foreground text-xs italic">
                        "{selectedRequest.businessJustification}"
                      </p>
                    </div>
                  )}

                  <div className="grid grid-cols-2 gap-2 pt-2 border-t border-border">
                    <div>
                      <span className="text-muted-foreground block text-[10px]">Managed by Coforge</span>
                      <span className="font-semibold text-foreground">{selectedRequest.managedByCoforge}</span>
                    </div>
                    <div>
                      <span className="text-muted-foreground block text-[10px]">Stores Customer Data</span>
                      <span className="font-semibold text-foreground">{selectedRequest.storesCustomerData}</span>
                    </div>
                    <div>
                      <span className="text-muted-foreground block text-[10px]">Cost Charged Back</span>
                      <span className="font-semibold text-foreground">{selectedRequest.costChargedBack}</span>
                    </div>
                    <div>
                      <span className="text-muted-foreground block text-[10px]">Budget Alert Emails</span>
                      <span className="font-semibold text-foreground">
                        {selectedRequest.budgetAlertEmails?.join(", ") || "None"}
                      </span>
                    </div>
                  </div>
                </div>

                {/* Admin Action Box */}
                <div className="mt-6 pt-4 border-t border-border space-y-3">
                  <label className="block text-xs font-semibold text-foreground">
                    Admin Review & Action
                  </label>

                  <textarea
                    rows={2}
                    value={adminNote}
                    onChange={(e) => setAdminNote(e.target.value)}
                    placeholder="Add approval comment or notes..."
                    className="w-full p-2 text-xs bg-background border border-input rounded-lg focus:outline-none focus:ring-1 focus:ring-primary"
                  />

                  <div className="grid grid-cols-3 gap-2">
                    <button
                      onClick={() => handleStatusChange(selectedRequest.id, "approved")}
                      className="flex items-center justify-center gap-1 py-2 px-2 rounded-lg bg-emerald-600 hover:bg-emerald-700 text-white text-xs font-semibold shadow-sm transition-colors"
                    >
                      <CheckCircle className="w-3.5 h-3.5" />
                      <span>Approve</span>
                    </button>
                    <button
                      onClick={() => handleStatusChange(selectedRequest.id, "under_review")}
                      className="flex items-center justify-center gap-1 py-2 px-2 rounded-lg bg-amber-600 hover:bg-amber-700 text-white text-xs font-semibold shadow-sm transition-colors"
                    >
                      <Clock className="w-3.5 h-3.5" />
                      <span>Review</span>
                    </button>
                    <button
                      onClick={() => handleStatusChange(selectedRequest.id, "rejected")}
                      className="flex items-center justify-center gap-1 py-2 px-2 rounded-lg bg-rose-600 hover:bg-rose-700 text-white text-xs font-semibold shadow-sm transition-colors"
                    >
                      <XCircle className="w-3.5 h-3.5" />
                      <span>Reject</span>
                    </button>
                  </div>
                </div>
              </div>
            ) : (
              <div className="h-full flex flex-col items-center justify-center text-center text-muted-foreground p-6 text-xs">
                <Eye className="w-8 h-8 opacity-30 mb-2" />
                <p>Select any request from the list to review details, approval status, and take administrative actions.</p>
              </div>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}
