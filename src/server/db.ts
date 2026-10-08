import { Prisma, PrismaClient } from "@prisma/client";

const globalForPrisma = globalThis as unknown as { prisma?: PrismaClient };

export function database(): PrismaClient {
  if (!process.env.DATABASE_URL) throw new Error("DATABASE_URL is required.");
  if (!globalForPrisma.prisma) globalForPrisma.prisma = new PrismaClient();
  return globalForPrisma.prisma;
}

export function transaction<T>(action: (client: Prisma.TransactionClient) => Promise<T>): Promise<T> {
  return database().$transaction(action);
}

export function isUuid(value: string): boolean {
  return /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(value);
}
