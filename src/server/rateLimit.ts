import { db } from "./db.js";
import { HttpError } from "./httpError.js";

// Batas request per user per aksi (jendela waktu tetap), disimpan di database supaya berlaku
// di semua instance Vercel sekaligus. Baris lama dibersihkan oleh cron harian.
export async function rateLimit(action: string, subject: string, limit: number, windowMs: number) {
  const windowStart = Math.floor(Date.now() / windowMs) * windowMs;
  const key = `${action}:${subject}:${windowStart}`;
  const row = await db.rateLimit.upsert({
    where: { key },
    create: { key, count: 1, expiresAt: new Date(windowStart + windowMs) },
    update: { count: { increment: 1 } },
  });
  if (row.count > limit) throw new HttpError(429, "Too many requests. Please wait a moment and try again.");
}
