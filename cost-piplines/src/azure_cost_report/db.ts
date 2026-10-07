import { PrismaMssql } from '@prisma/adapter-mssql';
import { PrismaClient } from '@prisma/client';
import {
    DATABASE_URL,
    REQUEST_TIMEOUT_MS,
    CONNECTION_TIMEOUT_MS,
    parseSqlServerUrl,
} from './config';

let prismaInstance: PrismaClient | null = null;

export function getPrismaClient(): PrismaClient {
    if (!prismaInstance) {
        const adapter = new PrismaMssql({
            ...parseSqlServerUrl(DATABASE_URL),
            requestTimeout: REQUEST_TIMEOUT_MS,
            connectionTimeout: CONNECTION_TIMEOUT_MS,
        });
        prismaInstance = new PrismaClient({ adapter });
    }
    return prismaInstance;
}

export async function disconnectDb(): Promise<void> {
    if (prismaInstance) {
        await prismaInstance.$disconnect();
        prismaInstance = null;
    }
}
