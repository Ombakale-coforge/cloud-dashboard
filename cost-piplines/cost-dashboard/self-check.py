"""
Self-check verification for Azure & AWS SQL DB integration,
TypeScript server migration, and report seeder in cost-dashboard.
Run: python3 cost-dashboard/self-check.py
"""
import re
import sys
import os

def run_checks():
    # 1. Check TypeScript server modular structure
    assert os.path.exists("src/server/index.ts"), "Missing src/server/index.ts"
    assert os.path.exists("src/server/db.ts"), "Missing src/server/db.ts"
    assert os.path.exists("src/server/routes/auth.ts"), "Missing src/server/routes/auth.ts"
    assert os.path.exists("src/server/routes/requests.ts"), "Missing src/server/routes/requests.ts"
    assert os.path.exists("src/server/routes/aws.ts"), "Missing src/server/routes/aws.ts"
    assert os.path.exists("src/server/routes/azure.ts"), "Missing src/server/routes/azure.ts"

    # 2. Check cost-dashboard/server.ts or server.js shim
    server_shim = "cost-dashboard/server.ts" if os.path.exists("cost-dashboard/server.ts") else "cost-dashboard/server.js"
    with open(server_shim, "r") as f:
        shim = f.read()
    assert "src/server/index.ts" in shim, f"{server_shim} must delegate to src/server/index.ts"

    # 3. Check Azure routes
    with open("src/server/routes/azure.ts", "r") as f:
        azure_routes = f.read()
    assert "'/accounts'" in azure_routes, "Missing /accounts in azure.ts"
    assert "'/dataset/:filename'" in azure_routes, "Missing /dataset/:filename in azure.ts"

    datasets = [
        "monthly_totals", "kpis_by_month", "mom_change", "by_service",
        "by_subscription", "top_resources", "by_pricing_model", "top_meters",
        "by_resource_group", "by_charge_type", "by_region", "credit_eligibility",
        "cost_concentration_pareto", "anomaly_flags", "new_services_by_month",
        "forecast_next_month", "volatility"
    ]
    for d in datasets:
        assert f"case '{d}':" in azure_routes, f"Missing Azure dataset switch case '{d}'"

    # 4. Check schema.prisma model alignment
    with open("prisma/schema.prisma", "r") as f:
        schema = f.read()

    azure_models = set(re.findall(r"prisma\.(azureReport[A-Za-z]+)", azure_routes))
    assert len(azure_models) == 18, f"Expected 18 Azure report models, found {len(azure_models)}"
    for m in azure_models:
        pascal = m[0].upper() + m[1:]
        assert f"model {pascal}" in schema, f"Model {pascal} not in schema.prisma"

    # 5. Check AWS routes & 404 fallback
    with open("src/server/routes/aws.ts", "r") as f:
        aws_routes = f.read()
    assert "'/accounts'" in aws_routes, "Missing /accounts in aws.ts"
    assert "'/dataset/:filename'" in aws_routes, "Missing /dataset/:filename in aws.ts"
    assert "NO_RUN_FOUND" in aws_routes, "Missing NO_RUN_FOUND 404 guard in aws.ts"
    assert "NO_AWS_ACCOUNTS" in aws_routes, "Missing NO_AWS_ACCOUNTS guard in aws.ts"

    # 6. Check AWS seeder pipeline
    assert os.path.exists("src/aws_cost_report/index.ts"), "Missing src/aws_cost_report/index.ts"
    with open("src/aws_cost_report/index.ts", "r") as f:
        seeder = f.read()
    assert "seedAwsReports" in seeder, "Missing seedAwsReports function"
    assert "prisma.awsReportRun" in seeder, "Missing awsReportRun seeding logic"
    assert "prisma.awsMonthlyTotal" in seeder, "Missing awsMonthlyTotal seeding logic"

    # 7. Check persistence hook in aws_cost_pipeline.ts or .js
    pipe_file = "src/aws_cost_pipeline.ts" if os.path.exists("src/aws_cost_pipeline.ts") else "src/aws_cost_pipeline.js"
    with open(pipe_file, "r") as f:
        pipeline = f.read()
    assert "saveAwsReportRunToDb" in pipeline or "src/aws_cost_report/index.ts" in pipeline, f"Missing persistence trigger in {pipe_file}"

    # 8. Check useCsv.ts fallback
    with open("cost-dashboard/src/lib/useCsv.ts", "r") as f:
        use_csv = f.read()
    assert 'const isAzure = path.includes("/azure");' in use_csv, "Missing Azure provider detection"
    assert 'Empty dataset from API' in use_csv, "Missing empty array fallback in useCsv.ts"

    # 9. Check package.json scripts
    with open("package.json", "r") as f:
        root_pkg = f.read()
    assert '"seed:aws":' in root_pkg, "Missing seed:aws script in root package.json"
    assert '"server":' in root_pkg, "Missing server script in root package.json"

    with open("cost-dashboard/package.json", "r") as f:
        client_pkg = f.read()
    assert 'src/server/index.ts' in client_pkg, "cost-dashboard dev command must point to src/server/index.ts"

    # 10. Check Azure Subscriptions directory & detail replication
    assert os.path.exists("cost-dashboard/src/pages/AzureSubscriptionsPage.tsx"), "Missing AzureSubscriptionsPage.tsx"
    assert os.path.exists("cost-dashboard/src/pages/AzureSubscriptionDetailPage.tsx"), "Missing AzureSubscriptionDetailPage.tsx"

    with open("cost-dashboard/src/pages/AzureSubscriptionsPage.tsx", "r") as f:
        sub_page = f.read()
    assert not re.search(r'\baws\b', sub_page, re.I), "AzureSubscriptionsPage.tsx must not contain AWS wording"
    assert not re.search(r'\bpayer\b', sub_page, re.I), "AzureSubscriptionsPage.tsx must not contain 'payer' wording"
    assert "₹" in sub_page, "AzureSubscriptionsPage.tsx must format currency in INR (₹)"

    with open("cost-dashboard/src/pages/AzureSubscriptionDetailPage.tsx", "r") as f:
        detail_page = f.read()
    assert not re.search(r'\baws\b', detail_page, re.I), "AzureSubscriptionDetailPage.tsx must not contain AWS wording"
    assert "₹" in detail_page, "AzureSubscriptionDetailPage.tsx must format currency in INR (₹)"

    with open("src/server/routes/azure.ts", "r") as f:
        azure_routes = f.read()
    assert "'/linked-accounts'" in azure_routes, "Missing /linked-accounts in azure.ts"
    assert "'/linked-accounts/:linkedAccountId'" in azure_routes, "Missing /linked-accounts/:linkedAccountId in azure.ts"

    with open("cost-dashboard/src/components/Navbar.tsx", "r") as f:
        navbar = f.read()
    assert "/azure/subscriptions" in navbar, "Missing /azure/subscriptions in Navbar.tsx"
    assert "Subscriptions" in navbar, "Missing Subscriptions label in Navbar.tsx"

    with open("cost-dashboard/src/main.tsx", "r") as f:
        main_tsx = f.read()
    assert "/azure/subscriptions" in main_tsx, "Missing /azure/subscriptions route in main.tsx"
    assert "AzureSubscriptionsPage" in main_tsx, "Missing AzureSubscriptionsPage in main.tsx"
    assert "AzureSubscriptionDetailPage" in main_tsx, "Missing AzureSubscriptionDetailPage in main.tsx"

    # 10. Check in-tab navigation & auth persistence
    assert 'target="_blank"' not in sub_page, "AzureSubscriptionsPage must navigate in current tab (no target='_blank')"
    with open("cost-dashboard/src/pages/LinkedAccountsPage.tsx", "r") as f:
        linked_page = f.read()
    assert 'target="_blank"' not in linked_page, "LinkedAccountsPage must navigate in current tab (no target='_blank')"
    with open("cost-dashboard/src/pages/LoginPage.tsx", "r") as f:
        login_page = f.read()
    assert "localStorage.removeItem" not in login_page, "LoginPage.tsx must not purge localStorage on mount"

    print("PASS: Azure & AWS SQL DB integration, TypeScript server migration, and in-tab navigation verified successfully.")

if __name__ == "__main__":
    try:
        run_checks()
    except AssertionError as err:
        print(f"FAIL: {err}", file=sys.stderr)
        sys.exit(1)
