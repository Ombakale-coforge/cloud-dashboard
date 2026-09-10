import React, { Component, ErrorInfo, ReactNode } from "react";
import { AlertCircle, RefreshCw } from "lucide-react";

interface Props {
  children: ReactNode;
}

interface State {
  hasError: boolean;
  error: Error | null;
  errorInfo: ErrorInfo | null;
}

export class ErrorBoundary extends Component<Props, State> {
  public state: State = {
    hasError: false,
    error: null,
    errorInfo: null,
  };

  public static getDerivedStateFromError(error: Error): State {
    return { hasError: true, error, errorInfo: null };
  }

  public componentDidCatch(error: Error, errorInfo: ErrorInfo) {
    console.error("🔴 [React ErrorBoundary Caught Error]:", error, errorInfo);
    this.setState({ errorInfo });
  }

  private handleReset = () => {
    sessionStorage.clear();
    localStorage.clear();
    window.location.href = "/login";
  };

  public render() {
    if (this.state.hasError) {
      return (
        <div className="min-h-screen bg-slate-950 text-slate-100 flex flex-col justify-center items-center p-6 font-sans">
          <div className="max-w-lg w-full bg-slate-900 border border-slate-800 rounded-2xl p-8 shadow-2xl space-y-6 text-center">
            <div className="w-14 h-14 rounded-2xl bg-rose-500/10 border border-rose-500/30 flex items-center justify-center text-rose-400 mx-auto">
              <AlertCircle className="w-7 h-7" />
            </div>

            <div className="space-y-2">
              <h2 className="text-xl font-bold tracking-tight text-white">
                Application Runtime Error
              </h2>
              <p className="text-xs text-slate-400">
                An uncaught exception occurred while rendering the application component.
              </p>
            </div>

            {this.state.error && (
              <div className="p-4 bg-slate-950 rounded-xl border border-rose-500/20 text-left font-mono text-xs text-rose-300 overflow-x-auto max-h-40">
                <p className="font-bold mb-1">{this.state.error.name}: {this.state.error.message}</p>
                <p className="text-[10px] text-slate-400 whitespace-pre-wrap mt-2">
                  {this.state.error.stack}
                </p>
              </div>
            )}

            <button
              onClick={this.handleReset}
              className="inline-flex items-center gap-2 px-5 py-2.5 rounded-xl bg-indigo-600 hover:bg-indigo-500 text-white text-xs font-semibold shadow-lg shadow-indigo-600/30 transition-all cursor-pointer"
            >
              <RefreshCw className="w-4 h-4" />
              <span>Clear Session & Restart App</span>
            </button>
          </div>
        </div>
      );
    }

    return this.props.children;
  }
}
