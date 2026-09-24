import { Router, type Request } from "express";
import { z } from "zod";
import { db } from "../db.js";
import { fetchBotGuildIds, fetchMember, fetchTextChannels, getGuildContext } from "../discord.js";
import { botInviteUrl, xEnabled } from "../env.js";
import { cancelRaffle, disqualifyEntry, endRaffle, publishRaffle, rerollRaffle } from "../raffle/service.js";
import { discordUserApi, requireAuth, type AuthUser } from "./auth.js";

export class HttpError extends Error {
  constructor(public status: number, message: string) {
    super(message);
  }
}

const userOf = (res: { locals: Record<string, unknown> }) => res.locals.user as AuthUser;
const param = (req: Request, name: string) => String(req.params[name]);

const getManagerRoleIds = async (guildId: string) =>
  (await db.guildSettings.findUnique({ where: { guildId } }))?.managerRoleIds ?? [];

// Boleh kelola raffle: Owner / Administrator / Manage Server, ATAU punya salah satu "role pengelola" (mis. @CM).
async function requireManager(guildId: string, userId: string) {
  const [ctx, managerRoleIds] = await Promise.all([getGuildContext(guildId, userId), getManagerRoleIds(guildId)]);
  if (!ctx) throw new HttpError(404, "The bot is not in this server.");
  const hasManagerRole = !!ctx.memberRoleIds?.some((id) => managerRoleIds.includes(id));
  if (!ctx.isAdmin && !hasManagerRole) {
    throw new HttpError(403, "You don't have access. Ask an admin to add your role as a raffle manager.");
  }
  return { ...ctx, managerRoleIds };
}

async function requireAdmin(guildId: string, userId: string) {
  const ctx = await requireManager(guildId, userId);
  if (!ctx.isAdmin) throw new HttpError(403, "Only admins (Manage Server) can change this setting.");
  return ctx;
}

async function requireRaffle(raffleId: string, userId: string) {
  const raffle = await db.raffle.findUnique({ where: { id: raffleId } });
  if (!raffle) throw new HttpError(404, "Raffle not found.");
  await requireManager(raffle.guildId, userId);
  return raffle;
}

// Cache daftar server per user (endpoint Discord ini rate limit-nya ketat).
const guildListCache = new Map<string, { at: number; data: unknown }>();
const MANAGE_BITS = 0x8n | 0x20n; // Administrator | Manage Server

export const dashboardRouter = Router();
dashboardRouter.use(requireAuth);

dashboardRouter.get("/me", (_req, res) => {
  const { id, username, avatar } = userOf(res);
  res.json({ id, username, avatar });
});

dashboardRouter.get("/guilds", async (_req, res) => {
  const user = userOf(res);
  const cached = guildListCache.get(user.id);
  if (cached && Date.now() - cached.at < 60_000) {
    res.json(cached.data);
    return;
  }
  const [userGuilds, botGuilds] = await Promise.all([
    discordUserApi<{ id: string; name: string; icon: string | null; owner: boolean; permissions: string }[]>(
      "/users/@me/guilds",
      user.accessToken,
    ),
    fetchBotGuildIds(),
  ]);
  const isAdminOf = (g: (typeof userGuilds)[number]) => g.owner || (BigInt(g.permissions) & MANAGE_BITS) !== 0n;

  // Server tempat user bukan admin tapi mungkin punya role pengelola
  const candidates = userGuilds.filter((g) => !isAdminOf(g) && botGuilds.has(g.id));
  const settings = candidates.length
    ? await db.guildSettings.findMany({
        where: { guildId: { in: candidates.map((g) => g.id) }, NOT: { managerRoleIds: { isEmpty: true } } },
      })
    : [];
  const managed = new Set<string>();
  await Promise.all(
    settings.map(async (s) => {
      const member = await fetchMember(s.guildId, user.id);
      if (member?.roles.some((id) => s.managerRoleIds.includes(id))) managed.add(s.guildId);
    }),
  );

  const data = userGuilds
    .filter((g) => isAdminOf(g) || managed.has(g.id))
    .map((g) => ({
      id: g.id,
      name: g.name,
      icon: g.icon,
      botPresent: botGuilds.has(g.id),
      inviteUrl: botInviteUrl(g.id),
    }))
    .sort((a, b) => Number(b.botPresent) - Number(a.botPresent) || a.name.localeCompare(b.name));
  guildListCache.set(user.id, { at: Date.now(), data });
  res.json(data);
});

