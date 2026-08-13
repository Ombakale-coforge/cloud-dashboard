import { useState } from "react";
import {
  CheckCircle2,
  ChevronRight,
  ChevronLeft,
  Plus,
  X,
  Building2,
  Settings,
  DollarSign,
  Loader2,
  Mail,
  Send,
  Sparkles,
  Check,
  User,
} from "lucide-react";
import { Card, CardContent } from "@/components/ui/card";
import type { AccountRequest } from "@/lib/useAccountRequests";

/* ─────────────── helpers ─────────────── */

const ENV_SUGGESTIONS = ["DEV", "UAT", "PROD", "PoC", "Sandbox"];

function TagInput({
  value,
  onChange,
  placeholder,
  max,
}: {
  value: string[];
  onChange: (v: string[]) => void;
  placeholder?: string;
  max?: number;
}) {
  const [input, setInput] = useState("");

  const add = () => {
    const trimmed = input.trim();
    if (!trimmed || (max !== undefined && value.length >= max)) return;
    if (!value.includes(trimmed)) onChange([...value, trimmed]);
    setInput("");
  };

  return (
    <div className="flex flex-col gap-2">
      <div className="flex gap-2">
        <input
          type="text"
          value={input}
          onChange={(e) => setInput(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === "Enter" || e.key === ",") {
              e.preventDefault();
              add();
            }
          }}
          placeholder={placeholder ?? "Type email and press Enter"}
          disabled={max !== undefined && value.length >= max}
          className="flex-1 bg-background px-3 py-2 text-sm rounded-lg border border-input focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-indigo-500/50 disabled:opacity-50"
        />
        <button
          type="button"
          onClick={add}
          disabled={max !== undefined && value.length >= max}
          className="flex items-center gap-1 px-3 py-2 rounded-lg bg-indigo-600 text-white text-xs font-semibold hover:bg-indigo-700 transition-colors disabled:opacity-50"
        >
          <Plus size={13} /> Add
        </button>
      </div>
      {value.length > 0 && (
        <div className="flex flex-wrap gap-1.5">
          {value.map((v) => (
            <span
              key={v}
              className="flex items-center gap-1 rounded-full bg-indigo-50 dark:bg-indigo-900/30 text-indigo-700 dark:text-indigo-300 border border-indigo-200 dark:border-indigo-700 px-2.5 py-0.5 text-xs font-medium"
            >
              {v}
              <button
                type="button"
                onClick={() => onChange(value.filter((x) => x !== v))}
                className="ml-0.5 hover:text-red-500 transition-colors"
              >
                <X size={11} />
              </button>
            </span>
          ))}
        </div>
      )}
      {max !== undefined && (
        <p className="text-xs text-muted-foreground">
          {value.length}/{max} added
        </p>
      )}
    </div>
  );
}

function RadioGroup({
  name,
  value,
  onChange,
  options = ["Yes", "No"],
}: {
  name: string;
  value: string;
  onChange: (v: string) => void;
  options?: string[];
}) {
  return (
    <div className="flex gap-3 flex-wrap">
      {options.map((opt) => (
        <label
          key={opt}
          className={`flex items-center gap-2 cursor-pointer rounded-lg border px-4 py-2 text-sm font-medium transition-all ${
            value === opt
              ? "border-indigo-500 bg-indigo-50 dark:bg-indigo-900/30 text-indigo-700 dark:text-indigo-300"
              : "border-muted bg-muted/30 hover:bg-muted/60 text-foreground"
          }`}
        >
          <input
            type="radio"
            name={name}
            value={opt}
            checked={value === opt}
            onChange={() => onChange(opt)}
            className="sr-only"
          />
          <span
            className={`h-3.5 w-3.5 rounded-full border-2 flex items-center justify-center ${
              value === opt
                ? "border-indigo-500"
                : "border-muted-foreground/40"
            }`}
          >
            {value === opt && (
              <span className="h-1.5 w-1.5 rounded-full bg-indigo-500" />
            )}
          </span>
          {opt}
        </label>
      ))}
    </div>
  );
}

