/**
 * Quick viewer for the login / signup tables in SQL Server.
 * Usage:  npx tsx src/query-login-tables.ts
 */
import 'dotenv/config';
import { PrismaClient } from '@prisma/client';
import { PrismaMssql } from '@prisma/adapter-mssql';

const prisma = new PrismaClient({ adapter: new PrismaMssql(process.env.DATABASE_URL!) });

async function main() {
  console.log('\n=== Row counts ===');
  console.table(await prisma.$queryRawUnsafe(`
    SELECT
      (SELECT COUNT(*) FROM dbo.users)             AS users,
      (SELECT COUNT(*) FROM dbo.user_login_events) AS login_events,
      (SELECT COUNT(*) FROM dbo.user_sessions)     AS sessions,
      (SELECT COUNT(*) FROM dbo.account_requests)  AS account_requests
  `));

  console.log('\n=== dbo.users (signup / login accounts) ===');
  console.table(await prisma.$queryRawUnsafe(`
    SELECT id, name, email, role, department, is_active, created_at, last_login_at
    FROM dbo.users
    ORDER BY id
  `));

  console.log('\n=== dbo.user_login_events (latest 20 login attempts) ===');
  console.table(await prisma.$queryRawUnsafe(`
    SELECT TOP 20 id, user_id, email_attempted, outcome, ip_address, occurred_at
    FROM dbo.user_login_events
    ORDER BY occurred_at DESC
  `));

  await prisma.$disconnect();
}

main().catch(async (err) => {
  console.error(err);
  await prisma.$disconnect();
  process.exit(1);
});
