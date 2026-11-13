export interface KnowledgeEntry {
  id: string;
  title: string;
  keywords: string[];
  answer: string;
}

export const APP_SYSTEM_CONTEXT = `You are "Kira", the AI Cloud & FinOps Concierge for the Coforge Cloud Cost Intelligence & Governance Portal.
Always identify yourself as Kira when greeted or asked who you are. Your tone is warm, sharp, executive, and helpful.
Your job is to help users (both Requesters and FinOps Admins) clearly understand the application, its dashboards, FinOps metrics, and every single field of the AWS Account Provisioning Request Form.

### 1. APPLICATION OVERVIEW & ROLES
- **Admin Role (FinOps / Cloud Governance Team)**:
  - Has full access to all dashboards:
    - **Multi-Cloud Overview (\`/\` or \`/overview\`)**: Executive landing page combining AWS, Azure, and GCP cloud spend, Month-over-Month (MoM) cost deltas, budget utilization, top cost drivers, and the **Admin Account Request Command Center** (where Admins review, approve, or reject submitted AWS account requests).
    - **AWS Cost Dashboard (\`/aws\` or \`/dashboard\`)**: Deep-dive analytics for AWS accounts (e.g., AWS-Encora \`5076-7238-5186\`, AWS-Coforge \`5131-6780-3309\`). Shows KPI cards, 6-month cost trends, top AWS services (EC2, RDS, S3, etc.), daily cost anomaly charts, regional spend breakdown, data tables, and Organization & Governance insights.
    - **Azure Cost Dashboard (\`/azure\`)**: Deep-dive analytics for Azure subscriptions (e.g., Coforge Global IT, Coforge Secondary). Shows monthly Azure spend, resource group breakdown, meter category analysis, and budget tracking.
    - **GCP Intelligence Dashboard (\`/gcp\`, \`/gcp/projects\`)**: Google Cloud Platform project spend, BigQuery billing export insights, service breakdown, and project-level cost attribution.
    - **AWS Linked Accounts (\`/linked-accounts\`)**: Directory of all AWS member/linked accounts with individual deep-dive pages (\`/linked-accounts/:id\`).
    - **Azure Subscriptions (\`/azure/subscriptions\`)**: Directory of all Azure subscriptions with subscription-level deep-dive pages (\`/azure/subscriptions/:id\`).
    - **Resource Inventory (\`/inventory\` or \`/resources\`)**: Cross-cloud asset and resource inventory directory to inspect active cloud resources, tags, regions, and status.
    - **New Request Portal (\`/newrequest\`)**: Admins can both submit requests and view/manage **All Submissions**.

- **Basic / Requester Role (Project Managers, Architects, Engineers)**:
  - Logs in via \`/login\` (using Coforge email & password or Microsoft/Azure AD SSO) and is directed to the **AWS Account Provisioning & Approval Center (\`/newrequest\`)**.
  - Has two tabs on \`/newrequest\`:
    1. **Request Form**: A 3-step guided wizard to request a new AWS Account.
    2. **My Requests**: Track live approval status (\`Pending\`, \`Approved\`, \`Rejected\`), reviewer comments, and submission history.

---

### 2. COMPLETE GUIDE TO THE 3-STEP AWS ACCOUNT REQUEST FORM (\`/newrequest\`)

#### STEP 1: Project & Department Information
1. **Your Email Address (Sender)** *(Required)*:
   - Pre-filled with your logged-in Coforge email. Used as the requester identity and reply-to address for notifications.
2. **Division / Business Unit (BU)** *(Required)*:
   - Your organizational unit within Coforge (e.g., *BFS*, *Insurance*, *Travel & Hospitality*, *Digital Engineering*, *Cloud & Infra*, *Healthcare*, *Public Sector*).
3. **Project / Department Name** *(Required)*:
   - Name of the client engagement, internal product, or department for which the AWS account is being provisioned.
4. **Account Environment(s)** *(Required)*:
   - Quick-select chips or custom list of environments needed: **DEV** (Development), **UAT** (User Acceptance Testing), **PROD** (Production), **PoC** (Proof of Concept), or **Sandbox**. You can select multiple environments.
5. **Point of Contact (PoC Email)** *(Required)*:
   - Technical lead or primary owner who can answer architecture/operations questions about this account.
6. **Account Manager (Email)** *(Required)*:
   - Delivery Manager, Engagement Manager, or Account Manager responsible for the project/client relationship.
7. **Business Justification** *(Optional but strongly recommended)*:
   - Brief explanation of *why* the account is needed, what workload will run in it, expected timeline, and business value (helps FinOps approve faster).

#### STEP 2: Account Configuration & Governance
1. **Admin User IDs / Emails** *(Required — up to 5 emails)*:
   - Coforge email addresses of users who require initial IAM Administrator / SSO Admin access to the newly provisioned AWS account. Type an email and press **Enter** or click **Add**.
2. **Will the account be managed ONLY by Coforge Team?** *(Required — Yes / No)*:
   - Select **Yes** if only Coforge engineers/admins will manage the infrastructure. Select **No** if external client engineers or third-party vendors will also have administrative/console access.
3. **Will this account host an application for external audiences?** *(Required — Yes / No)*:
   - Select **Yes** if the account will run public-facing web apps, APIs, or portals accessible from the public internet (triggers additional security/WAF guardrails). Select **No** for internal-only workloads.
4. **Will this account store Customer Data?** *(Required — Yes / No)*:
   - Select **Yes** if any client-owned datasets, files, or databases will reside in this account.
   - **Customer Name / Details** *(Required if Yes)*: Specify which customer's data is stored so compliance & data residency policies can be applied.
5. **Will this account store Confidential / Protected Data (PII, PCI, GDPR, LGPD)?** *(Required — Yes / No)*:
   - Select **Yes** if the workload processes Personally Identifiable Information (PII), Payment Card Industry (PCI) data, or data regulated under GDPR/LGPD/HIPAA. This ensures encryption, audit logging, and security baselines are enforced.

#### STEP 3: Financials & Budgeting Information
1. **Estimated Monthly Cost (USD)** *(Required)*:
   - Projected monthly AWS spend in US Dollars (e.g., \`500\`, \`2500\`, \`10000\`). Use the AWS Pricing Calculator if unsure.
2. **Will the cost be charged back to a Client?** *(Required — Yes / No)*:
   - **Yes**: Billable client project where AWS costs are invoiced/reimbursed by the customer.
   - **No**: Internal Coforge R&D, PoC, or overhead cost absorbed by the Business Unit.
3. **Was this cost foreseen in the FY'27 Budget?** *(Required — Yes / No)*:
   - Indicates whether this cloud spend is already planned and approved in the Business Unit's annual FY'27 budget.
4. **Is this request related to the AWS Partnership (Spend Credits / MAP / PoC Credits)?** *(Required — Yes / No)*:
   - Select **Yes** if this workload qualifies for AWS promotional credits, Migration Acceleration Program (MAP), or AWS Partner funding.
5. **WBS Code (Work Breakdown Structure)** *(Optional)*:
   - Internal project accounting code used by Finance to map costs to a specific deliverable or project billing code (e.g., \`WBS-2026-FIN-04\`).
6. **Cost Center (CC)** *(Optional)*:
   - Department/BU financial Cost Center code for internal chargeback and ERP allocation (e.g., \`CC-4012\`).
7. **80% Budget Alert Recipient Emails** *(Optional — up to 5 emails)*:
   - Emails that will automatically receive AWS Budgets alerts when actual or forecasted monthly spend crosses **80%** of the estimated budget.
8. **BU Finance Controller (Email)** *(Optional)*:
   - Email of the Business Unit Finance Controller who oversees budget sign-off for your division.

---

### 3. WHAT HAPPENS AFTER SUBMITTING THE FORM?
1. The request is saved to the SQL Server database (\`/api/requests\`).
2. An automated HTML notification email is sent via **Microsoft Graph** to the FinOps approvers (\`ankit.a@coforge.com\` and \`omparashuram.b@coforge.com\`).
3. FinOps Admins review the request in the **Executive Overview / Admin Command Center** and mark it **Approved** or **Rejected** (with notes).
4. Requesters can check live status anytime under the **My Requests** tab on \`/newrequest\`.

---

### 4. KEY FINOPS METRICS EXPLAINED
- **MoM Delta (Month-over-Month Change)**: Percentage and dollar difference between the selected month's spend and the previous month's spend.
- **Daily Cost Anomaly**: Days where daily cloud spend spiked significantly above the 30-day moving average.
- **Unallocated / Untagged Spend**: Cloud resources missing mandatory governance tags (\`Environment\`, \`Owner\`, \`CostCenter\`, \`Project\`).
- **Amortized vs. Unblended Cost**: Unblended is cash spend as billed; Amortized spreads upfront Reserved Instance / Savings Plan commitments across usage days.

Keep answers concise, friendly, well-structured (using bullet points and bold labels), and directly helpful to the user.`;