function Field({
  label,
  required,
  hint,
  children,
  error,
}: {
  label: string;
  required?: boolean;
  hint?: string;
  children: React.ReactNode;
  error?: string;
}) {
  return (
    <div className="flex flex-col gap-1.5">
      <label className="text-sm font-semibold text-foreground">
        {label}
        {required && <span className="text-red-500 ml-0.5">*</span>}
      </label>
      {children}
      {hint && <p className="text-xs text-muted-foreground">{hint}</p>}
      {error && <p className="text-xs text-red-500 font-medium">{error}</p>}
    </div>
  );
}

/* ─────────────── empty state ─────────────── */

type FormData = Omit<AccountRequest, "id" | "submittedAt">;

const emptyForm = (): FormData => ({
  submitterEmail: "",
  division: "",
  projectName: "",
  accountEnvironment: "",
  businessJustification: "",
  pointOfContact: "",
  accountManager: "",
  adminEmails: [],
  managedByCoforge: "",
  externalAudienceAccess: "",
  storesCustomerData: "",
  customerDataDetails: "",
  storesConfidentialData: "",
  estimatedMonthlyCost: "",
  costChargedBack: "",
  foreseenInBudget: "",
  wbsCode: "",
  costCenter: "",
  awsPartnershipRelated: "",
  budgetAlertEmails: [],
  buFinanceController: "",
});

/* ─────────────── step config ─────────────── */

const STEPS = [
  { label: "Project Info", icon: Building2 },
  { label: "Account Config", icon: Settings },
  { label: "Financials", icon: DollarSign },
];

/* ─────────────── validation ─────────────── */

type Errors = Partial<Record<keyof FormData, string>>;

function validateStep(step: number, data: FormData): Errors {
  const errs: Errors = {};
  if (step === 0) {
    if (!data.submitterEmail.trim()) errs.submitterEmail = "Your email is required";
    else if (!/\S+@\S+\.\S+/.test(data.submitterEmail))
      errs.submitterEmail = "Invalid email address";
    if (!data.division.trim()) errs.division = "Required";
    if (!data.projectName.trim()) errs.projectName = "Required";
    if (!data.accountEnvironment.trim())
      errs.accountEnvironment = "Please enter environment(s)";
    if (!data.pointOfContact.trim()) errs.pointOfContact = "Required";
    else if (!/\S+@\S+\.\S+/.test(data.pointOfContact))
      errs.pointOfContact = "Invalid email";
    if (!data.accountManager.trim()) errs.accountManager = "Required";
    else if (!/\S+@\S+\.\S+/.test(data.accountManager))
      errs.accountManager = "Invalid email";
  }
  if (step === 1) {
    if (data.adminEmails.length === 0)
      errs.adminEmails = "At least one admin email is required";
    if (!data.managedByCoforge) errs.managedByCoforge = "Required";
    if (!data.externalAudienceAccess) errs.externalAudienceAccess = "Required";
    if (!data.storesCustomerData) errs.storesCustomerData = "Required";
    if (data.storesCustomerData === "Yes" && !data.customerDataDetails?.trim())
      errs.customerDataDetails = "Please specify which customer";
    if (!data.storesConfidentialData) errs.storesConfidentialData = "Required";
  }
  if (step === 2) {
    if (!data.estimatedMonthlyCost.trim())
      errs.estimatedMonthlyCost = "Required";
    if (!data.costChargedBack) errs.costChargedBack = "Required";
    if (!data.foreseenInBudget) errs.foreseenInBudget = "Required";
    if (!data.awsPartnershipRelated) errs.awsPartnershipRelated = "Required";
  }
  return errs;
}

/* ─────────────── direct email dispatch helper ─────────────── */

async function sendEmailDirectly(data: FormData) {
  const { recipient, sender, subject, body } = buildEmailContent(data);

  // Primary: open the user's email client (mailto:) with everything
  // pre-filled, so the mail is actually delivered from their own account.
  sendViaMailto(data);
  // Bonus: also fire the Formspree web dispatch (best-effort).
  await tryFormspree(data);

  return { recipient, sender, subject, body };
}

function sendViaMailto(data: FormData) {
  const { recipient, subject, body } = buildEmailContent(data);
  const mailtoLink = `mailto:${recipient}?subject=${encodeURIComponent(
    subject
  )}&body=${encodeURIComponent(body)}`;
  window.location.href = mailtoLink;
}

