import { Router, type Request, type Response, type NextFunction } from "express";
import { db } from "../db.js";
import { fetchBotGuilds } from "../discord.js";
import { env } from "../env.js";
import { allocationSummary, chainLabel } from "../../shared/raffle.js";
import { currentUser } from "./auth.js";
import { HttpError } from "./dashboard.js";

// Halaman /admin: statistik pemakaian SkyBOT. Hanya untuk akun Discord yang ID-nya ada di env ADMIN_DISCORD_IDS
// (login Discord biasa). Tidak ada PIN yang bisa ditebak atau dipakai untuk mengunci pemilik.

// Contoh: ADMIN_DISCORD_IDS=123456789012345678,234567890123456789 (boleh pakai spasi setelah koma).
// ID Discord selalu 17–20 digit; isian lain diabaikan dan dicatat di log supaya mudah ditemukan.
function parseAdminIds(raw: string | undefined) {
  const parts = (raw ?? "").split(/[\s,;]+/).filter(Boolean);
  const valid = parts.filter((p) => /^\d{17,20}$/.test(p));
  const invalid = parts.filter((p) => !valid.includes(p));
  if (invalid.length) console.warn(`[admin] ignoring invalid ADMIN_DISCORD_IDS entries: ${invalid.join(", ")}`);
  return new Set(valid);
}
const ADMIN_IDS = parseAdminIds(env.ADMIN_DISCORD_IDS);
const adminIds = () => ADMIN_IDS;

async function requireAdmin(req: Request, _res: Response, next: NextFunction) {
  const user = await currentUser(req);
  // 404 (bukan 403) supaya halaman ini tidak terlihat ada bagi yang bukan admin
  if (!user || !adminIds().has(user.id)) throw new HttpError(404, "Not found");
  next();
}

export const adminRouter = Router();

adminRouter.get("/session", async (req, res) => {
  const user = await currentUser(req);
  res.json({ enabled: adminIds().size > 0, loggedIn: !!user, isAdmin: !!user && adminIds().has(user.id) });
});

adminRouter.get("/stats", requireAdmin, async (_req, res) => {
  // Semua user & raffle dikirim sekaligus (halaman admin membagi per halaman & mencari di browser)
  const [statusCounts, entryCount, winnerCount, users, raffleMeta, botGuilds] = await Promise.all([
    db.raffle.groupBy({ by: ["status"], _count: { _all: true } }),
    db.entry.count(),
    db.entry.count({ where: { status: "WON" } }),
    db.user.findMany({
      orderBy: [{ lastLoginAt: { sort: "desc", nulls: "last" } }, { createdAt: "desc" }],
      select: { id: true, username: true, avatar: true, createdAt: true, lastLoginAt: true },
    }),
    db.raffle.findMany({
      orderBy: { createdAt: "desc" },
      select: {
        id: true,
        title: true,
        guildId: true,
        guildName: true,
        hostName: true,
        status: true,
        chain: true,
        winnerCount: true,
        gtdCount: true,
        fcfsCount: true,
        createdById: true,
        createdAt: true,
        _count: { select: { entries: true } },
      },
    }),
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

  // Undian yang belum selesai / gagal (normalnya kosong; dilanjutkan otomatis)
  const attention = await db.raffle.findMany({
    where: { OR: [{ drawPending: true }, { announcePending: true }, { NOT: { drawError: null } }], status: "ENDED" },
    select: { id: true, title: true, guildId: true, guildName: true, endedAt: true, drawPending: true, announcePending: true, drawError: true },
    orderBy: { endedAt: "desc" },
    take: 50,
  });
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
    attention,
    communities,
    users: users.map((u) => ({
      id: u.id,
      username: u.username,
      avatar: u.avatar,
      firstLoginAt: u.createdAt,
      lastLoginAt: u.lastLoginAt,
      rafflesCreated: perCreator.get(u.id) ?? 0,
    })),
    raffles: raffleMeta.map((r) => ({
      id: r.id,
      title: r.title,
      guildId: r.guildId,
      guildName: names.get(r.guildId)?.name ?? r.guildName,
      hostName: r.hostName,
      status: r.status,
      allocations: allocationSummary(r),
      chain: chainLabel(r.chain),
      entries: r._count.entries,
      createdAt: r.createdAt,
    })),
  });
});