export const KNOWLEDGE_ENTRIES: KnowledgeEntry[] = [
  {
    id: "form-overview",
    title: "How to fill the AWS Account Request Form (/newrequest)",
    keywords: [
      "form",
      "request",
      "newrequest",
      "new account",
      "provision",
      "how to fill",
      "steps",
      "aws account request",
      "apply",
      "submit",
    ],
    answer: `The **AWS Account Request Form** (\`/newrequest\`) has **3 simple steps**:

1. **Step 1 — Project Info**:
   - **Sender Email**: Your Coforge email (auto-filled).
   - **Division / BU**: Your business unit (e.g., BFS, Insurance, Digital Engineering).
   - **Project Name**: Name of the project or workload.
   - **Account Environment(s)**: Click chips like **DEV**, **UAT**, **PROD**, **PoC**, or **Sandbox**.
   - **Point of Contact & Account Manager**: Technical lead email and Delivery/Account Manager email.
   - **Business Justification**: Why this account is needed and what workload it will run.

2. **Step 2 — Account Config & Governance**:
   - **Admin Emails**: Up to 5 user emails who need initial AWS admin access (type email + press **Enter** or **Add**).
   - **Managed by Coforge**: **Yes** if only Coforge manages it; **No** if external/client teams also manage it.
   - **External Audience Access**: **Yes** if hosting public-facing apps/APIs; **No** if internal.
   - **Customer Data & Confidential Data (PII/PCI/GDPR)**: Specify if client or regulated data will be stored.

3. **Step 3 — Financials & Budget**:
   - **Estimated Monthly Cost (USD)**: Expected monthly AWS bill in USD.
   - **Charged Back to Client**: **Yes** if client-billable, **No** if internal spend.
   - **Foreseen in FY'27 Budget** & **AWS Partnership Credits**: Select **Yes** or **No**.
   - **WBS Code & Cost Center**: Accounting codes for Finance chargeback.
   - **80% Budget Alert Emails & BU Finance Controller**: Who should be alerted when spend hits 80% of budget.`,
  },
  {
    id: "step-1-fields",
    title: "Step 1: Project & Department Information Fields",
    keywords: [
      "step 1",
      "division",
      "business unit",
      "environment",
      "poc",
      "point of contact",
      "account manager",
      "business justification",
      "justification",
      "sandbox",
      "uat",
    ],
    answer: `Here is how to fill **Step 1 (Project Info)** of the AWS Account Request Form:

- **Division / BU**: Enter your Coforge Business Unit (e.g., *BFS*, *Insurance*, *Travel & Hospitality*, *Cloud & Infra*, *Digital Engineering*).
- **Project / Department Name**: Enter the official project or initiative name (e.g., *Customer Portal Modernization*).
- **Account Environment(s)**: Click one or more environment badges (**DEV**, **UAT**, **PROD**, **PoC**, **Sandbox**) or type custom ones separated by commas.
- **Point of Contact (Email)**: The primary technical architect or lead responsible for day-to-day operations of the account.
- **Account Manager (Email)**: The Delivery Manager, Engagement Director, or Account Manager overseeing the project.
- **Business Justification**: Write 2–3 sentences describing the workload, why a dedicated AWS account is required, and expected duration (e.g., *"Dedicated UAT and PROD environments for the Claims Processing microservice migration; isolating resources for client security compliance."*).`,
  },
  {
    id: "step-2-governance",
    title: "Step 2: Account Configuration, GDPR/PII & Governance Fields",
    keywords: [
      "step 2",
      "governance",
      "admin email",
      "confidential",
      "pii",
      "pci",
      "gdpr",
      "lgpd",
      "customer data",
      "external audience",
      "managed by coforge",
      "security",
    ],
    answer: `Here is what each question in **Step 2 (Account Config & Governance)** means:

- **Admin User IDs / Emails**: Add up to **5 Coforge emails** of engineers/leads who need initial AWS Console/SSO Administrator permissions. *(Tip: Type the email and click **+ Add** or press **Enter**).*
- **Managed Only by Coforge Team?**:
  - Choose **Yes** if only Coforge employees will administer the AWS account.
  - Choose **No** if customer engineers or 3rd-party vendors will also have IAM/Console access.
- **Host Application for External Audiences?**:
  - Choose **Yes** if any application, load balancer, or API in this account will be reachable from the public internet.
  - Choose **No** if workloads are strictly internal/private VPN.
- **Store Customer Data?**:
  - Choose **Yes** if real or sample data belonging to a client will be stored (you'll be asked for the **Customer Name**).
- **Store Confidential / Protected Data (PII, PCI, GDPR, LGPD)?**:
  - Choose **Yes** if personal data (names, emails, SSNs), payment/card data (PCI), or GDPR-regulated records are processed so mandatory security guardrails can be enabled.`,
  },
  {
    id: "step-3-financials",
    title: "Step 3: Financials, WBS Code, Cost Center & Budget Fields",
    keywords: [
      "step 3",
      "wbs",
      "wbs code",
      "cost center",
      "budget",
      "financial",
      "charged back",
      "chargeback",
      "fy27",
      "fy'27",
      "partnership",
      "credits",
      "finance controller",
      "80%",
      "alert",
      "estimated monthly cost",
    ],
    answer: `Here is how to complete **Step 3 (Financials & Budgeting)**:

- **Estimated Monthly Cost (USD)** *(Required)*: Your projected monthly AWS spend in US dollars (e.g., \`1200\`).
- **Cost Charged Back to Client?** *(Required)*:
  - **Yes**: The client pays for or reimburses the cloud infrastructure costs.
  - **No**: Coforge absorbs the cost internally (PoC, R&D, training, or internal platform).
- **Foreseen in FY'27 Budget?** *(Required)*: Select **Yes** if this spend was already planned in your BU's annual budget; **No** if it is an unbudgeted/new demand.
- **Related to AWS Partnership (Spend Credits)?** *(Required)*: Select **Yes** if this workload is eligible for AWS Partner funding, MAP credits, or PoC credits.
- **WBS Code (Work Breakdown Structure)**: Project billing/accounting code from SAP/ERP used by Finance to track project expenses.
- **Cost Center (CC)**: Your department's financial Cost Center code for internal allocation.
- **80% Budget Alert Emails**: Up to 5 emails that will receive automated alerts when monthly AWS spend hits **80%** of your estimated budget.
- **BU Finance Controller**: Email of your Business Unit's finance approver/controller.`,
  },
  {
    id: "approval-workflow",
    title: "Approval Process & Tracking My Requests",
    keywords: [
      "approve",
      "approval",
      "status",
      "pending",
      "rejected",
      "who approves",
      "how long",
      "email notification",
      "my requests",
      "track",
    ],
    answer: `### How Request Approval Works
1. **Submission**: When you submit the form on \`/newrequest\`, your request is stored in the database with status **Pending**.
2. **Automated Email**: Microsoft Graph automatically emails the FinOps Governance leads (**Ankit** & **Om**) with your full project, security, and financial details.
3. **FinOps Review**: Admins review the request in the **Multi-Cloud Overview Command Center** (\`/\`) and can **Approve** or **Reject** it with review notes.
4. **Tracking**: Switch to the **"My Requests"** tab at the top-right of the \`/newrequest\` page at any time to see your live status (**Pending**, **Approved**, or **Rejected**) and reviewer comments.`,
  },
  {
    id: "app-navigation",
    title: "What is this App? Pages & Dashboards Explained",
    keywords: [
      "what is this app",
      "explain the app",
      "about the app",
      "overview",
      "pages",
      "dashboard",
      "navigate",
      "features",
      "aws",
      "azure",
      "gcp",
      "inventory",
      "linked accounts",
    ],
    answer: `Welcome to the **Coforge Cloud Cost Intelligence & FinOps Governance Portal**! Here is what each section of the platform does:

- **Executive Multi-Cloud Overview (\`/\`)**: Unified view of **AWS, Azure, and GCP** cloud spend, Month-over-Month (MoM) trends, budget health, and the **Admin Request Approval Queue**.
- **AWS Cost Analytics (\`/aws\`)**: Tracks AWS accounts (*AWS-Encora* & *AWS-Coforge*) across the last 6 months — showing KPI cards, top services, daily cost anomalies, regional spend, and governance tables.
- **Azure Cost Analytics (\`/azure\`)**: Tracks Azure subscriptions (*Coforge Global IT* & *Coforge Secondary*) with service category breakdowns, resource group spend, and budget alerts.
- **GCP Intelligence (\`/gcp\`)**: Monitors Google Cloud Platform projects, BigQuery billing exports, and GCP service costs.
- **Linked Accounts & Subscriptions (\`/linked-accounts\`, \`/azure/subscriptions\`)**: Drill down into individual AWS member accounts or Azure subscriptions.
- **Resource Inventory (\`/inventory\`)**: Searchable cross-cloud catalog of active cloud assets, instance types, regions, and governance tags.
- **AWS Account Request Portal (\`/newrequest\`)**: Self-service 3-step wizard for teams to request new AWS environments and track FinOps approval.`,
  },
  {
    id: "finops-metrics",
    title: "FinOps Metrics & Dashboard Terms Explained",
    keywords: [
      "metric",
      "kpi",
      "mom",
      "delta",
      "anomaly",
      "spiked",
      "budget",
      "forecast",
      "governance",
      "untagged",
      "chart",
    ],
    answer: `### Key Dashboard & FinOps Terms
- **Total Monthly Spend**: Aggregated cloud bill for the selected month (switchable via the left hover sidebar).
- **MoM Delta (Month-over-Month)**: How much spend increased or decreased compared to the prior month (in both \`$\` and \`%\`).
- **Top Cost Drivers / Services**: The cloud services (e.g., *Amazon EC2*, *Amazon RDS*, *Azure Virtual Machines*, *Compute Engine*) consuming the largest share of budget.
- **Daily Cost Anomaly**: Highlights days where daily spend spiked unusually high compared to normal baseline usage.
- **Linked Accounts / Subscriptions**: Child accounts or subscriptions rolled up under a payer/management organization.`,
  },
  {
    id: "login-access",
    title: "Login, Roles & Access Permissions",
    keywords: [
      "login",
      "role",
      "admin",
      "basic",
      "permission",
      "access",
      "sign in",
      "sso",
      "azure ad",
      "password",
    ],
    answer: `### Roles & Access in the Portal
- **Requester (Basic Role)**:
  - Can sign up or sign in at \`/login\` using a Coforge email/password or **Microsoft SSO (Azure AD)**.
  - Has access to \`/newrequest\` to submit AWS Account Provisioning forms and track their own submissions under **My Requests**.
- **FinOps Admin (\`admin\` Role)**:
  - Has full access to all multi-cloud cost dashboards (\`/\`, \`/aws\`, \`/azure\`, \`/gcp\`), linked account directories, resource inventory (\`/inventory\`), and the **Account Request Approval Queue** to approve/reject requests.`,
  },
];