dashboardRouter.get("/guilds/:guildId", async (req, res) => {
  const guildId = param(req, "guildId");
  const ctx = await requireManager(guildId, userOf(res).id);
  const [channels, raffles] = await Promise.all([
    fetchTextChannels(guildId),
    db.raffle.findMany({
      where: { guildId },
      orderBy: { createdAt: "desc" },
      take: 100,
      include: { _count: { select: { entries: true } } },
    }),
  ]);
  res.json({
    guild: { id: ctx.guild.id, name: ctx.guild.name, icon: ctx.guild.icon },
    isAdmin: ctx.isAdmin,
    managerRoleIds: ctx.managerRoleIds,
    xEnabled,
    channels,
    roles: ctx.roles
      .filter((r) => r.id !== guildId)
      .sort((a, b) => b.position - a.position)
      .map((r) => ({
        id: r.id,
        name: r.name,
        color: r.color,
        // Bot hanya bisa memberi role yang posisinya di bawah role bot
        assignable: !r.managed && r.position < ctx.botTopPosition,
      })),
    raffles: raffles.map(({ _count, ...r }) => ({ ...r, entryCount: _count.entries })),
  });
});

dashboardRouter.put("/guilds/:guildId/settings", async (req, res) => {
  const guildId = param(req, "guildId");
  const ctx = await requireAdmin(guildId, userOf(res).id);
  const valid = new Set(ctx.roles.map((r) => r.id));
  const managerRoleIds = z
    .array(z.string())
    .max(20)
    .catch([])
    .parse(req.body?.managerRoleIds)
    .filter((id) => valid.has(id) && id !== guildId); // @everyone tidak boleh jadi pengelola
  await db.guildSettings.upsert({
    where: { guildId },
    create: { guildId, managerRoleIds },
    update: { managerRoleIds },
  });
  res.json({ managerRoleIds });
});

