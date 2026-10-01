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

    # 2. Check cost-dashboard/server.js shim
    with open("cost-dashboard/server.js", "r") as f:
        shim = f.read()
    assert "src/server/index.ts" in shim, "cost-dashboard/server.js must delegate to src/server/index.ts"

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

    # 7. Check inline seeding hook in aws_cost_pipeline.js
    with open("src/aws_cost_pipeline.js", "r") as f:
        pipeline = f.read()
    assert "src/aws_cost_report/index.ts" in pipeline, "Missing inline seeding trigger in aws_cost_pipeline.js"

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
    assert '"predev": "node scripts/sync-data.js"' in client_pkg, "Missing predev sync hook"
    assert '"sync-data": "node scripts/sync-data.js"' in client_pkg, "Missing sync-data script"
    assert 'src/server/index.ts' in client_pkg, "cost-dashboard dev command must point to src/server/index.ts"

    print("PASS: Azure & AWS SQL DB integration, TypeScript server migration, and seeder verified successfully.")

if __name__ == "__main__":
    try:
        run_checks()
    except AssertionError as err:
        print(f"FAIL: {err}", file=sys.stderr)
        sys.exit(1)