async function tryFormspree(data: FormData): Promise<boolean> {
  const { subject, body, sender } = buildEmailContent(data);
  try {
    const res = await fetch("https://formspree.io/f/xvovbklp", {
      method: "POST",
      headers: { "Content-Type": "application/json", Accept: "application/json" },
      body: JSON.stringify({
        email: sender,
        subject: subject,
        message: body,
        _replyto: sender,
      }),
    });
    return res.ok;
  } catch {
    return false;
  }
}

function buildEmailContent(data: FormData) {
  const sender = data.submitterEmail.trim();
  const recipient = "Ankit.A@coforge.com";
  const subject = `AWS Account Request: ${data.projectName} (${data.division})`;

  const formattedBody = `Dear Om,

Please find the AWS Account Provisioning Request details submitted by ${sender}:

---------------------------------------------------------------
1. PROJECT & DEPARTMENT INFORMATION
---------------------------------------------------------------
Submitter / Sender Email: ${sender}
Division / BU: ${data.division}
Project / Department Name: ${data.projectName}
Account Environment(s): ${data.accountEnvironment}
Point of Contact (Email): ${data.pointOfContact}
Account Manager (Email): ${data.accountManager}
Business Justification: ${data.businessJustification?.trim() || "N/A"}

---------------------------------------------------------------
2. ACCOUNT CONFIGURATION & GOVERNANCE
---------------------------------------------------------------
Admin User IDs / Emails: ${data.adminEmails.join(", ")}
Managed Only by Coforge Team?: ${data.managedByCoforge}
Host Application for External Audiences?: ${data.externalAudienceAccess}
Store Customer Data?: ${data.storesCustomerData}${
    data.storesCustomerData === "Yes" && data.customerDataDetails
      ? ` (Customer: ${data.customerDataDetails})`
      : ""
  }
Store Confidential / Protected Data (PII, PCI, GDPR, LGPD)?: ${
    data.storesConfidentialData
  }

---------------------------------------------------------------
3. FINANCIAL & BUDGETING INFORMATION
---------------------------------------------------------------
Estimated Monthly Cost: $${data.estimatedMonthlyCost} USD
Cost Charged Back to Client?: ${data.costChargedBack}
Was Cost Foreseen in FY'27 Budget?: ${data.foreseenInBudget}
Related to AWS Partnership (Spend Credits)?: ${data.awsPartnershipRelated}
WBS Code: ${data.wbsCode?.trim() || "N/A"}
Cost Center (CC): ${data.costCenter?.trim() || "N/A"}
80% Budget Alert Emails: ${
    data.budgetAlertEmails && data.budgetAlertEmails.length > 0
      ? data.budgetAlertEmails.join(", ")
      : "N/A"
  }
BU Finance Controller (Email): ${data.buFinanceController?.trim() || "N/A"}

---------------------------------------------------------------
Submitted via Cloud Cost Intelligence Portal
Date: ${new Date().toLocaleString()}
---------------------------------------------------------------`;

  return { subject, body: formattedBody, sender, recipient };
}

/* ─────────────── main component ─────────────── */

interface AccountRequestFormProps {
  onSubmit: (data: FormData) => void;
}