export function getQuickPromptsForPath(pathname: string, isAdmin: boolean): string[] {
  if (pathname.startsWith("/newrequest")) {
    return [
      "How do I fill the 3-step request form?",
      "What are WBS Code & Cost Center in Step 3?",
      "Explain Step 2 governance & GDPR/PII fields",
      "Help me draft a Business Justification",
      "What happens after I submit my request?",
    ];
  }
  if (pathname.startsWith("/azure")) {
    return [
      "What does the Azure Dashboard show?",
      "Explain FinOps metrics & MoM Delta",
      "How do I inspect an Azure Subscription?",
      "How do teams request a new cloud account?",
    ];
  }
  if (pathname.startsWith("/gcp")) {
    return [
      "What does the GCP Dashboard show?",
      "Explain FinOps metrics & MoM Delta",
      "How does Multi-Cloud Overview work?",
    ];
  }
  if (pathname.startsWith("/inventory") || pathname.startsWith("/resources")) {
    return [
      "What is the Resource Inventory page?",
      "Explain cloud governance & tagging",
      "How do I navigate all portal pages?",
    ];
  }
  if (isAdmin) {
    return [
      "Give me a tour of this application",
      "How do I approve AWS account requests?",
      "Explain the 3-step AWS Request Form fields",
      "Explain FinOps KPIs & MoM Delta",
    ];
  }
  return [
    "What is this app and how does it work?",
    "How do I fill the AWS Account Request Form?",
    "What are WBS Code & Cost Center?",
    "How do I track my request approval status?",
  ];
}

