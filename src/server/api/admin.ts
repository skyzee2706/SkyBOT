import { createHash, createHmac, timingSafeEqual } from "node:crypto";
import { Router, type Request, type Response, type NextFunction } from "express";
import { db } from "../db.js";
import { fetchBotGuilds } from "../discord.js";
import { env } from "../env.js";
import { allocationSummary, chainLabel } from "../../shared/raffle.js";
import { HttpError } from "./dashboard.js";

// Halaman /admin: statistik pemakaian SkyBOT. Login pakai PIN dari env ADMIN_PIN (bukan di kode,
// karena repo bisa dibaca orang lain). Tebakan PIN dibatasi per IP dan secara global.

const SESSION_MS = 12 * 3_600_000;
const WINDOW_MS = 15 * 60_000;
const MAX_FAILS_PER_IP = 5;
const MAX_FAILS_GLOBAL = 30; // total semua IP dalam 15 menit — menahan tebakan dari banyak IP sekaligus
const COOKIE = "admin";
const secure = env.PUBLIC_URL.startsWith("https://");

// Kunci ikut PIN: ganti ADMIN_PIN = semua sesi admin lama otomatis tidak berlaku
const sessionKey = () => createHmac("sha256", env.DISCORD_CLIENT_SECRET).update(`admin:${env.ADMIN_PIN}`).digest();
const sign = (exp: number) => createHmac("sha256", sessionKey()).update(String(exp)).digest("base64url");

function validSession(token: string | undefined) {
  const [exp, sig] = (token ?? "").split(".");
  if (!exp || !sig || Number(exp) < Date.now()) return false;
  const a = Buffer.from(sig, "base64url");
  const b = Buffer.from(sign(Number(exp)), "base64url");
  return a.length === b.length && timingSafeEqual(a, b);
}

const sha = (s: string) => createHash("sha256").update(s).digest();
const pinMatches = (pin: string) => timingSafeEqual(sha(pin), sha(env.ADMIN_PIN!));

function requireEnabled() {
  if (!env.ADMIN_PIN) throw new HttpError(503, "The admin page is disabled. Set ADMIN_PIN in Vercel to enable it.");
}

function requireAdmin(req: Request, _res: Response, next: NextFunction) {
  requireEnabled();
  if (!validSession(req.cookies[COOKIE])) throw new HttpError(401, "Please enter the PIN.");
  next();
}

export const adminRouter = Router();

adminRouter.get("/session", (req, res) => {
  res.json({ enabled: !!env.ADMIN_PIN, loggedIn: !!env.ADMIN_PIN && validSession(req.cookies[COOKIE]) });
});

adminRouter.post("/login", async (req, res) => {
  requireEnabled();
  const ip = req.ip ?? "unknown";
  const since = new Date(Date.now() - WINDOW_MS);
  await db.adminAttempt.deleteMany({ where: { createdAt: { lt: new Date(Date.now() - 86_400_000) } } });
  const [ipFails, allFails] = await Promise.all([
    db.adminAttempt.count({ where: { ip, ok: false, createdAt: { gte: since } } }),
    db.adminAttempt.count({ where: { ok: false, createdAt: { gte: since } } }),
  ]);
  if (ipFails >= MAX_FAILS_PER_IP || allFails >= MAX_FAILS_GLOBAL) {
    throw new HttpError(429, "Too many wrong PINs. Try again in 15 minutes.");
  }

  const pin = typeof req.body?.pin === "string" ? req.body.pin.trim() : "";
  const ok = pin.length > 0 && pinMatches(pin);
  await db.adminAttempt.create({ data: { ip, ok } });
  if (!ok) {
    const left = MAX_FAILS_PER_IP - ipFails - 1;
    throw new HttpError(401, left > 0 ? `Wrong PIN. ${left} attempt${left === 1 ? "" : "s"} left.` : "Wrong PIN. Locked for 15 minutes.");
  }

  const exp = Date.now() + SESSION_MS;
  res.cookie(COOKIE, `${exp}.${sign(exp)}`, { httpOnly: true, sameSite: "strict", secure, path: "/api/admin", expires: new Date(exp) });
  res.json({ ok: true });
});