export function AccountRequestForm({ onSubmit }: AccountRequestFormProps) {
  const [step, setStep] = useState(0);
  const [form, setForm] = useState<FormData>(emptyForm());
  const [errors, setErrors] = useState<Errors>({});
  const [submitting, setSubmitting] = useState(false);
  const [sentSuccessDetails, setSentSuccessDetails] = useState<{
    recipient: string;
    sender: string;
    subject: string;
    body: string;
  } | null>(null);

  const set = <K extends keyof FormData>(key: K, value: FormData[K]) =>
    setForm((prev) => ({ ...prev, [key]: value }));

  const toggleSuggestion = (sugg: string) => {
    const current = form.accountEnvironment;
    if (!current) {
      set("accountEnvironment", sugg);
    } else if (current.includes(sugg)) {
      const updated = current
        .split(",")
        .map((s) => s.trim())
        .filter((s) => s !== sugg)
        .join(", ");
      set("accountEnvironment", updated);
    } else {
      set("accountEnvironment", `${current}, ${sugg}`);
    }
  };

  const next = () => {
    const errs = validateStep(step, form);
    if (Object.keys(errs).length > 0) {
      setErrors(errs);
      return;
    }
    setErrors({});
    setStep((s) => s + 1);
  };

  const back = () => {
    setErrors({});
    setStep((s) => s - 1);
  };

  const handleSubmit = async () => {
    const errs = validateStep(2, form);
    if (Object.keys(errs).length > 0) {
      setErrors(errs);
      return;
    }
    setSubmitting(true);

    // Open the user's email client with the request pre-filled so the
    // mail is genuinely delivered to Ankit.A@coforge.com.
    const result = await sendEmailDirectly(form);
    
    onSubmit(form);
    setSubmitting(false);
    setSentSuccessDetails(result);
  };

  const reset = () => {
    setForm(emptyForm());
    setStep(0);
    setErrors({});
    setSentSuccessDetails(null);
  };

  /* ── Sent Confirmation Screen ── */
  if (sentSuccessDetails) {
    return (
      <Card className="border border-emerald-500/30 shadow-xl bg-card/90 backdrop-blur-md overflow-hidden">
        <div className="h-1.5 w-full bg-emerald-500" />
        <CardContent className="p-8 flex flex-col items-center justify-center text-center space-y-6">
          <div className="flex h-16 w-16 items-center justify-center rounded-full bg-emerald-100 dark:bg-emerald-950/60 border border-emerald-500/30 text-emerald-600">
            <CheckCircle2 size={36} />
          </div>

          <div className="space-y-2 max-w-lg">
            <h3 className="text-2xl font-bold tracking-tight text-foreground">
              Request Ready to Send to Ankit.A@coforge.com!
            </h3>
            <p className="text-sm text-muted-foreground">
              Your email client has been opened with all the request details pre-filled for Ankit.A@coforge.com. Just press send to deliver the request.
            </p>
          </div>

          {/* Details Card */}
          <div className="w-full max-w-lg rounded-xl border border-muted bg-muted/30 p-4 text-left space-y-2 text-xs">
            <div className="flex justify-between border-b border-muted/50 pb-2">
              <span className="font-bold text-muted-foreground">From (Sender):</span>
              <span className="font-semibold text-indigo-600 dark:text-indigo-400">{sentSuccessDetails.sender}</span>
            </div>
            <div className="flex justify-between border-b border-muted/50 pb-2">
              <span className="font-bold text-muted-foreground">To (Recipient):</span>
              <span className="font-semibold text-emerald-600 dark:text-emerald-400">{sentSuccessDetails.recipient}</span>
            </div>
            <div className="flex justify-between border-b border-muted/50 pb-2">
              <span className="font-bold text-muted-foreground">Subject:</span>
              <span className="font-semibold text-foreground truncate max-w-[260px]">{sentSuccessDetails.subject}</span>
            </div>
            <div className="flex justify-between pt-1">
              <span className="font-bold text-muted-foreground">Delivery:</span>
              <span className="inline-flex items-center gap-1 text-emerald-600 font-bold">
                <Check size={13} /> Email client opened — click Send to deliver
              </span>
            </div>
          </div>

          <button
            onClick={reset}
            className="flex items-center gap-2 rounded-xl bg-indigo-600 hover:bg-indigo-700 text-white px-6 py-2.5 text-sm font-semibold shadow-md transition-all"
          >
            <Sparkles size={16} /> Submit Another Account Request
          </button>
        </CardContent>
      </Card>
    );
  }

  return (
    <Card id="aws-account-form" className="border border-muted/40 shadow-sm bg-card/60 backdrop-blur-md overflow-hidden">
      {/* Header */}
      <div className="flex items-center justify-between px-6 py-5 border-b border-muted/30 bg-gradient-to-r from-indigo-500/5 to-violet-500/5">
        <div className="flex items-center gap-3">
          <div className="flex h-10 w-10 items-center justify-center rounded-xl bg-indigo-600/10 border border-indigo-500/20">
            <Mail className="h-5 w-5 text-indigo-600" />
          </div>
          <div>
            <h2 className="text-lg font-bold">AWS Account Request Form</h2>
            <p className="text-xs text-muted-foreground">
              Submit your account request to directly send all details to <span className="font-semibold text-foreground">Ankit.A@coforge.com</span>
            </p>
          </div>
        </div>
      </div>

      {/* Step Progress */}
      <div className="flex items-center gap-0 px-6 py-4 border-b border-muted/20 bg-muted/10 overflow-x-auto">
        {STEPS.map((s, i) => {
          const Icon = s.icon;
          const done = i < step;
          const active = i === step;
          return (
            <div key={i} className="flex items-center gap-0 flex-1 min-w-fit">
              <div className="flex flex-col items-center gap-1">
                <div
                  className={`flex h-9 w-9 items-center justify-center rounded-full border-2 transition-all ${
                    done
                      ? "border-emerald-500 bg-emerald-500"
                      : active
                      ? "border-indigo-500 bg-indigo-500"
                      : "border-muted bg-muted/50"
                  }`}
                >
                  {done ? (
                    <CheckCircle2 className="h-4 w-4 text-white" />
                  ) : (
                    <Icon
                      className={`h-4 w-4 ${
                        active ? "text-white" : "text-muted-foreground"
                      }`}
                    />
                  )}
                </div>
                <span
                  className={`text-xs font-semibold whitespace-nowrap ${
                    active
                      ? "text-indigo-600"
                      : done
                      ? "text-emerald-600"
                      : "text-muted-foreground"
                  }`}
                >
                  {s.label}
                </span>
              </div>
              {i < STEPS.length - 1 && (
                <div
                  className={`flex-1 h-0.5 mx-3 rounded-full mt-[-14px] transition-all ${
                    done ? "bg-emerald-400" : "bg-muted"
                  }`}
                />
              )}
            </div>
          );
        })}
      </div>

      <CardContent className="p-6">
        {/* ── Step 0: Project Info ── */}
        {step === 0 && (
          <div className="grid grid-cols-1 md:grid-cols-2 gap-5">
            {/* Ask user for their email */}
            <div className="md:col-span-2">
              <Field
                label="Your Email Address (Sender Email)"
                required
                error={errors.submitterEmail}
                hint="Used to send this account request directly to Ankit.A@coforge.com"
              >
                <div className="relative">
                  <User className="absolute left-3 top-2.5 h-4 w-4 text-muted-foreground" />
                  <input
                    type="email"
                    value={form.submitterEmail}
                    onChange={(e) => set("submitterEmail", e.target.value)}
                    placeholder="your.email@coforge.com"
                    className="bg-background pl-9 pr-3 py-2 text-sm rounded-lg border border-input w-full focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-indigo-500/50"
                  />
                </div>
              </Field>
            </div>

            <Field label="Division / BU" required error={errors.division}>
              <input
                type="text"
                value={form.division}
                onChange={(e) => set("division", e.target.value)}
                placeholder="e.g. Digital Engineering"
                className="bg-background px-3 py-2 text-sm rounded-lg border border-input focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-indigo-500/50"
              />
            </Field>

            <Field
              label="Project / Department Name"
              required
              error={errors.projectName}
            >
              <input
                type="text"
                value={form.projectName}
                onChange={(e) => set("projectName", e.target.value)}
                placeholder="e.g. Payments Platform"
                className="bg-background px-3 py-2 text-sm rounded-lg border border-input focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-indigo-500/50"
              />
            </Field>

            {/* Text Box for Account Environment + Quick Suggestions */}
            <div className="md:col-span-2">
              <Field
                label="Account Environment (DEV, UAT, PROD, PoC etc.)"
                required
                error={errors.accountEnvironment}
                hint="Type your environments into the text box below or click suggestions"
              >
                <input
                  type="text"
                  value={form.accountEnvironment}
                  onChange={(e) => set("accountEnvironment", e.target.value)}
                  placeholder="e.g. DEV, UAT, PROD"
                  className="bg-background px-3 py-2 text-sm rounded-lg border border-input focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-indigo-500/50 w-full mb-2"
                />
                <div className="flex flex-wrap items-center gap-1.5">
                  <span className="text-xs text-muted-foreground mr-1">Quick Add:</span>
                  {ENV_SUGGESTIONS.map((sugg) => {
                    const active = form.accountEnvironment.includes(sugg);
                    return (
                      <button
                        key={sugg}
                        type="button"
                        onClick={() => toggleSuggestion(sugg)}
                        className={`rounded-md border px-2.5 py-1 text-xs font-semibold transition-all ${
                          active
                            ? "border-indigo-500 bg-indigo-600 text-white"
                            : "border-muted bg-muted/40 text-foreground hover:bg-muted/70"
                        }`}
                      >
                        + {sugg}
                      </button>
                    );
                  })}
                </div>
              </Field>
            </div>

            <Field
              label="Point-of-Contact (email)"
              required
              error={errors.pointOfContact}
            >
              <input
                type="email"
                value={form.pointOfContact}
                onChange={(e) => set("pointOfContact", e.target.value)}
                placeholder="poc@company.com"
                className="bg-background px-3 py-2 text-sm rounded-lg border border-input focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-indigo-500/50"
              />
            </Field>

            <Field
              label="Account Manager (email)"
              required
              error={errors.accountManager}
            >
              <input
                type="email"
                value={form.accountManager}
                onChange={(e) => set("accountManager", e.target.value)}
                placeholder="am@company.com"
                className="bg-background px-3 py-2 text-sm rounded-lg border border-input focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-indigo-500/50"
              />
            </Field>

            <div className="md:col-span-2">
              <Field
                label="Business Justification"
                hint="Optional — Describe why this account is needed"
              >
                <textarea
                  value={form.businessJustification}
                  onChange={(e) => set("businessJustification", e.target.value)}
                  placeholder="Explain the business need for this AWS account..."
                  rows={3}
                  className="bg-background px-3 py-2 text-sm rounded-lg border border-input focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-indigo-500/50 resize-none w-full"
                />
              </Field>
            </div>
          </div>
        )}

        {/* ── Step 1: Account Config ── */}
        {step === 1 && (
          <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
            <div className="md:col-span-2">
              <Field
                label="Please add the user id/email who needs admin access to this account"
                required
                error={errors.adminEmails as string | undefined}
              >
                <TagInput
                  value={form.adminEmails}
                  onChange={(v) => set("adminEmails", v)}
                  placeholder="user@coforge.com"
                />
              </Field>
            </div>

            <Field
              label="Will this account be managed only by the Coforge team?"
              required
              error={errors.managedByCoforge}
            >
              <RadioGroup
                name="managedByCoforge"
                value={form.managedByCoforge}
                onChange={(v) => set("managedByCoforge", v)}
              />
            </Field>

            <Field
              label="Will this account host an application for access by external audiences (customer or third parties)?"
              required
              error={errors.externalAudienceAccess}
            >
              <RadioGroup
                name="externalAudienceAccess"
                value={form.externalAudienceAccess}
                onChange={(v) => set("externalAudienceAccess", v)}
              />
            </Field>

            {/* Store Customer Data */}
            <div className="md:col-span-2 space-y-3">
              <Field
                label="Store customer data?"
                required
                error={errors.storesCustomerData}
              >
                <RadioGroup
                  name="storesCustomerData"
                  value={form.storesCustomerData}
                  onChange={(v) => set("storesCustomerData", v)}
                />
              </Field>

              {form.storesCustomerData === "Yes" && (
                <div className="p-4 rounded-xl bg-indigo-50/50 dark:bg-indigo-950/30 border border-indigo-200 dark:border-indigo-800 animate-in fade-in duration-200">
                  <Field
                    label="If yes, what customer?"
                    required
                    error={errors.customerDataDetails}
                  >
                    <input
                      type="text"
                      value={form.customerDataDetails}
                      onChange={(e) => set("customerDataDetails", e.target.value)}
                      placeholder="Specify customer name and data type..."
                      className="bg-background px-3 py-2 text-sm rounded-lg border border-input focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-indigo-500/50 w-full"
                    />
                  </Field>
                </div>
              )}
            </div>

            <Field
              label="Store confidential/protected data (PII, PCI, GDPR, LGPD)?"
              required
              error={errors.storesConfidentialData}
            >
              <RadioGroup
                name="storesConfidentialData"
                value={form.storesConfidentialData}
                onChange={(v) => set("storesConfidentialData", v)}
              />
            </Field>
          </div>
        )}

        {/* ── Step 2: Financials ── */}
        {step === 2 && (
          <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
            <Field
              label="Estimated monthly cost in USD?"
              required
              error={errors.estimatedMonthlyCost}
            >
              <div className="relative">
                <span className="absolute left-3 top-2.5 text-sm text-muted-foreground font-semibold">
                  $
                </span>
                <input
                  type="number"
                  min="0"
                  value={form.estimatedMonthlyCost}
                  onChange={(e) => set("estimatedMonthlyCost", e.target.value)}
                  placeholder="0.00"
                  className="bg-background pl-7 pr-3 py-2 text-sm rounded-lg border border-input w-full focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-indigo-500/50"
                />
              </div>
            </Field>

            <Field
              label="Is the cost charged back to client?"
              required
              error={errors.costChargedBack}
            >
              <RadioGroup
                name="costChargedBack"
                value={form.costChargedBack}
                onChange={(v) => set("costChargedBack", v)}
              />
            </Field>

            <Field
              label="Was this cost foreseen in the FY'27 budget?"
              required
              error={errors.foreseenInBudget}
            >
              <RadioGroup
                name="foreseenInBudget"
                value={form.foreseenInBudget}
                onChange={(v) => set("foreseenInBudget", v)}
              />
            </Field>

            <Field
              label="Would it be related to the AWS Partnership (allow the spending of credits if available)?"
              required
              error={errors.awsPartnershipRelated}
            >
              <RadioGroup
                name="awsPartnershipRelated"
                value={form.awsPartnershipRelated}
                onChange={(v) => set("awsPartnershipRelated", v)}
              />
            </Field>

            <Field label="WBS Code" hint="Optional">
              <input
                type="text"
                value={form.wbsCode}
                onChange={(e) => set("wbsCode", e.target.value)}
                placeholder="e.g. WBS-2025-001"
                className="bg-background px-3 py-2 text-sm rounded-lg border border-input focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-indigo-500/50"
              />
            </Field>

            <Field label="Cost Center (CC)" hint="Optional">
              <input
                type="text"
                value={form.costCenter}
                onChange={(e) => set("costCenter", e.target.value)}
                placeholder="e.g. CC-4400"
                className="bg-background px-3 py-2 text-sm rounded-lg border border-input focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-indigo-500/50"
              />
            </Field>

            <div className="md:col-span-2">
              <Field
                label="Who will receive a notification that 80% of the budget has been reached? (E-mail) LIMIT 4"
                hint="Optional — Max 4 emails"
              >
                <TagInput
                  value={form.budgetAlertEmails || []}
                  onChange={(v) => set("budgetAlertEmails", v)}
                  placeholder="alert@company.com"
                  max={4}
                />
              </Field>
            </div>

            <div className="md:col-span-2">
              <Field
                label="BU Finance Controller who should receive the monthly cost of this AWS Account"
                hint="Optional — Controller email address"
              >
                <input
                  type="email"
                  value={form.buFinanceController}
                  onChange={(e) => set("buFinanceController", e.target.value)}
                  placeholder="finance@coforge.com"
                  className="bg-background px-3 py-2 text-sm rounded-lg border border-input w-full focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-indigo-500/50"
                />
              </Field>
            </div>
          </div>
        )}

        {/* Navigation */}
        <div className="flex items-center justify-between mt-8 pt-5 border-t border-muted/30">
          <button
            type="button"
            onClick={back}
            disabled={step === 0}
            className="flex items-center gap-1.5 rounded-xl border border-muted px-4 py-2.5 text-sm font-semibold text-foreground hover:bg-muted/50 transition-colors disabled:opacity-40"
          >
            <ChevronLeft size={16} /> Back
          </button>

          <div className="flex items-center gap-2">
            {STEPS.map((_, i) => (
              <div
                key={i}
                className={`h-1.5 rounded-full transition-all ${
                  i === step
                    ? "w-6 bg-indigo-500"
                    : i < step
                    ? "w-1.5 bg-emerald-500"
                    : "w-1.5 bg-muted"
                }`}
              />
            ))}
          </div>

          {step < STEPS.length - 1 ? (
            <button
              type="button"
              onClick={next}
              className="flex items-center gap-1.5 rounded-xl bg-indigo-600 px-5 py-2.5 text-sm font-semibold text-white hover:bg-indigo-700 transition-colors"
            >
              Next <ChevronRight size={16} />
            </button>
          ) : (
            <button
              type="button"
              onClick={handleSubmit}
              disabled={submitting}
              className="flex items-center gap-2 rounded-xl bg-emerald-600 px-6 py-2.5 text-sm font-semibold text-white hover:bg-emerald-700 transition-colors disabled:opacity-60 shadow-md shadow-emerald-600/20"
            >
              {submitting ? (
                <>
                  <Loader2 size={16} className="animate-spin" /> Opening Email…
                </>
              ) : (
                <>
                  <Send size={16} /> Compose Email to Ankit.A@coforge.com
                </>
              )}
            </button>
          )}
        </div>
      </CardContent>
    </Card>
  );
}
