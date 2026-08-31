import React, { useState } from "react";
import { useNavigate } from "react-router-dom";
import { useAuth, ADMIN_CREDENTIALS } from "@/lib/auth";
import {
  Shield,
  KeyRound,
  User,
  ArrowRight,
  Cloud,
  Lock,
  Mail,
  UserPlus,
  AlertCircle,
  Building,
  LogIn,
  CheckCircle2,
} from "lucide-react";

export function LoginPage() {
  const { loginAdmin, loginBasic, signupBasic } = useAuth();
  const navigate = useNavigate();

  // Mobile view panel switcher
  const [activePanel, setActivePanel] = useState<"admin" | "basic">("admin");

  // Admin form state
  const [adminEmail, setAdminEmail] = useState(ADMIN_CREDENTIALS.email);
  const [adminPassword, setAdminPassword] = useState("");
  const [adminError, setAdminError] = useState<string | null>(null);

  // Basic user mode: "signin" vs "signup"
  const [basicMode, setBasicMode] = useState<"signin" | "signup">("signin");
  const [basicEmail, setBasicEmail] = useState("");
  const [basicPassword, setBasicPassword] = useState("");
  const [basicName, setBasicName] = useState("");
  const [basicDepartment, setBasicDepartment] = useState("Digital Engineering");
  const [basicError, setBasicError] = useState<string | null>(null);
  const [basicSuccessMsg, setBasicSuccessMsg] = useState<string | null>(null);

  // Loading state
  const [loading, setLoading] = useState<string | null>(null);

  // 1. Handle Admin Login
  const handleAdminSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setAdminError(null);
    setLoading("admin");

    try {
      const res = await loginAdmin(adminPassword, adminEmail);
      if (res.success) {
        navigate("/");
      } else {
        setAdminError(res.error || "Authentication failed.");
      }
    } finally {
      setLoading(null);
    }
  };

  // 2. Handle Basic Login (Existing User)
  const handleBasicSignIn = async (e: React.FormEvent) => {
    e.preventDefault();
    setBasicError(null);
    setBasicSuccessMsg(null);
    setLoading("basic-signin");

    try {
      const res = await loginBasic(basicEmail, basicPassword);
      if (res.success) {
        if (res.user?.role === "admin") {
          navigate("/");
        } else {
          navigate("/newrequest");
        }
      } else {
        if (res.isNewUser) {
          setBasicMode("signup");
          setBasicSuccessMsg("No account found for this email. Switched to Sign Up so you can register!");
        } else {
          setBasicError(res.error || "Invalid login credentials.");
        }
      }
    } catch (err: any) {
      setBasicError(err.message || "An unexpected error occurred.");
    } finally {
      setLoading(null);
    }
  };

  // 3. Handle Basic Sign Up (1st-Time User)
  const handleBasicSignUp = async (e: React.FormEvent) => {
    e.preventDefault();
    setBasicError(null);
    setBasicSuccessMsg(null);
    setLoading("basic-signup");

    try {
      const res = await signupBasic(basicName, basicEmail, basicPassword, basicDepartment);
      if (res.success) {
        navigate("/newrequest");
      } else {
        setBasicError(res.error || "Sign up failed. Please try again.");
      }
    } catch (err: any) {
      setBasicError(err.message || "An unexpected error occurred.");
    } finally {
      setLoading(null);
    }
  };

  return (
    <div className="min-h-screen bg-gradient-to-br from-slate-950 via-slate-900 to-indigo-950 text-slate-100 flex flex-col justify-center items-center p-4 selection:bg-indigo-500 selection:text-white relative overflow-hidden">
      {/* Ambient background glow */}
      <div className="absolute -top-40 -left-40 w-96 h-96 bg-indigo-600/20 rounded-full blur-3xl pointer-events-none" />
      <div className="absolute top-1/2 -right-40 w-96 h-96 bg-purple-600/20 rounded-full blur-3xl pointer-events-none" />
      <div className="absolute -bottom-40 left-1/3 w-96 h-96 bg-blue-600/15 rounded-full blur-3xl pointer-events-none" />

      {/* Main Container */}
      <div className="relative z-10 w-full max-w-5xl mx-auto py-6">
        {/* Header */}
        <div className="flex items-center justify-center gap-3 mb-8 text-center">
          <div className="flex h-12 w-12 items-center justify-center rounded-2xl bg-gradient-to-tr from-indigo-600 to-violet-500 border border-indigo-400/30 shadow-lg shadow-indigo-500/20">
            <Cloud className="h-6 w-6 text-white" />
          </div>
          <div className="text-left">
            <h1 className="text-2xl font-bold tracking-tight text-white">Cloud Cost Intelligence</h1>
            <p className="text-xs text-slate-400">Enterprise Multi-Cloud Portal</p>
          </div>
        </div>

        {/* Mobile Panel Switcher */}
        <div className="lg:hidden flex items-center justify-center mb-6">
          <div className="inline-flex rounded-xl bg-slate-800/90 p-1 border border-slate-700">
            <button
              type="button"
              onClick={() => setActivePanel("admin")}
              className={`flex items-center gap-2 px-4 py-2 rounded-lg text-xs font-semibold transition-all ${
                activePanel === "admin"
                  ? "bg-indigo-600 text-white shadow-md"
                  : "text-slate-400 hover:text-white"
              }`}
            >
              <Shield className="w-4 h-4" />
              Admin Portal
            </button>
            <button
              type="button"
              onClick={() => setActivePanel("basic")}
              className={`flex items-center gap-2 px-4 py-2 rounded-lg text-xs font-semibold transition-all ${
                activePanel === "basic"
                  ? "bg-indigo-600 text-white shadow-md"
                  : "text-slate-400 hover:text-white"
              }`}
            >
              <User className="w-4 h-4" />
              Requester Portal
            </button>
          </div>
        </div>

        {/* Dual Panel Grid */}
        <div className="grid grid-cols-1 lg:grid-cols-2 gap-8 items-stretch w-full">
          
          {/* ════════════════════ PANEL 1: ADMIN LOGIN ════════════════════ */}
          <div
            className={`rounded-3xl border transition-all duration-300 flex-col justify-between p-7 sm:p-8 backdrop-blur-xl relative ${
              activePanel === "admin" ? "flex" : "hidden lg:flex"
            } bg-slate-900/80 border-indigo-500/40 shadow-2xl shadow-indigo-950/50 ring-1 ring-indigo-500/20`}
          >
            <div>
              <div className="flex items-center gap-3 mb-6">
                <div className="w-10 h-10 rounded-xl bg-indigo-500/10 border border-indigo-500/30 flex items-center justify-center text-indigo-400">
                  <KeyRound className="w-5 h-5" />
                </div>
                <div>
                  <h2 className="text-xl font-bold text-white">Admin Command Center</h2>
                  <p className="text-xs text-slate-400">Authorized personnel login</p>
                </div>
              </div>

              {/* Error Alert */}
              {adminError && (
                <div className="mb-5 p-3 rounded-xl bg-rose-500/15 border border-rose-500/30 text-rose-300 text-xs flex items-start gap-2.5">
                  <AlertCircle className="w-4 h-4 text-rose-400 shrink-0 mt-0.5" />
                  <span>{adminError}</span>
                </div>
              )}

              {/* Admin Form */}
              <form onSubmit={handleAdminSubmit} className="space-y-4">
                <div>
                  <label className="block text-[11px] font-medium text-slate-300 mb-1.5">
                    Admin Email
                  </label>
                  <div className="relative">
                    <Mail className="absolute left-3 top-3 w-4 h-4 text-slate-400" />
                    <input
                      type="email"
                      value={adminEmail}
                      onChange={(e) => setAdminEmail(e.target.value)}
                      required
                      placeholder="dashboard-admin@coforge.com"
                      className="w-full pl-9 pr-3 py-2.5 bg-slate-800/80 border border-slate-700 rounded-xl text-xs text-white placeholder-slate-500 focus:outline-none focus:ring-2 focus:ring-indigo-500"
                    />
                  </div>
                </div>

                <div>
                  <label className="block text-[11px] font-medium text-slate-300 mb-1.5">
                    Password
                  </label>
                  <div className="relative">
                    <Lock className="absolute left-3 top-3 w-4 h-4 text-slate-400" />
                    <input
                      type="password"
                      value={adminPassword}
                      onChange={(e) => setAdminPassword(e.target.value)}
                      required
                      placeholder="••••••••"
                      className="w-full pl-9 pr-3 py-2.5 bg-slate-800/80 border border-slate-700 rounded-xl text-xs text-white placeholder-slate-500 focus:outline-none focus:ring-2 focus:ring-indigo-500"
                    />
                  </div>
                </div>

                <button
                  type="submit"
                  disabled={loading !== null}
                  className="w-full flex items-center justify-center gap-2 py-3 px-4 rounded-xl bg-indigo-600 hover:bg-indigo-500 text-white text-xs font-semibold shadow-lg shadow-indigo-700/30 transition-all disabled:opacity-50 mt-4 cursor-pointer"
                >
                  <span>{loading === "admin" ? "Logging in..." : "Login"}</span>
                </button>
              </form>
            </div>
          </div>

          {/* ════════════════════ PANEL 2: REQUESTER / BASIC ACCESS ════════════════════ */}
          <div
            className={`rounded-3xl border transition-all duration-300 flex-col justify-between p-7 sm:p-8 backdrop-blur-xl relative ${
              activePanel === "basic" ? "flex" : "hidden lg:flex"
            } bg-slate-900/80 border-emerald-500/40 shadow-2xl shadow-emerald-950/40 ring-1 ring-emerald-500/20`}
          >
            <div>
              <div className="flex items-center gap-3 mb-5">
                <div className="w-10 h-10 rounded-xl bg-emerald-500/10 border border-emerald-500/30 flex items-center justify-center text-emerald-400">
                  <User className="w-5 h-5" />
                </div>
                <div>
                  <h2 className="text-xl font-bold text-white">Requester Workspace</h2>
                  <p className="text-xs text-slate-400">Submit and track account requests</p>
                </div>
              </div>

              {/* Sign In vs Sign Up Tab Header */}
              <div className="flex rounded-xl bg-slate-800/80 p-1 border border-slate-700/80 mb-5">
                <button
                  type="button"
                  onClick={() => {
                    setBasicMode("signin");
                    setBasicError(null);
                    setBasicSuccessMsg(null);
                  }}
                  className={`flex-1 flex items-center justify-center gap-1.5 py-1.5 text-xs font-semibold rounded-lg transition-all cursor-pointer ${
                    basicMode === "signin"
                      ? "bg-emerald-600 text-white shadow-sm"
                      : "text-slate-400 hover:text-white"
                  }`}
                >
                  <LogIn className="w-3.5 h-3.5" />
                  <span>Sign In</span>
                </button>

                <button
                  type="button"
                  onClick={() => {
                    setBasicMode("signup");
                    setBasicError(null);
                    setBasicSuccessMsg(null);
                  }}
                  className={`flex-1 flex items-center justify-center gap-1.5 py-1.5 text-xs font-semibold rounded-lg transition-all cursor-pointer ${
                    basicMode === "signup"
                      ? "bg-emerald-600 text-white shadow-sm"
                      : "text-slate-400 hover:text-white"
                  }`}
                >
                  <UserPlus className="w-3.5 h-3.5" />
                  <span>1st Time User (Sign Up)</span>
                </button>
              </div>

              {/* Alerts */}
              {basicError && (
                <div className="mb-4 p-3 rounded-xl bg-rose-500/15 border border-rose-500/30 text-rose-300 text-xs flex items-start gap-2.5">
                  <AlertCircle className="w-4 h-4 text-rose-400 shrink-0 mt-0.5" />
                  <div>
                    <span>{basicError}</span>
                    {basicError.includes("sign up") && basicMode === "signin" && (
                      <button
                        type="button"
                        onClick={() => {
                          setBasicMode("signup");
                          setBasicError(null);
                        }}
                        className="block mt-1 text-emerald-400 font-semibold underline hover:text-emerald-300 cursor-pointer"
                      >
                        Click here to Sign Up with this email
                      </button>
                    )}
                  </div>
                </div>
              )}

              {basicSuccessMsg && (
                <div className="mb-4 p-3 rounded-xl bg-emerald-500/15 border border-emerald-500/30 text-emerald-300 text-xs flex items-start gap-2.5">
                  <CheckCircle2 className="w-4 h-4 text-emerald-400 shrink-0 mt-0.5" />
                  <span>{basicSuccessMsg}</span>
                </div>
              )}

              {/* MODE 1: SIGN IN FORM */}
              {basicMode === "signin" ? (
                <form onSubmit={handleBasicSignIn} className="space-y-3.5">
                  <div>
                    <label className="block text-[11px] font-medium text-slate-300 mb-1">
                      Email Address
                    </label>
                    <div className="relative">
                      <Mail className="absolute left-3 top-2.5 w-4 h-4 text-slate-400" />
                      <input
                        type="email"
                        value={basicEmail}
                        onChange={(e) => setBasicEmail(e.target.value)}
                        required
                        placeholder="yourname@coforge.com"
                        className="w-full pl-9 pr-3 py-2 bg-slate-800/70 border border-slate-700 rounded-xl text-xs text-white placeholder-slate-500 focus:outline-none focus:ring-2 focus:ring-emerald-500"
                      />
                    </div>
                  </div>

                  <div>
                    <label className="block text-[11px] font-medium text-slate-300 mb-1">
                      Password
                    </label>
                    <div className="relative">
                      <Lock className="absolute left-3 top-2.5 w-4 h-4 text-slate-400" />
                      <input
                        type="password"
                        value={basicPassword}
                        onChange={(e) => setBasicPassword(e.target.value)}
                        required
                        placeholder="••••••••"
                        className="w-full pl-9 pr-3 py-2 bg-slate-800/70 border border-slate-700 rounded-xl text-xs text-white placeholder-slate-500 focus:outline-none focus:ring-2 focus:ring-emerald-500"
                      />
                    </div>
                  </div>

                  <button
                    type="submit"
                    disabled={loading !== null}
                    className="w-full flex items-center justify-center gap-2 py-2.5 px-4 rounded-xl bg-emerald-600 hover:bg-emerald-500 text-xs font-semibold text-white shadow-md transition-all disabled:opacity-50 mt-4 cursor-pointer"
                  >
                    <span>{loading === "basic-signin" ? "Signing In..." : "Sign In"}</span>
                  </button>
                </form>
              ) : (
                /* MODE 2: SIGN UP FORM (1ST TIME USER) */
                <form onSubmit={handleBasicSignUp} className="space-y-3">
                  <div>
                    <label className="block text-[11px] font-medium text-slate-300 mb-1">
                      Full Name
                    </label>
                    <div className="relative">
                      <User className="absolute left-3 top-2.5 w-4 h-4 text-slate-400" />
                      <input
                        type="text"
                        value={basicName}
                        onChange={(e) => setBasicName(e.target.value)}
                        placeholder="e.g. John Doe"
                        className="w-full pl-9 pr-3 py-2 bg-slate-800/70 border border-slate-700 rounded-xl text-xs text-white placeholder-slate-500 focus:outline-none focus:ring-2 focus:ring-emerald-500"
                      />
                    </div>
                  </div>

                  <div>
                    <label className="block text-[11px] font-medium text-slate-300 mb-1">
                      Work Email <span className="text-rose-400">*</span>
                    </label>
                    <div className="relative">
                      <Mail className="absolute left-3 top-2.5 w-4 h-4 text-slate-400" />
                      <input
                        type="email"
                        value={basicEmail}
                        onChange={(e) => setBasicEmail(e.target.value)}
                        required
                        placeholder="john.doe@coforge.com"
                        className="w-full pl-9 pr-3 py-2 bg-slate-800/70 border border-slate-700 rounded-xl text-xs text-white placeholder-slate-500 focus:outline-none focus:ring-2 focus:ring-emerald-500"
                      />
                    </div>
                  </div>

                  <div>
                    <label className="block text-[11px] font-medium text-slate-300 mb-1">
                      Create Password <span className="text-rose-400">*</span>
                    </label>
                    <div className="relative">
                      <Lock className="absolute left-3 top-2.5 w-4 h-4 text-slate-400" />
                      <input
                        type="password"
                        value={basicPassword}
                        onChange={(e) => setBasicPassword(e.target.value)}
                        required
                        placeholder="••••••••"
                        className="w-full pl-9 pr-3 py-2 bg-slate-800/70 border border-slate-700 rounded-xl text-xs text-white placeholder-slate-500 focus:outline-none focus:ring-2 focus:ring-emerald-500"
                      />
                    </div>
                  </div>

                  <div>
                    <label className="block text-[11px] font-medium text-slate-300 mb-1">
                      Department / Practice
                    </label>
                    <div className="relative">
                      <Building className="absolute left-3 top-2.5 w-4 h-4 text-slate-400" />
                      <input
                        type="text"
                        value={basicDepartment}
                        onChange={(e) => setBasicDepartment(e.target.value)}
                        placeholder="e.g. Cloud & Digital Engineering"
                        className="w-full pl-9 pr-3 py-2 bg-slate-800/70 border border-slate-700 rounded-xl text-xs text-white placeholder-slate-500 focus:outline-none focus:ring-2 focus:ring-emerald-500"
                      />
                    </div>
                  </div>

                  <button
                    type="submit"
                    disabled={loading !== null}
                    className="w-full flex items-center justify-center gap-2 py-2.5 px-4 rounded-xl bg-emerald-600 hover:bg-emerald-500 text-white text-xs font-semibold shadow-md transition-all disabled:opacity-50 mt-2 cursor-pointer"
                  >
                    <ArrowRight className="w-4 h-4" />
                    <span>{loading === "basic-signup" ? "Creating Account..." : "Sign Up"}</span>
                  </button>
                </form>
              )}
            </div>
          </div>

        </div>
      </div>
    </div>
  );
}