adminRouter.post("/logout", (_req, res) => {
  res.clearCookie(COOKIE, { path: "/api/admin" });
  res.json({ ok: true });
});

adminRouter.get("/stats", requireAdmin, async (_req, res) => {
  const [statusCounts, entryCount, winnerCount, users, raffleMeta, recent, botGuilds] = await Promise.all([
    db.raffle.groupBy({ by: ["status"], _count: { _all: true } }),
    db.entry.count(),
    db.entry.count({ where: { status: "WON" } }),
    db.user.findMany({ orderBy: [{ lastLoginAt: { sort: "desc", nulls: "last" } }, { createdAt: "desc" }], take: 1000 }),
    db.raffle.findMany({
      select: { guildId: true, createdById: true, createdAt: true, _count: { select: { entries: true } } },
    }),
    db.raffle.findMany({ orderBy: { createdAt: "desc" }, take: 50, include: { _count: { select: { entries: true } } } }),
    fetchBotGuilds().catch((e) => {
      console.error("[admin] failed to fetch bot guilds", e);
      return null;
    }),
  ]);

  // Per komunitas: jumlah raffle, total peserta, raffle terakhir
  const perGuild = new Map<string, { raffles: number; entries: number; lastRaffleAt: Date }>();
  const perCreator = new Map<string, number>();
  for (const r of raffleMeta) {
    const g = perGuild.get(r.guildId) ?? { raffles: 0, entries: 0, lastRaffleAt: r.createdAt };
    g.raffles++;
    g.entries += r._count.entries;
    if (r.createdAt > g.lastRaffleAt) g.lastRaffleAt = r.createdAt;
    perGuild.set(r.guildId, g);
    perCreator.set(r.createdById, (perCreator.get(r.createdById) ?? 0) + 1);
  }

  const botGuildIds = new Set(botGuilds?.map((g) => g.id) ?? []);
  const names = new Map(botGuilds?.map((g) => [g.id, g] as const) ?? []);
  const communityIds = new Set([...botGuildIds, ...perGuild.keys()]);
  const communities = [...communityIds]
    .map((id) => {
      const g = names.get(id);
      const s = perGuild.get(id);
      return {
        id,
        name: g?.name ?? null,
        icon: g?.icon ?? null,
        // null = daftar server bot gagal diambil, jadi status tidak diketahui
        botPresent: botGuilds ? botGuildIds.has(id) : null,
        raffles: s?.raffles ?? 0,
        entries: s?.entries ?? 0,
        lastRaffleAt: s?.lastRaffleAt ?? null,
      };
    })
    .sort((a, b) => b.raffles - a.raffles || (a.name ?? "").localeCompare(b.name ?? ""));

  const byStatus = Object.fromEntries(statusCounts.map((s) => [s.status, s._count._all]));
  res.json({
    totals: {
      raffles: raffleMeta.length,
      active: byStatus.ACTIVE ?? 0,
      ended: byStatus.ENDED ?? 0,
      cancelled: byStatus.CANCELLED ?? 0,
      entries: entryCount,
      winners: winnerCount,
      users: users.length,
      creators: perCreator.size,
      communities: botGuilds ? botGuilds.length : null,
      communitiesWithRaffles: perGuild.size,
    },
    communities,
    users: users.map((u) => ({
      id: u.id,
      username: u.username,
      avatar: u.avatar,
      firstLoginAt: u.createdAt,
      lastLoginAt: u.lastLoginAt,
      rafflesCreated: perCreator.get(u.id) ?? 0,
    })),
    recentRaffles: recent.map((r) => ({
      id: r.id,
      title: r.title,
      guildId: r.guildId,
      guildName: names.get(r.guildId)?.name ?? null,
      hostName: r.hostName,
      status: r.status,
      allocations: allocationSummary(r),
      chain: chainLabel(r.chain),
      entries: r._count.entries,
      createdAt: r.createdAt,
    })),
  });
});
