import { useState, useMemo } from "react";
import { TooltipProvider } from "@/components/ui/tooltip";
import { AccountRequestForm } from "@/components/AccountRequestForm";
import { useAccountRequests } from "@/lib/useAccountRequests";
import { useAuth } from "@/lib/auth";
import {
  Cloud,
  ArrowLeft,
  LogOut,
  Clock,
  CheckCircle,
  XCircle,
  AlertCircle,
  PlusCircle,
  ListOrdered,
} from "lucide-react";
import { useNavigate } from "react-router-dom";
import { Badge } from "@/components/ui/badge";

export function NewRequestPage() {
  const { records, addRecord } = useAccountRequests();
  const { user, logout, isAdmin } = useAuth();
  const navigate = useNavigate();
  const [activeView, setActiveView] = useState<"form" | "my-requests">("form");

  const myRequests = useMemo(() => {
    if (!user) return [];
    if (isAdmin) return records;
    const userEmail = (user.email || "").toLowerCase();
    const userName = (user.name || "").toLowerCase();
    return records.filter((r) => {
      const submitter = (r.submitterEmail || "").toLowerCase();
      const poc = (r.pointOfContact || "").toLowerCase();
      return (
        (userEmail && submitter === userEmail) ||
        (userName && poc && poc.includes(userName))
      );
    });
  }, [records, user, isAdmin]);

  const handleSignOut = () => {
    logout();
    navigate("/login");
  };

  return (
    <TooltipProvider>
      <div className="min-h-screen bg-muted/30 text-foreground">
        {/* Header */}
        <header className="sticky top-0 z-50 flex items-center justify-between border-b bg-background/80 px-6 py-3.5 backdrop-blur">
          <div className="flex items-center gap-3">
            <div className="flex h-10 w-10 items-center justify-center rounded-xl bg-primary/10 border border-primary/20">
              <Cloud className="h-6 w-6 text-primary" />
            </div>
            <div>
              <div className="flex items-center gap-2">
                <h1 className="text-xl font-bold">Cloud Cost Intelligence</h1>
                <Badge
                  variant="outline"
                  className={
                    isAdmin
                      ? "bg-indigo-50 text-indigo-700 dark:bg-indigo-950/50 dark:text-indigo-300 border-indigo-200"
                      : "bg-emerald-50 text-emerald-700 dark:bg-emerald-950/50 dark:text-emerald-300 border-emerald-200"
                  }
                >
                  {isAdmin ? "Admin View" : "Requester Portal"}
                </Badge>
              </div>
              <p className="text-sm text-muted-foreground">
                AWS Account Provisioning & Approval Center
              </p>
            </div>
          </div>

          <div className="flex items-center gap-3">
            {/* View Switcher: Submit Form vs My Requests */}
            <div className="flex rounded-xl bg-muted/60 p-1 border border-border">
              <button
                onClick={() => setActiveView("form")}
                className={`flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-semibold transition-all ${
                  activeView === "form"
                    ? "bg-background text-foreground shadow-sm"
                    : "text-muted-foreground hover:text-foreground"
                }`}
              >
                <PlusCircle size={14} />
                <span>Request Form</span>
              </button>

              <button
                onClick={() => setActiveView("my-requests")}
                className={`flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-semibold transition-all ${
                  activeView === "my-requests"
                    ? "bg-background text-foreground shadow-sm"
                    : "text-muted-foreground hover:text-foreground"
                }`}
              >
                <ListOrdered size={14} />
                <span>{isAdmin ? "All Submissions" : "My Requests"} ({myRequests.length})</span>
              </button>
            </div>

            {/* Back to Admin Dashboard if Admin */}
            {isAdmin && (
              <button
                onClick={() => navigate("/")}
                className="flex items-center gap-1.5 rounded-xl border border-border bg-card px-3.5 py-1.5 text-xs font-semibold text-foreground hover:bg-muted/50 transition-colors"
              >
                <ArrowLeft size={14} />
                <span>Back to Dashboard</span>
              </button>
            )}

            {/* User details and Logout */}
            <div className="flex items-center gap-2 pl-2 border-l border-border">
              <div className="hidden sm:flex flex-col text-right">
                <span className="text-xs font-medium text-foreground leading-none">
                  {user?.name}
                </span>
                <span className="text-[10px] text-muted-foreground">
                  {user?.email}
                </span>
              </div>

              <button
                onClick={handleSignOut}
                className="flex items-center gap-1 p-2 text-muted-foreground hover:text-rose-500 hover:bg-rose-500/10 rounded-xl transition-colors"
                title="Sign Out"
              >
                <LogOut size={16} />
              </button>
            </div>
          </div>
        </header>

        {/* Main Body */}
        <main className="mx-auto max-w-4xl space-y-8 p-6">
          {activeView === "form" ? (
            <AccountRequestForm onSubmit={addRecord} />
          ) : (
            <div className="space-y-4">
              <div className="flex items-center justify-between">
                <div>
                  <h2 className="text-lg font-bold text-foreground">
                    {isAdmin ? "Submitted AWS Account Requests" : "Your Account Requests & Approval Status"}
                  </h2>
                  <p className="text-xs text-muted-foreground">
                    Track approvals, FinOps reviews, and provisioned environments.
                  </p>
                </div>
                <button
                  onClick={() => setActiveView("form")}
                  className="flex items-center gap-1.5 rounded-xl bg-indigo-600 hover:bg-indigo-700 text-white px-3.5 py-1.5 text-xs font-semibold shadow-sm transition-all"
                >
                  <PlusCircle size={14} />
                  <span>Submit Another Request</span>
                </button>
              </div>

              {myRequests.length === 0 ? (
                <div className="rounded-2xl border border-border bg-card p-12 text-center text-muted-foreground">
                  <AlertCircle className="w-10 h-10 mx-auto mb-3 opacity-40 text-indigo-500" />
                  <h3 className="font-semibold text-foreground text-sm mb-1">No requests found</h3>
                  <p className="text-xs max-w-md mx-auto mb-4">
                    You haven't submitted any account provisioning requests yet. Click the button below to start a new request.
                  </p>
                  <button
                    onClick={() => setActiveView("form")}
                    className="inline-flex items-center gap-1.5 px-4 py-2 rounded-xl bg-primary text-primary-foreground text-xs font-semibold shadow-sm hover:opacity-90"
                  >
                    <PlusCircle size={14} />
                    <span>Create New Account Request</span>
                  </button>
                </div>
              ) : (
                <div className="grid gap-4">
                  {myRequests.map((req) => {
                    const status = req.status || "pending";
                    return (
                      <div
                        key={req.id}
                        className="rounded-2xl border border-border bg-card p-5 shadow-sm space-y-3 transition-all hover:border-primary/40"
                      >
                        <div className="flex items-start justify-between gap-3">
                          <div>
                            <div className="flex items-center gap-2">
                              <h3 className="font-bold text-base text-foreground">
                                {req.projectName}
                              </h3>
                              <Badge variant="outline" className="text-xs">
                                {req.accountEnvironment}
                              </Badge>
                            </div>
                            <p className="text-xs text-muted-foreground mt-0.5">
                              Division: <span className="font-medium text-foreground">{req.division}</span> • Contact: <span className="font-medium text-foreground">{req.pointOfContact}</span>
                            </p>
                          </div>

                          <div className="text-right">
                            <Badge
                              variant="outline"
                              className={`text-xs capitalize font-semibold ${
                                status === "approved"
                                  ? "bg-emerald-500/10 text-emerald-600 dark:text-emerald-400 border-emerald-500/30"
                                  : status === "rejected"
                                  ? "bg-rose-500/10 text-rose-600 dark:text-rose-400 border-rose-500/30"
                                  : status === "under_review"
                                  ? "bg-amber-500/10 text-amber-600 dark:text-amber-400 border-amber-500/30"
                                  : "bg-blue-500/10 text-blue-600 dark:text-blue-400 border-blue-500/30"
                              }`}
                            >
                              {status === "approved" && <CheckCircle className="w-3 h-3 mr-1 inline" />}
                              {status === "rejected" && <XCircle className="w-3 h-3 mr-1 inline" />}
                              {status === "under_review" && <Clock className="w-3 h-3 mr-1 inline" />}
                              {status === "pending" && <Clock className="w-3 h-3 mr-1 inline" />}
                              {status.replace("_", " ")}
                            </Badge>
                            <p className="text-[11px] text-muted-foreground mt-1">
                              Submitted: {new Date(req.submittedAt).toLocaleDateString()}
                            </p>
                          </div>
                        </div>

                        {req.adminNotes && (
                          <div className="p-3 bg-muted/40 rounded-xl border border-border text-xs">
                            <span className="font-semibold text-foreground block mb-0.5">
                              Admin Feedback ({req.reviewedBy || "FinOps"}):
                            </span>
                            <p className="text-muted-foreground italic">"{req.adminNotes}"</p>
                          </div>
                        )}

                        <div className="grid grid-cols-2 sm:grid-cols-4 gap-2 pt-2 border-t border-border text-xs text-muted-foreground">
                          <div>
                            <span className="block text-[10px]">Est. Monthly Cost</span>
                            <span className="font-semibold text-foreground">
                              ${req.estimatedMonthlyCost || "0"}/mo
                            </span>
                          </div>
                          <div>
                            <span className="block text-[10px]">Managed By Coforge</span>
                            <span className="font-semibold text-foreground">
                              {req.managedByCoforge}
                            </span>
                          </div>
                          <div>
                            <span className="block text-[10px]">Account Manager</span>
                            <span className="font-semibold text-foreground">
                              {req.accountManager}
                            </span>
                          </div>
                          <div>
                            <span className="block text-[10px]">Charged Back</span>
                            <span className="font-semibold text-foreground">
                              {req.costChargedBack}
                            </span>
                          </div>
                        </div>
                      </div>
                    );
                  })}
                </div>
              )}
            </div>
          )}
        </main>
      </div>
    </TooltipProvider>
  );
}
