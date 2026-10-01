import { PrismaClient } from '../../generated/prisma/client.mjs';
import { PrismaMssql } from '@prisma/adapter-mssql';

let prisma: PrismaClient | null = null;

if (process.env.DATABASE_URL) {
  try {
    const adapter = new PrismaMssql(process.env.DATABASE_URL);
    prisma = new PrismaClient({ adapter });
    console.log('🗄️ [SQL Server] Connected Prisma Client for Cost Intelligence');
  } catch (dbInitErr: any) {
    console.error('❌ [SQL Server] Failed to initialize Prisma Client:', dbInitErr.message);
  }
}

export { prisma };
