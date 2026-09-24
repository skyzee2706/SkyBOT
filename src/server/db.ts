import { Prisma, PrismaClient } from "@prisma/client";

// Neon mematikan compute saat idle; koneksi pertama setelahnya kadang putus.
// Ulangi sekali untuk error koneksi supaya user tidak kena error acak.
const RETRYABLE = new Set(["P1001", "P1002", "P1017", "P2024"]);

export const db = new PrismaClient().$extends({
  query: {
    async $allOperations({ args, query }) {
      try {
        return await query(args);
      } catch (e) {
        if (e instanceof Prisma.PrismaClientKnownRequestError && RETRYABLE.has(e.code)) {
          await new Promise((r) => setTimeout(r, 500));
          return await query(args);
        }
        throw e;
      }
    },
  },
});

export const isUniqueViolation = (e: unknown) =>
  e instanceof Prisma.PrismaClientKnownRequestError && e.code === "P2002";

export const uniqueTarget = (e: unknown): string[] => {
  if (!(e instanceof Prisma.PrismaClientKnownRequestError)) return [];
  const t = e.meta?.target;
  return Array.isArray(t) ? t.map(String) : typeof t === "string" ? [t] : [];
};
