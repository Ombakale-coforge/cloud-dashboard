import { PrismaClient } from '@prisma/client';
import { PrismaMssql } from '@prisma/adapter-mssql';
import dotenv from 'dotenv';
import path from 'path';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

// Ensure .env is loaded before checking DATABASE_URL
dotenv.config({ path: path.resolve(__dirname, '../../.env') });
dotenv.config({ path: path.resolve(__dirname, '../../../.env') });

let prismaInstance: PrismaClient | null = null;

export function getPrismaClient(): PrismaClient | null {
  if (!prismaInstance) {
    const dbUrl = process.env.DATABASE_URL;
    if (dbUrl) {
      try {
        const adapter = new PrismaMssql(dbUrl);
        prismaInstance = new PrismaClient({ adapter });
        console.log('🗄️ [SQL Server] Connected Prisma Client for Cost Intelligence');
      } catch (dbInitErr: any) {
        console.error('❌ [SQL Server] Failed to initialize Prisma Client:', dbInitErr.message);
      }
    } else {
      console.warn('⚠️ [SQL Server] DATABASE_URL not found in environment.');
    }
  }
  return prismaInstance;
}

// Eager initialization on module load if DATABASE_URL is present
getPrismaClient();

// Proxy export for backwards compatibility with `prisma.model.method()`
export const prisma = new Proxy({} as PrismaClient, {
  get(target, prop) {
    const client = getPrismaClient();
    if (!client) {
      return undefined;
    }
    return (client as any)[prop];
  }
});

export default prisma;