const createSchema = z.object({
  channelId: z.string().min(1, "Please choose a channel"),
  title: z.string().trim().min(1, "Title is required").max(200),
  description: z.string().max(3000).default(""),
  imageUrl: z.union([z.literal(""), z.string().url("Invalid image URL")]).optional(),
  winnerCount: z.coerce.number().int().min(1, "At least 1 winner").max(1000),
  endsAt: z.coerce.date().refine((d) => d.getTime() > Date.now() + 60_000, "End time must be at least 1 minute from now"),
  requiredRoleIds: z.array(z.string()).default([]),
  blockedRoleIds: z.array(z.string()).default([]),
  minAccountAgeDays: z.coerce.number().int().min(0).max(3650).default(0),
  walletType: z.enum(["NONE", "EVM", "SOL"]).default("NONE"),
  winnerRoleId: z.string().optional(),
  // Task X: username boleh ditulis "@nama", "nama", atau link profil
  xFollowUsernames: z
    .array(
      z
        .string()
        .transform((s) => s.trim().replace(/^https?:\/\/(www\.)?(x|twitter)\.com\//i, "").replace(/^@/, "").split(/[/?]/)[0])
        .refine((s) => /^[A-Za-z0-9_]{1,15}$/.test(s), "Invalid X username"),
    )
    .max(5, "Maximum 5 accounts to follow")
    .default([]),
  // Link post X, mis. https://x.com/nama/status/1234567890
  xTweetUrl: z.string().trim().default(""),
  xLike: z.boolean().default(false),
  xRetweet: z.boolean().default(false),
  xQuote: z.boolean().default(false),
});

dashboardRouter.post("/guilds/:guildId/raffles", async (req, res) => {
  const guildId = param(req, "guildId");
  const user = userOf(res);
  await requireManager(guildId, user.id);
  const parsed = createSchema.safeParse(req.body);
  if (!parsed.success) throw new HttpError(400, parsed.error.issues[0].message);
  const { imageUrl, winnerRoleId, xTweetUrl, ...data } = parsed.data;

  let xTweetId: string | null = null;
  if (data.xLike || data.xRetweet || data.xQuote) {
    xTweetId = xTweetUrl.match(/status(?:es)?\/(\d+)/)?.[1] ?? (/^\d+$/.test(xTweetUrl) ? xTweetUrl : null);
    if (!xTweetId) throw new HttpError(400, "Invalid X post link (e.g. https://x.com/name/status/123...)");
  }
  if ((data.xFollowUsernames.length || xTweetId) && !xEnabled) {
    throw new HttpError(400, "X tasks are not enabled yet. The admin needs to set X_API_KEY and X_API_SECRET.");
  }

  const raffle = await db.raffle.create({
    data: {
      ...data,
      xFollowUsernames: [...new Set(data.xFollowUsernames)],
      xTweetId,
      guildId,
      imageUrl: imageUrl || null,
      winnerRoleId: winnerRoleId || null,
      createdById: user.id,
    },
  });
  try {
    res.json(await publishRaffle(raffle));
  } catch (e) {
    await db.raffle.delete({ where: { id: raffle.id } });
    console.error("[raffle] publish failed", e);
    throw new HttpError(400, "The bot couldn't post in that channel. Make sure it can view the channel and send messages there.");
  }
});

dashboardRouter.get("/raffles/:id", async (req, res) => {
  const raffle = await requireRaffle(param(req, "id"), userOf(res).id);
  if (raffle.status === "ACTIVE" && raffle.endsAt.getTime() <= Date.now()) await endRaffle(raffle.id);
  const [fresh, entries] = await Promise.all([
    db.raffle.findUniqueOrThrow({ where: { id: raffle.id } }),
    db.entry.findMany({ where: { raffleId: raffle.id }, orderBy: { createdAt: "asc" } }),
  ]);
  res.json({ raffle: fresh, entries });
});

dashboardRouter.post("/raffles/:id/end", async (req, res) => {
  const raffle = await requireRaffle(param(req, "id"), userOf(res).id);
  if (!(await endRaffle(raffle.id))) throw new HttpError(400, "This raffle is no longer active.");
  res.json({ ok: true });
});

dashboardRouter.post("/raffles/:id/cancel", async (req, res) => {
  const raffle = await requireRaffle(param(req, "id"), userOf(res).id);
  await cancelRaffle(raffle.id);
  res.json({ ok: true });
});

dashboardRouter.post("/raffles/:id/reroll", async (req, res) => {
  const raffle = await requireRaffle(param(req, "id"), userOf(res).id);
  const count = z.coerce.number().int().min(1).max(100).catch(1).parse(req.body?.count);
  if (raffle.status !== "ENDED") throw new HttpError(400, "Reroll is only available for ended raffles.");
  res.json({ winners: await rerollRaffle(raffle.id, count) });
});

dashboardRouter.post("/raffles/:id/entries/:entryId/disqualify", async (req, res) => {
  const raffle = await requireRaffle(param(req, "id"), userOf(res).id);
  const note = z.string().trim().max(200).catch("").parse(req.body?.note) || "Disqualified by admin";
  await disqualifyEntry(raffle.id, param(req, "entryId"), note);
  res.json({ ok: true });
});

const csvCell = (v: unknown) => {
  const s = v == null ? "" : String(v);
  // Cegah formula injection saat dibuka di Excel/Sheets
  const safe = /^[=+\-@]/.test(s) ? `'${s}` : s;
  return /[",\n]/.test(safe) ? `"${safe.replace(/"/g, '""')}"` : safe;
};

dashboardRouter.get("/raffles/:id/export.csv", async (req, res) => {
  const raffle = await requireRaffle(param(req, "id"), userOf(res).id);
  const onlyWinners = req.query.winners === "1";
  const entries = await db.entry.findMany({
    where: { raffleId: raffle.id, ...(onlyWinners ? { status: "WON" } : {}) },
    orderBy: { createdAt: "asc" },
  });
  const rows = [
    ["discord_id", "username", "x_username", "x_quote_url", "wallet", "status", "note", "entered_at"],
    ...entries.map((e) => [
      e.userId,
      e.username,
      e.xUsername,
      e.xQuoteUrl,
      e.wallet,
      e.status,
      e.note,
      e.createdAt.toISOString(),
    ]),
  ];
  const filename = `${raffle.title.replace(/[^\w-]+/g, "_").slice(0, 50)}${onlyWinners ? "_winners" : "_entries"}.csv`;
  res.setHeader("Content-Type", "text/csv; charset=utf-8");
  res.setHeader("Content-Disposition", `attachment; filename="${filename}"`);
  res.send("﻿" + rows.map((r) => r.map(csvCell).join(",")).join("\n"));
});