export function getSmartFallbackReply(
  userMessage: string,
  currentPath: string = "/",
  userRole: string = "basic"
): string {
  const q = userMessage.toLowerCase().trim();

  // Check if user wants help writing a business justification
  if (
    q.includes("draft") ||
    (q.includes("write") && q.includes("justification")) ||
    (q.includes("help") && q.includes("justification")) ||
    q.includes("example justification")
  ) {
    return `Here are **3 ready-to-use Business Justification templates** you can copy and adapt for **Step 1** of the form:

- **For a Client Delivery / Migration Project**:
  > *"Provisioning dedicated DEV and UAT AWS environments for the [Project Name] engagement to isolate workload resources, enforce client security compliance, and support upcoming sprint deployments."*
- **For an Internal PoC / Sandbox**:
  > *"Requesting an isolated AWS Sandbox/PoC environment for [Team/BU Name] to evaluate cloud-native architecture and benchmark service costs over a 60-day trial period."*
- **For a Production Application Launch**:
  > *"Establishing a dedicated Production AWS account for [Application Name] to ensure strict IAM boundary separation, GDPR/PII compliance guardrails, and accurate client chargeback tracking."*`;
  }

  // Score knowledge entries against query
  let bestEntry: KnowledgeEntry | null = null;
  let bestScore = 0;

  for (const entry of KNOWLEDGE_ENTRIES) {
    let score = 0;
    for (const kw of entry.keywords) {
      if (q.includes(kw)) {
        score += kw.split(" ").length * 2;
      }
    }
    if (score > bestScore) {
      bestScore = score;
      bestEntry = entry;
    }
  }

  if (bestEntry && bestScore > 0) {
    return bestEntry.answer;
  }

  // Context-aware default answer if greeting or general query
  if (currentPath.startsWith("/newrequest")) {
    return `Hi! I'm **Kira**, your Cloud Portal & FinOps Concierge. Since you're on the **AWS Account Request Portal (\`/newrequest\`)**, I can walk you through:

- **Step 1 (Project Info)**: Division/BU, Environment tags (\`DEV\`, \`UAT\`, \`PROD\`, \`PoC\`), PoC vs. Account Manager emails, or drafting a **Business Justification**.
- **Step 2 (Governance & Security)**: Admin emails, external audience access, customer data, and **PII / PCI / GDPR** compliance flags.
- **Step 3 (Financials & Budget)**: Estimated Monthly Cost (USD), Client Chargeback, FY'27 Budget, **WBS Code**, **Cost Center**, and **80% Budget Alert** recipients.

Ask me about any specific field or tap one of the quick cards above!`;
  }

  return `Hello! I'm **Kira**, your **Cloud Cost Intelligence AI Concierge** (${userRole === "admin" ? "Admin View" : "Requester View"}). Here is what I can help you with:

- **Dashboards & Analytics**: Multi-Cloud Overview (\`/\`), AWS (\`/aws\`), Azure (\`/azure\`), GCP (\`/gcp\`), Linked Accounts, and Resource Inventory (\`/inventory\`).
- **AWS Account Request Form (\`/newrequest\`)**: Field-by-field explanations for **Step 1 (Project Info)**, **Step 2 (Governance & GDPR/PII)**, and **Step 3 (Financials, WBS Code, Cost Center, Budgets)**.
- **Approval Workflow**: How requests are submitted, emailed via Microsoft Graph, and approved by FinOps Admins.

What would you like me to explain today?`;
}
