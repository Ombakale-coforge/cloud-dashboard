import React, { useState, useEffect, useRef, useMemo } from "react";
import { useLocation } from "react-router-dom";
import {
  Sparkles,
  Send,
  X,
  Maximize2,
  Minimize2,
  RotateCcw,
  User,
  Copy,
  Check,
  ChevronDown,
  ChevronRight,
  BookOpen,
  MessageSquareText,
  FileText,
  ShieldCheck,
  DollarSign,
  LayoutDashboard,
  Wand2,
  ArrowUpRight,
} from "lucide-react";
import { useAuth } from "@/lib/auth";
import {
  getQuickPromptsForPath,
  getSmartFallbackReply,
} from "@/lib/chatbotKnowledge";

interface ChatTurn {
  id: string;
  role: "user" | "assistant";
  content: string;
  timestamp: string;
  provider?: "azure-openai" | "smart-knowledge-base";
}

function getPageLabel(pathname: string): string {
  if (pathname.startsWith("/newrequest")) return "AWS Account Request Form";
  if (pathname.startsWith("/azure/subscriptions")) return "Azure Subscriptions";
  if (pathname.startsWith("/azure")) return "Azure Cost Dashboard";
  if (pathname.startsWith("/gcp")) return "GCP Cost Dashboard";
  if (pathname.startsWith("/linked-accounts")) return "AWS Linked Accounts";
  if (pathname.startsWith("/inventory") || pathname.startsWith("/resources"))
    return "Resource Inventory";
  if (pathname.startsWith("/aws") || pathname.startsWith("/dashboard"))
    return "AWS Cost Dashboard";
  if (pathname.startsWith("/login")) return "Sign In Portal";
  return "Multi-Cloud Overview";
}

/* ─────────────── Kira Avatar Component ─────────────── */

function KiraAvatar({ size = "md" }: { size?: "sm" | "md" | "lg" }) {
  const dims =
    size === "lg"
      ? "h-10 w-10 rounded-2xl"
      : size === "sm"
      ? "h-7 w-7 rounded-xl"
      : "h-8 w-8 rounded-xl";

  const iconSize = size === "lg" ? 18 : size === "sm" ? 13 : 15;

  return (
    <div className="relative shrink-0">
      <div
        className={`${dims} flex items-center justify-center bg-gradient-to-br from-indigo-500 via-violet-500 to-fuchsia-500 text-white shadow-md shadow-indigo-500/25 border border-white/25`}
      >
        <Sparkles size={iconSize} className="text-white drop-shadow-xs" />
      </div>
      <span
        className={`absolute -bottom-0.5 -right-0.5 rounded-full border-2 border-white dark:border-slate-900 bg-emerald-400 ${
          size === "sm" ? "h-2 w-2" : "h-2.5 w-2.5"
        }`}
      />
    </div>
  );
}

/* ─────────────── Formatted Markdown Renderer ─────────────── */

