import { db } from "./db.js";

const DAY = 86_400_000;

// Bersih-bersih harian (dipanggil cron /api/cron/sweep):
// - sesi login & sisa login X yang sudah kedaluwarsa
// - batas request (RateLimit) yang jendelanya sudah lewat
// - gambar upload yang tidak dipakai raffle mana pun (mis. diganti / raffle gagal dibuat), setelah 2 hari
export async function cleanupData() {
  const now = new Date();
  const [sessions, xStates, rateLimits] = await Promise.all([
    db.session.deleteMany({ where: { expiresAt: { lt: now } } }),
    db.xAuthState.deleteMany({ where: { createdAt: { lt: new Date(now.getTime() - DAY) } } }),
    db.rateLimit.deleteMany({ where: { expiresAt: { lt: now } } }),
  ]);

  const used = new Set(
    (await db.raffle.findMany({ where: { imageUrl: { contains: "/api/images/" } }, select: { imageUrl: true } }))
      .map((r) => r.imageUrl?.match(/\/api\/images\/([a-z0-9]+)/i)?.[1])
      .filter((id): id is string => !!id),
  );
  const old = await db.image.findMany({ where: { createdAt: { lt: new Date(now.getTime() - 2 * DAY) } }, select: { id: true } });
  const unused = old.map((i) => i.id).filter((id) => !used.has(id));
  const images = unused.length ? await db.image.deleteMany({ where: { id: { in: unused } } }) : { count: 0 };

  return { sessions: sessions.count, xStates: xStates.count, rateLimits: rateLimits.count, images: images.count };
}
