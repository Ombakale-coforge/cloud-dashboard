import React, { useState } from "react";
import { useNavigate } from "react-router-dom";
import { useAuth } from "@/lib/auth";
import {
  ShieldCheck,
  ArrowRight,
  Cloud,
  AlertCircle,
  Lock,
  Building2,
} from "lucide-react";

export function LoginPage() {
  const { user, isAuthenticated, loginWithAzure, setAuthenticatedUser } = useAuth();
  const navigate = useNavigate();
  const [ssoError, setSsoError] = useState<string | null>(null);
  const [redirecting, setRedirecting] = useState(false);

  // If already logged in, redirect directly to appropriate portal
  React.useEffect(() => {
    if (isAuthenticated && user) {
      navigate(user.role === "basic" ? "/newrequest" : "/", { replace: true });
    }
  }, [isAuthenticated, user, navigate]);

  // Check for Azure SSO callback query parameters (?sso_user=... or ?sso_error=...)
  React.useEffect(() => {
    const params = new URLSearchParams(window.location.search);
    const ssoUserParam = params.get("sso_user");
    const ssoErrorParam = params.get("sso_error");

    if (ssoErrorParam) {
      const decodedError = decodeURIComponent(ssoErrorParam);
      setSsoError(`Microsoft SSO Error: ${decodedError}`);
      window.history.replaceState({}, document.title, window.location.pathname);
    } else if (ssoUserParam) {
      try {
        const ssoUser = JSON.parse(decodeURIComponent(ssoUserParam));
        setAuthenticatedUser(ssoUser);
        window.history.replaceState({}, document.title, window.location.pathname);
        navigate(ssoUser.role === "admin" ? "/" : "/newrequest", { replace: true });
      } catch (err) {
        console.error("Failed to parse SSO user payload:", err);
        setSsoError("Failed to complete Single Sign-On session.");
      }
    }
  }, [setAuthenticatedUser, navigate]);

  const handleSsoSignIn = () => {
    setSsoError(null);
    setRedirecting(true);
    loginWithAzure();
  };

  return (
    <div className="min-h-screen bg-gradient-to-br from-slate-950 via-slate-900 to-indigo-950 text-slate-100 flex flex-col justify-center items-center p-4 selection:bg-indigo-500 selection:text-white relative overflow-hidden">
      {/* Ambient background glow */}
      <div className="absolute -top-40 -left-40 w-96 h-96 bg-indigo-600/20 rounded-full blur-3xl pointer-events-none" />
      <div className="absolute top-1/2 -right-40 w-96 h-96 bg-purple-600/20 rounded-full blur-3xl pointer-events-none" />
      <div className="absolute -bottom-40 left-1/3 w-96 h-96 bg-blue-600/15 rounded-full blur-3xl pointer-events-none" />

      {/* Main Container */}
      <div className="relative z-10 w-full max-w-md mx-auto py-8">
        {/* Brand Header */}
        <div className="flex flex-col items-center text-center mb-8">
          <div className="flex h-14 w-14 items-center justify-center rounded-2xl bg-gradient-to-tr from-indigo-600 to-violet-500 border border-indigo-400/30 shadow-lg shadow-indigo-500/25 mb-4">
            <Cloud className="h-7 w-7 text-white" />
          </div>
          <h1 className="text-2xl font-bold tracking-tight text-white">
            Cloud Cost Intelligence
          </h1>
          <p className="text-xs text-slate-400 mt-1">
            Enterprise Multi-Cloud Governance &amp; FinOps Portal
          </p>
        </div>

        {/* SSO Login Card */}
        <div className="rounded-3xl border border-indigo-500/30 bg-slate-900/85 p-7 sm:p-8 shadow-2xl shadow-indigo-950/50 backdrop-blur-xl ring-1 ring-indigo-500/20">
          <div className="flex items-center gap-3.5 mb-6">
            <div className="w-12 h-12 rounded-2xl bg-slate-800/90 border border-slate-700/80 flex items-center justify-center shrink-0 shadow-inner">
              <svg className="w-6 h-6" viewBox="0 0 21 21">
                <rect x="1" y="1" width="9" height="9" fill="#f25022" />
                <rect x="11" y="1" width="9" height="9" fill="#7fba00" />
                <rect x="1" y="11" width="9" height="9" fill="#00a4ef" />
                <rect x="11" y="11" width="9" height="9" fill="#ffb900" />
              </svg>
            </div>
            <div>
              <div className="flex items-center gap-2">
                <h2 className="text-lg font-bold text-white">Coforge Single Sign-On</h2>
              </div>
              <p className="text-xs text-slate-400 mt-0.5">
                Authenticate with your Microsoft Entra ID account
              </p>
            </div>
          </div>

          {/* SSO Error Alert */}
          {ssoError && (
            <div className="mb-5 p-3.5 rounded-xl bg-rose-500/15 border border-rose-500/30 text-rose-300 text-xs flex items-start gap-2.5">
              <AlertCircle className="w-4 h-4 text-rose-400 shrink-0 mt-0.5" />
              <span>{ssoError}</span>
            </div>
          )}

          {/* Primary SSO Button */}
          <button
            type="button"
            onClick={handleSsoSignIn}
            disabled={redirecting}
            className="w-full flex items-center justify-center gap-3 py-3.5 px-5 rounded-xl bg-gradient-to-r from-indigo-600 to-violet-600 hover:from-indigo-500 hover:to-violet-500 text-white text-sm font-bold shadow-lg shadow-indigo-600/30 transition-all hover:scale-[1.01] active:scale-[0.99] disabled:opacity-60 cursor-pointer"
          >
            <svg className="w-4 h-4 shrink-0" viewBox="0 0 21 21">
              <rect x="1" y="1" width="9" height="9" fill="#f25022" />
              <rect x="11" y="1" width="9" height="9" fill="#7fba00" />
              <rect x="1" y="11" width="9" height="9" fill="#00a4ef" />
              <rect x="11" y="11" width="9" height="9" fill="#ffb900" />
            </svg>
            <span>{redirecting ? "Redirecting to Microsoft..." : "Sign in with Microsoft"}</span>
            <ArrowRight className="w-4 h-4" />
          </button>

          {/* Role Routing Info */}
          <div className="mt-6 pt-5 border-t border-slate-800/80 space-y-2.5 text-xs text-slate-400">
            <div className="flex items-start gap-2.5">
              <ShieldCheck className="w-4 h-4 text-indigo-400 shrink-0 mt-0.5" />
              <span>
                <strong className="text-slate-200">Automatic Role Detection:</strong>{" "}
                Authorized administrators are directed to the FinOps Command Center; requesters are directed to the Account Request Portal.
              </span>
            </div>
            <div className="flex items-start gap-2.5">
              <Building2 className="w-4 h-4 text-indigo-400 shrink-0 mt-0.5" />
              <span>
                <strong className="text-slate-200">Verified Identity:</strong>{" "}
                All account requests and audit trails are automatically linked to your corporate `@coforge.com` profile.
              </span>
            </div>
          </div>
        </div>

        {/* Footer Security Badge */}
        <div className="mt-6 flex items-center justify-center gap-1.5 text-[11px] text-slate-500">
          <Lock className="w-3.5 h-3.5 text-slate-500" />
          <span>Protected by Microsoft Entra ID (Azure AD) OAuth 2.0</span>
        </div>
      </div>
    </div>
  );
}

