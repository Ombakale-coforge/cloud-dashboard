import { TooltipProvider } from "@/components/ui/tooltip";
import { AccountRequestForm } from "@/components/AccountRequestForm";
import { useAccountRequests } from "@/lib/useAccountRequests";
import { Cloud, ArrowLeft } from "lucide-react";
import { useNavigate } from "react-router-dom";

export function NewRequestPage() {
  const { addRecord } = useAccountRequests();
  const navigate = useNavigate();

  return (
    <TooltipProvider>
      <div className="min-h-screen bg-muted/30 text-foreground">
        <header className="sticky top-0 z-50 flex items-center justify-between border-b bg-background/80 px-6 py-3.5 backdrop-blur">
          <div className="flex items-center gap-3">
            <div className="flex h-10 w-10 items-center justify-center rounded-xl bg-primary/10 border border-primary/20">
              <Cloud className="h-6 w-6 text-primary" />
            </div>
            <div>
              <h1 className="text-xl font-bold">Cloud Cost Intelligence</h1>
              <p className="text-sm text-muted-foreground">
                New AWS Account Request
              </p>
            </div>
          </div>

          <button
            onClick={() => navigate("/")}
            className="flex items-center gap-1.5 rounded-xl border border-muted px-3.5 py-1.5 text-xs font-semibold text-foreground hover:bg-muted/50 transition-colors"
          >
            <ArrowLeft size={14} />
            <span>Back to Dashboard</span>
          </button>
        </header>

        <main className="mx-auto max-w-4xl space-y-8 p-6">
          <AccountRequestForm onSubmit={addRecord} />
        </main>
      </div>
    </TooltipProvider>
  );
}