function renderInlineFormatting(text: string): React.ReactNode[] {
  const parts = text.split(/(\*\*[^*]+\*\*|`[^`]+`)/g);
  return parts.map((part, idx) => {
    if (part.startsWith("**") && part.endsWith("**")) {
      return (
        <strong
          key={idx}
          className="font-semibold text-slate-900 dark:text-white"
        >
          {part.slice(2, -2)}
        </strong>
      );
    }
    if (part.startsWith("`") && part.endsWith("`")) {
      return (
        <code
          key={idx}
          className="rounded-md bg-indigo-500/10 dark:bg-indigo-400/15 border border-indigo-500/20 px-1.5 py-0.5 font-mono text-[11px] font-medium text-indigo-700 dark:text-indigo-300"
        >
          {part.slice(1, -1)}
        </code>
      );
    }
    return <React.Fragment key={idx}>{part}</React.Fragment>;
  });
}

function FormattedMessage({ content }: { content: string }) {
  const lines = content.split("\n");

  return (
    <div className="space-y-1.5 text-[12.5px] leading-relaxed">
      {lines.map((rawLine, idx) => {
        const line = rawLine.trim();
        if (!line) {
          return <div key={idx} className="h-1" />;
        }

        if (line.startsWith("### ")) {
          return (
            <h4
              key={idx}
              className="pt-1.5 pb-0.5 text-xs font-bold uppercase tracking-wider text-indigo-600 dark:text-indigo-400"
            >
              {renderInlineFormatting(line.slice(4))}
            </h4>
          );
        }

        if (line.startsWith("> ")) {
          return (
            <blockquote
              key={idx}
              className="my-1.5 border-l-3 border-violet-500 bg-gradient-to-r from-indigo-50/90 to-violet-50/50 dark:from-indigo-950/50 dark:to-violet-950/30 pl-3 py-2 pr-2.5 rounded-r-xl italic text-slate-700 dark:text-slate-200 text-xs shadow-2xs"
            >
              {renderInlineFormatting(line.slice(2))}
            </blockquote>
          );
        }

        if (line.startsWith("- ") || line.startsWith("• ")) {
          return (
            <div key={idx} className="flex items-start gap-2 pl-1">
              <span className="mt-2 h-1.5 w-1.5 shrink-0 rounded-full bg-gradient-to-r from-indigo-500 to-violet-500" />
              <span className="flex-1">
                {renderInlineFormatting(line.slice(2))}
              </span>
            </div>
          );
        }

        const numMatch = line.match(/^(\d+)\.\s+(.*)$/);
        if (numMatch) {
          return (
            <div key={idx} className="flex items-start gap-2.5 pl-0.5 py-0.5">
              <span className="flex h-5 w-5 shrink-0 items-center justify-center rounded-lg bg-gradient-to-br from-indigo-500/15 to-violet-500/15 border border-indigo-500/20 text-[10px] font-bold text-indigo-700 dark:text-indigo-300 mt-0.5">
                {numMatch[1]}
              </span>
              <span className="flex-1">
                {renderInlineFormatting(numMatch[2])}
              </span>
            </div>
          );
        }

        return <p key={idx}>{renderInlineFormatting(line)}</p>;
      })}
    </div>
  );
}

/* ─────────────── Built-in Interactive Guide Cards ─────────────── */

const CHEAT_SHEET_SECTIONS = [
  {
    id: "step1",
    title: "Step 1: Project & Department Info",
    subtitle: "Division, Environments, PoC & Justification",
    icon: FileText,
    accent: "from-blue-500 to-indigo-600",
    prompt: "Explain Step 1 Project & Department Information fields in detail",
    items: [
      {
        name: "Division / BU",
        desc: "Your Coforge Business Unit (e.g., BFS, Insurance, Digital Engineering, Cloud & Infra).",
      },
      {
        name: "Account Environments",
        desc: "Select DEV, UAT, PROD, PoC, or Sandbox badges depending on workload lifecycle.",
      },
      {
        name: "Point of Contact vs. Account Manager",
        desc: "PoC is the technical lead; Account Manager is the Delivery / Engagement Manager.",
      },
      {
        name: "Business Justification",
        desc: "2–3 lines explaining why a dedicated AWS account is needed and what workload it hosts.",
      },
    ],
  },
  {
    id: "step2",
    title: "Step 2: Config, Security & GDPR/PII",
    subtitle: "IAM Admins, External Access & Regulated Data",
    icon: ShieldCheck,
    accent: "from-violet-500 to-purple-600",
    prompt: "Explain Step 2 governance & GDPR/PII fields",
    items: [
      {
        name: "Admin User Emails (Max 5)",
        desc: "Coforge emails requiring initial AWS SSO Administrator permissions.",
      },
      {
        name: "Managed Only by Coforge?",
        desc: "Yes if strictly internal Coforge ops; No if client or 3rd-party engineers have access.",
      },
      {
        name: "External Audience Access",
        desc: "Yes if hosting public-facing web apps or APIs reachable from the internet.",
      },
      {
        name: "Customer & Confidential Data (PII/PCI/GDPR)",
        desc: "Flags whether client datasets or regulated personal/payment data are stored.",
      },
    ],
  },
  {
    id: "step3",
    title: "Step 3: Financials, WBS & Budgets",
    subtitle: "Monthly Spend, Chargeback, WBS & Cost Center",
    icon: DollarSign,
    accent: "from-emerald-500 to-teal-600",
    prompt: "What are WBS Code & Cost Center in Step 3?",
    items: [
      {
        name: "Estimated Monthly Cost (USD)",
        desc: "Projected monthly AWS bill in USD (e.g. $500, $2,500).",
      },
      {
        name: "Client Chargeback & FY'27 Budget",
        desc: "Whether costs are billed back to a client and planned in annual BU budget.",
      },
      {
        name: "WBS Code & Cost Center",
        desc: "Finance ERP project billing code (WBS) and department Cost Center (CC) for allocation.",
      },
      {
        name: "80% Budget Alert Emails",
        desc: "Recipients automatically notified when monthly spend reaches 80% of budget.",
      },
    ],
  },
  {
    id: "dashboards",
    title: "Portal Dashboards & Approval Workflow",
    subtitle: "AWS, Azure, GCP, Inventory & Request Tracking",
    icon: LayoutDashboard,
    accent: "from-amber-500 to-orange-600",
    prompt: "Give me a tour of this application and approval workflow",
    items: [
      {
        name: "Multi-Cloud Overview (/)",
        desc: "Unified executive KPIs across AWS, Azure, and GCP plus Admin Approval Command Center.",
      },
      {
        name: "Cloud Dashboards (/aws, /azure, /gcp)",
        desc: "6-month trends, MoM Delta, service breakdowns, daily anomalies, and regional spend.",
      },
      {
        name: "Approval Notification Flow",
        desc: "Requests trigger an automated Microsoft Graph email to FinOps leads for instant review.",
      },
    ],
  },
];

/* ─────────────── Main Kira Component ─────────────── */

export function AiChatWidget() {
  const location = useLocation();
  const { user, isAdmin } = useAuth();

  const [isOpen, setIsOpen] = useState(false);
  const [isExpanded, setIsExpanded] = useState(false);
  const [activeTab, setActiveTab] = useState<"chat" | "guide">("chat");
  const [expandedSection, setExpandedSection] = useState<string | null>("step1");
  const [showTeaser, setShowTeaser] = useState(true);
  const [input, setInput] = useState("");
  const [isLoading, setIsLoading] = useState(false);
  const [copiedId, setCopiedId] = useState<string | null>(null);
  const [aiStatus, setAiStatus] = useState<{
    configured: boolean;
    provider: string;
    label?: string;
    deployment: string | null;
  }>({
    configured: false,
    provider: "smart-knowledge-base",
    label: "AI Concierge",
    deployment: null,
  });

  const pageLabel = useMemo(
    () => getPageLabel(location.pathname),
    [location.pathname]
  );

  const quickPrompts = useMemo(
    () => getQuickPromptsForPath(location.pathname, isAdmin),
    [location.pathname, isAdmin]
  );

  const firstName = user?.name ? user.name.split(" ")[0] : "";

  const getWelcomeMessage = (): ChatTurn => ({
    id: "welcome-msg",
    role: "assistant",
    timestamp: new Date().toLocaleTimeString([], {
      hour: "2-digit",
      minute: "2-digit",
    }),
    content: location.pathname.startsWith("/newrequest")
      ? `Hi${firstName ? ` **${firstName}**` : ""}! I'm **Kira**, your Cloud & FinOps AI Concierge.\n\nI'm here to help you complete the **AWS Account Request Form** smoothly — ask me about **WBS Codes**, **Cost Centers**, **GDPR/PII governance**, or let me draft your **Business Justification**!`
      : `Hi${firstName ? ` **${firstName}**` : ""}! I'm **Kira**, your Cloud & FinOps AI Concierge.\n\nI can explain any chart or metric on this **${getPageLabel(
          location.pathname
        )}**, guide you through the **AWS Account Request Form (\`/newrequest\`)**, or clarify FinOps governance rules.`,
  });

  const [messages, setMessages] = useState<ChatTurn[]>(() => [
    getWelcomeMessage(),
  ]);

  const messagesEndRef = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    fetch("/api/chat/status")
      .then((r) => (r.ok ? r.json() : null))
      .then((data) => {
        if (data) setAiStatus(data);
      })
      .catch(() => {});
  }, [isOpen]);

  useEffect(() => {
    if (isOpen && activeTab === "chat") {
      messagesEndRef.current?.scrollIntoView({ behavior: "smooth" });
      setTimeout(() => inputRef.current?.focus(), 100);
    }
  }, [messages, isOpen, activeTab]);

  const sendMessage = async (textOverride?: string) => {
    const promptText = (textOverride ?? input).trim();
    if (!promptText || isLoading) return;

    if (activeTab !== "chat") {
      setActiveTab("chat");
    }

    const userTurn: ChatTurn = {
      id: `user-${Date.now()}`,
      role: "user",
      content: promptText,
      timestamp: new Date().toLocaleTimeString([], {
        hour: "2-digit",
        minute: "2-digit",
      }),
    };

    setMessages((prev) => [...prev, userTurn]);
    if (!textOverride) setInput("");
    setIsLoading(true);

    try {
      const historyPayload = messages
        .filter((m) => m.id !== "welcome-msg")
        .slice(-8)
        .map((m) => ({ role: m.role, content: m.content }));

      const res = await fetch("/api/chat", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          message: promptText,
          history: historyPayload,
          currentPath: location.pathname,
          userRole: isAdmin ? "admin" : "basic",
          userName: user?.name || "",
          userEmail: user?.email || "",
        }),
      });

      if (res.ok) {
        const data = await res.json();
        const botTurn: ChatTurn = {
          id: `bot-${Date.now()}`,
          role: "assistant",
          content:
            data.reply ||
            getSmartFallbackReply(
              promptText,
              location.pathname,
              isAdmin ? "admin" : "basic"
            ),
          timestamp: new Date().toLocaleTimeString([], {
            hour: "2-digit",
            minute: "2-digit",
          }),
          provider: data.provider,
        };
        setMessages((prev) => [...prev, botTurn]);
      } else {
        throw new Error("API non-200");
      }
    } catch {
      const fallback = getSmartFallbackReply(
        promptText,
        location.pathname,
        isAdmin ? "admin" : "basic"
      );
      setMessages((prev) => [
        ...prev,
        {
          id: `bot-${Date.now()}`,
          role: "assistant",
          content: fallback,
          timestamp: new Date().toLocaleTimeString([], {
            hour: "2-digit",
            minute: "2-digit",
          }),
          provider: "smart-knowledge-base",
        },
      ]);
    } finally {
      setIsLoading(false);
    }
  };

  const handleCopy = (id: string, text: string) => {
    navigator.clipboard.writeText(text.replace(/\*\*/g, "")).then(() => {
      setCopiedId(id);
      setTimeout(() => setCopiedId(null), 1800);
    });
  };

  const handleReset = () => {
    setMessages([getWelcomeMessage()]);
  };

  const quickActionCards = [
    {
      label: "3-Step Form Guide",
      desc: "All fields explained",
      icon: FileText,
      color: "text-indigo-600 dark:text-indigo-400 bg-indigo-500/10",
      prompt: "How do I fill the 3-step request form?",
    },
    {
      label: "Draft Justification",
      desc: "Ready-to-copy templates",
      icon: Wand2,
      color: "text-violet-600 dark:text-violet-400 bg-violet-500/10",
      prompt: "Help me draft a Business Justification",
    },
    {
      label: "WBS & Cost Center",
      desc: "Step 3 finance codes",
      icon: DollarSign,
      color: "text-emerald-600 dark:text-emerald-400 bg-emerald-500/10",
      prompt: "What are WBS Code & Cost Center in Step 3?",
    },
    {
      label: "App & KPIs Tour",
      desc: "Dashboards & workflows",
      icon: LayoutDashboard,
      color: "text-amber-600 dark:text-amber-400 bg-amber-500/10",
      prompt: "What is this app and how does it work?",
    },
  ];

  return (
    <div className="fixed bottom-5 right-5 z-[9999] font-sans">
      {/* ─────────────── Open Chat Window ─────────────── */}
      {isOpen && (
        <div
          className={`mb-3.5 flex flex-col overflow-hidden rounded-3xl border border-slate-200/80 dark:border-slate-800/90 bg-white/95 dark:bg-slate-900/95 shadow-[0_24px_60px_-15px_rgba(79,70,229,0.28)] backdrop-blur-2xl transition-all duration-200 ${
            isExpanded
              ? "w-[94vw] sm:w-[560px] h-[82vh] max-h-[760px]"
              : "w-[94vw] sm:w-[420px] h-[610px] max-h-[84vh]"
          }`}
        >
          {/* Premium Mesh Gradient Header */}
          <div className="relative overflow-hidden bg-slate-900 px-4 pt-3.5 pb-3 text-white">
            {/* Decorative ambient glow */}
            <div className="pointer-events-none absolute -top-12 -right-12 h-36 w-36 rounded-full bg-indigo-500/30 blur-2xl" />
            <div className="pointer-events-none absolute -bottom-10 -left-10 h-28 w-28 rounded-full bg-fuchsia-500/25 blur-2xl" />

            <div className="relative flex items-center justify-between">
              <div className="flex items-center gap-3">
                <KiraAvatar size="lg" />
                <div>
                  <div className="flex items-center gap-2">
                    <h3 className="text-base font-extrabold tracking-tight text-white">
                      Kira
                    </h3>
                    <span className="inline-flex items-center gap-1 rounded-full bg-indigo-500/25 border border-indigo-400/30 px-2 py-0.5 text-[10px] font-semibold text-indigo-200">
                      <Sparkles size={10} className="text-amber-300" />
                      {aiStatus.label || (aiStatus.configured ? "Azure OpenAI" : "AI Concierge")}
                    </span>
                  </div>
                  <p className="mt-0.5 text-[11px] text-slate-300 flex items-center gap-1.5">
                    <span>FinOps & Form Assistant</span>
                    <span className="text-slate-600">•</span>
                    <span className="text-indigo-300 font-medium truncate max-w-[155px]">
                      {pageLabel}
                    </span>
                  </p>
                </div>
              </div>

              <div className="flex items-center gap-1">
                <button
                  onClick={handleReset}
                  title="Reset conversation"
                  className="rounded-xl p-1.5 text-slate-300 hover:bg-white/10 hover:text-white transition-colors cursor-pointer"
                >
                  <RotateCcw size={14} />
                </button>
                <button
                  onClick={() => setIsExpanded((v) => !v)}
                  title={isExpanded ? "Compact view" : "Expand view"}
                  className="hidden sm:flex rounded-xl p-1.5 text-slate-300 hover:bg-white/10 hover:text-white transition-colors cursor-pointer"
                >
                  {isExpanded ? (
                    <Minimize2 size={14} />
                  ) : (
                    <Maximize2 size={14} />
                  )}
                </button>
                <button
                  onClick={() => setIsOpen(false)}
                  title="Close Kira"
                  className="rounded-xl p-1.5 text-slate-300 hover:bg-white/10 hover:text-white transition-colors cursor-pointer"
                >
                  <X size={16} />
                </button>
              </div>
            </div>

            {/* Mode Switcher Tabs: Chat vs Interactive Cheat Sheet */}
            <div className="relative mt-3 grid grid-cols-2 gap-1.5 rounded-xl bg-white/10 p-1 border border-white/10">
              <button
                type="button"
                onClick={() => setActiveTab("chat")}
                className={`flex items-center justify-center gap-1.5 rounded-lg py-1.5 text-xs font-semibold transition-all cursor-pointer ${
                  activeTab === "chat"
                    ? "bg-white text-slate-900 shadow-xs"
                    : "text-slate-300 hover:text-white"
                }`}
              >
                <MessageSquareText size={13} />
                <span>Chat with Kira</span>
              </button>
              <button
                type="button"
                onClick={() => setActiveTab("guide")}
                className={`flex items-center justify-center gap-1.5 rounded-lg py-1.5 text-xs font-semibold transition-all cursor-pointer ${
                  activeTab === "guide"
                    ? "bg-white text-slate-900 shadow-xs"
                    : "text-slate-300 hover:text-white"
                }`}
              >
                <BookOpen size={13} />
                <span>Form & App Guide</span>
              </button>
            </div>
          </div>

          {/* ─────────────── TAB 1: CHAT STREAM ─────────────── */}
          {activeTab === "chat" ? (
            <>
              <div className="flex-1 overflow-y-auto px-4 py-4 space-y-4 bg-gradient-to-b from-slate-50/90 to-white dark:from-slate-950/80 dark:to-slate-900">
                {/* Quick Topic Grid (Shown when conversation is fresh) */}
                {messages.length <= 2 && (
                  <div className="grid grid-cols-2 gap-2">
                    {quickActionCards.map((card) => {
                      const Icon = card.icon;
                      return (
                        <button
                          key={card.label}
                          type="button"
                          disabled={isLoading}
                          onClick={() => sendMessage(card.prompt)}
                          className="group flex items-start gap-2.5 rounded-2xl border border-slate-200/80 dark:border-slate-800 bg-white dark:bg-slate-900/90 p-2.5 text-left shadow-2xs hover:border-indigo-400 dark:hover:border-indigo-500/60 hover:shadow-md transition-all cursor-pointer"
                        >
                          <div
                            className={`flex h-8 w-8 shrink-0 items-center justify-center rounded-xl ${card.color}`}
                          >
                            <Icon size={15} />
                          </div>
                          <div className="min-w-0 flex-1">
                            <div className="flex items-center justify-between">
                              <p className="text-xs font-bold text-slate-800 dark:text-slate-100 truncate">
                                {card.label}
                              </p>
                              <ArrowUpRight
                                size={12}
                                className="text-slate-400 opacity-0 group-hover:opacity-100 group-hover:text-indigo-500 transition-opacity shrink-0"
                              />
                            </div>
                            <p className="text-[10px] text-slate-500 dark:text-slate-400 truncate">
                              {card.desc}
                            </p>
                          </div>
                        </button>
                      );
                    })}
                  </div>
                )}

                {/* Conversation Turns */}
                {messages.map((msg) => {
                  const isUser = msg.role === "user";
                  return (
                    <div
                      key={msg.id}
                      className={`flex items-start gap-2.5 ${
                        isUser ? "flex-row-reverse" : "flex-row"
                      }`}
                    >
                      {/* Avatar */}
                      {isUser ? (
                        <div className="flex h-7 w-7 shrink-0 items-center justify-center rounded-xl bg-slate-900 dark:bg-indigo-600 text-white shadow-xs">
                          <User size={13} />
                        </div>
                      ) : (
                        <KiraAvatar size="sm" />
                      )}

                      {/* Bubble */}
                      <div
                        className={`group relative max-w-[84%] rounded-2xl px-3.5 py-2.5 ${
                          isUser
                            ? "bg-gradient-to-br from-indigo-600 to-violet-600 text-white rounded-tr-xs shadow-sm shadow-indigo-500/15"
                            : "bg-white dark:bg-slate-900 border border-slate-200/90 dark:border-slate-800 text-slate-700 dark:text-slate-200 rounded-tl-xs shadow-xs"
                        }`}
                      >
                        {!isUser && (
                          <div className="mb-1 flex items-center justify-between">
                            <span className="text-[10px] font-bold uppercase tracking-wider text-indigo-600 dark:text-indigo-400">
                              Kira
                            </span>
                            <button
                              onClick={() => handleCopy(msg.id, msg.content)}
                              className="opacity-0 group-hover:opacity-100 flex items-center gap-1 rounded-md px-1.5 py-0.5 text-[10px] text-slate-400 hover:bg-slate-100 dark:hover:bg-slate-800 hover:text-indigo-600 dark:hover:text-indigo-400 transition-all cursor-pointer"
                              title="Copy response"
                            >
                              {copiedId === msg.id ? (
                                <>
                                  <Check
                                    size={11}
                                    className="text-emerald-500"
                                  />
                                  <span className="text-emerald-500 font-medium">
                                    Copied
                                  </span>
                                </>
                              ) : (
                                <>
                                  <Copy size={11} />
                                  <span>Copy</span>
                                </>
                              )}
                            </button>
                          </div>
                        )}

                        {isUser ? (
                          <p className="text-[12.5px] leading-relaxed whitespace-pre-wrap">
                            {msg.content}
                          </p>
                        ) : (
                          <FormattedMessage content={msg.content} />
                        )}

                        <div
                          className={`mt-1.5 flex items-center justify-end text-[10px] ${
                            isUser
                              ? "text-indigo-200"
                              : "text-slate-400 dark:text-slate-500"
                          }`}
                        >
                          <span>{msg.timestamp}</span>
                        </div>
                      </div>
                    </div>
                  );
                })}

                {isLoading && (
                  <div className="flex items-start gap-2.5">
                    <KiraAvatar size="sm" />
                    <div className="rounded-2xl rounded-tl-xs border border-slate-200/80 dark:border-slate-800 bg-white dark:bg-slate-900 px-4 py-3 shadow-xs">
                      <div className="flex items-center gap-1.5">
                        <span className="h-1.5 w-1.5 rounded-full bg-indigo-500 animate-bounce" />
                        <span className="h-1.5 w-1.5 rounded-full bg-violet-500 animate-bounce [animation-delay:150ms]" />
                        <span className="h-1.5 w-1.5 rounded-full bg-fuchsia-500 animate-bounce [animation-delay:300ms]" />
                        <span className="ml-1.5 text-[11px] font-medium text-slate-500 dark:text-slate-400">
                          Kira is typing...
                        </span>
                      </div>
                    </div>
                  </div>
                )}

                <div ref={messagesEndRef} />
              </div>

              {/* Dynamic Suggested Chips */}
              <div className="border-t border-slate-200/70 dark:border-slate-800/80 bg-slate-50/90 dark:bg-slate-900/90 px-3 py-2">
                <div className="flex gap-1.5 overflow-x-auto pb-0.5 no-scrollbar">
                  {quickPrompts.map((prompt) => (
                    <button
                      key={prompt}
                      type="button"
                      disabled={isLoading}
                      onClick={() => sendMessage(prompt)}
                      className="shrink-0 rounded-full border border-slate-200 dark:border-slate-700/80 bg-white dark:bg-slate-800 px-3 py-1 text-[11px] font-medium text-slate-700 dark:text-slate-200 hover:border-indigo-400 hover:text-indigo-600 dark:hover:text-indigo-300 transition-colors cursor-pointer disabled:opacity-50 shadow-2xs"
                    >
                      {prompt}
                    </button>
                  ))}
                </div>
              </div>

              {/* Input Composer */}
              <form
                onSubmit={(e) => {
                  e.preventDefault();
                  sendMessage();
                }}
                className="border-t border-slate-200/80 dark:border-slate-800 bg-white dark:bg-slate-900 p-3"
              >
                <div className="flex items-center gap-2 rounded-2xl border border-slate-200 dark:border-slate-700/80 bg-slate-50/80 dark:bg-slate-800/60 pl-3.5 pr-1.5 py-1.5 focus-within:border-indigo-500 focus-within:bg-white dark:focus-within:bg-slate-800 focus-within:ring-3 focus-within:ring-indigo-500/15 transition-all">
                  <input
                    ref={inputRef}
                    type="text"
                    value={input}
                    onChange={(e) => setInput(e.target.value)}
                    placeholder="Ask Kira about form fields, WBS code, dashboards..."
                    disabled={isLoading}
                    className="flex-1 bg-transparent text-xs text-slate-900 dark:text-slate-100 placeholder:text-slate-400 focus:outline-none disabled:opacity-50"
                  />
                  <button
                    type="submit"
                    disabled={!input.trim() || isLoading}
                    className="flex h-8 w-8 shrink-0 items-center justify-center rounded-xl bg-gradient-to-r from-indigo-600 to-violet-600 text-white shadow-sm hover:opacity-95 transition-all disabled:opacity-35 cursor-pointer"
                    title="Send to Kira"
                  >
                    <Send size={13} />
                  </button>
                </div>
              </form>
            </>
          ) : (
            /* ─────────────── TAB 2: INTERACTIVE FORM & APP CHEAT SHEET ─────────────── */
            <div className="flex-1 overflow-y-auto p-4 space-y-3 bg-slate-50/70 dark:bg-slate-950/60">
              <div className="rounded-2xl bg-gradient-to-r from-indigo-500/10 via-violet-500/10 to-fuchsia-500/10 border border-indigo-500/20 p-3">
                <p className="text-xs font-bold text-indigo-950 dark:text-indigo-200">
                  Interactive Portal & Form Reference
                </p>
                <p className="mt-0.5 text-[11px] text-slate-600 dark:text-slate-400">
                  Click any section below to inspect field definitions, or ask
                  Kira to explain further.
                </p>
              </div>

              {CHEAT_SHEET_SECTIONS.map((sec) => {
                const Icon = sec.icon;
                const isSecOpen = expandedSection === sec.id;
                return (
                  <div
                    key={sec.id}
                    className="overflow-hidden rounded-2xl border border-slate-200/90 dark:border-slate-800 bg-white dark:bg-slate-900 shadow-2xs"
                  >
                    <button
                      type="button"
                      onClick={() =>
                        setExpandedSection(isSecOpen ? null : sec.id)
                      }
                      className="flex w-full items-center justify-between p-3.5 text-left hover:bg-slate-50/80 dark:hover:bg-slate-800/50 transition-colors cursor-pointer"
                    >
                      <div className="flex items-center gap-3">
                        <div
                          className={`flex h-9 w-9 shrink-0 items-center justify-center rounded-xl bg-gradient-to-br ${sec.accent} text-white shadow-xs`}
                        >
                          <Icon size={16} />
                        </div>
                        <div>
                          <h4 className="text-xs font-bold text-slate-900 dark:text-white">
                            {sec.title}
                          </h4>
                          <p className="text-[11px] text-slate-500 dark:text-slate-400">
                            {sec.subtitle}
                          </p>
                        </div>
                      </div>
                      <ChevronRight
                        size={16}
                        className={`text-slate-400 transition-transform duration-200 ${
                          isSecOpen ? "rotate-90 text-indigo-500" : ""
                        }`}
                      />
                    </button>

                    {isSecOpen && (
                      <div className="border-t border-slate-100 dark:border-slate-800 px-3.5 py-3 space-y-2.5 bg-slate-50/50 dark:bg-slate-950/30">
                        {sec.items.map((item) => (
                          <div
                            key={item.name}
                            className="rounded-xl bg-white dark:bg-slate-900 p-2.5 border border-slate-200/60 dark:border-slate-800/80"
                          >
                            <p className="text-xs font-bold text-slate-800 dark:text-slate-100">
                              {item.name}
                            </p>
                            <p className="mt-0.5 text-[11px] text-slate-600 dark:text-slate-400 leading-relaxed">
                              {item.desc}
                            </p>
                          </div>
                        ))}
                        <button
                          type="button"
                          onClick={() => sendMessage(sec.prompt)}
                          className="w-full flex items-center justify-center gap-1.5 rounded-xl bg-indigo-600/10 hover:bg-indigo-600/15 dark:bg-indigo-500/15 dark:hover:bg-indigo-500/25 py-2 text-xs font-semibold text-indigo-700 dark:text-indigo-300 transition-colors cursor-pointer"
                        >
                          <Sparkles size={13} />
                          <span>Ask Kira more about {sec.title.split(":")[0]}</span>
                        </button>
                      </div>
                    )}
                  </div>
                );
              })}
            </div>
          )}
        </div>
      )}

      {/* ─────────────── Floating Teaser Callout (When Closed) ─────────────── */}
      {!isOpen && showTeaser && (
        <div className="mb-2.5 flex items-center gap-2.5 rounded-2xl border border-indigo-200/80 dark:border-indigo-900/60 bg-white/95 dark:bg-slate-900/95 px-3.5 py-2.5 shadow-xl backdrop-blur-md max-w-[280px] animate-in fade-in slide-in-from-bottom-2">
          <KiraAvatar size="sm" />
          <div
            onClick={() => setIsOpen(true)}
            className="flex-1 cursor-pointer text-left"
          >
            <p className="text-xs font-bold text-slate-900 dark:text-white">
              Hi, I'm Kira! 👋
            </p>
            <p className="text-[11px] text-slate-500 dark:text-slate-400 leading-tight">
              {location.pathname.startsWith("/newrequest")
                ? "Need help with form fields or WBS codes?"
                : "Need a quick tour of the app or forms?"}
            </p>
          </div>
          <button
            onClick={(e) => {
              e.stopPropagation();
              setShowTeaser(false);
            }}
            className="rounded-lg p-1 text-slate-400 hover:bg-slate-100 dark:hover:bg-slate-800 hover:text-slate-600 transition-colors cursor-pointer"
            title="Dismiss"
          >
            <X size={13} />
          </button>
        </div>
      )}

      {/* ─────────────── Floating Launcher Button ─────────────── */}
      <div className="flex justify-end">
        <button
          onClick={() => {
            setIsOpen((prev) => !prev);
            setShowTeaser(false);
          }}
          className="group relative flex items-center gap-3 rounded-full bg-slate-900 dark:bg-indigo-950 p-1.5 pr-4 text-white shadow-[0_12px_30px_-6px_rgba(79,70,229,0.45)] hover:shadow-[0_16px_36px_-6px_rgba(79,70,229,0.6)] hover:scale-[1.02] active:scale-[0.98] transition-all cursor-pointer border border-indigo-500/30"
        >
          <KiraAvatar size="md" />
          <div className="text-left">
            <div className="flex items-center gap-1.5">
              <span className="text-xs font-extrabold tracking-tight text-white">
                {isOpen ? "Minimize Kira" : "Ask Kira"}
              </span>
              {!isOpen && (
                <span className="rounded-full bg-gradient-to-r from-indigo-500 to-violet-500 px-1.5 py-0.2 text-[9px] font-bold uppercase tracking-wider text-white">
                  AI
                </span>
              )}
            </div>
            <p className="text-[10px] text-slate-300 leading-none mt-0.5">
              {isOpen ? "Close window" : "Forms & Portal Guide"}
            </p>
          </div>
          {isOpen && (
            <ChevronDown size={15} className="ml-1 text-slate-300" />
          )}
        </button>
      </div>
    </div>
  );
}
