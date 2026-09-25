import { Router, type Request } from "express";
import { z } from "zod";
import { db } from "../db.js";
import { fetchBotGuildIds, fetchMember, fetchTextChannels, getGuildContext } from "../discord.js";
import { botInviteUrl, xEnabled } from "../env.js";
import { cancelRaffle, disqualifyEntry, endRaffle, publishRaffle } from "../raffle/service.js";
import { getXPosts, hasXTasks, MAX_FOLLOWS, MAX_POSTS, type XPost } from "../raffle/xtasks.js";
import { discordUserApi, requireAuth, type AuthUser } from "./auth.js";
import { rawImageBody, saveImage } from "./images.js";
import { buildXlsx, type Cell, type RowStyle } from "../xlsx.js";
import { ALLOCATIONS, allocationCount, CHAIN_IDS, CHAINS, hasAllocations } from "../../shared/raffle.js";

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
    raffles: raffles.map(({ _count, ...r }) => ({ ...r, xPosts: getXPosts(r), entryCount: _count.entries })),
  });
});

dashboardRouter.post("/guilds/:guildId/images", rawImageBody, async (req, res) => {
  const guildId = param(req, "guildId");
  const user = userOf(res);
  await requireManager(guildId, user.id);
  const result = await saveImage(req, guildId, user.id);
  if ("error" in result) throw new HttpError(400, result.error!);
  res.json(result);
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
  // Allocations: GTD dan/atau FCFS (0 = tidak dipakai), minimal salah satu.
  gtdCount: z.coerce.number().int("GTD must be a whole number").min(0).max(1000, "Maximum 1000 GTD").default(0),
  fcfsCount: z.coerce.number().int("FCFS must be a whole number").min(0).max(1000, "Maximum 1000 FCFS").default(0),
  chain: z.union([z.literal(""), z.enum(CHAIN_IDS)]).optional(),
  endsAt: z.coerce.date().refine((d) => d.getTime() > Date.now() + 60_000, "End time must be at least 1 minute from now"),
  requiredRoleIds: z.array(z.string()).default([]),
  minAccountAgeDays: z.coerce.number().int().min(0).max(3650).default(0),
  walletType: z.enum(["NONE", "EVM", "SOL"]).default("NONE"),
  winnerRoleId: z.string().optional(),
  mentionRoleIds: z.array(z.string()).max(20).default([]),
  // Task X: username boleh ditulis "@nama", "nama", atau link profil
  xFollowUsernames: z
    .array(
      z
        .string()
        .transform((s) => s.trim().replace(/^https?:\/\/(www\.)?(x|twitter)\.com\//i, "").replace(/^@/, "").split(/[/?]/)[0])
        .refine((s) => /^[A-Za-z0-9_]{1,15}$/.test(s), "Invalid X username"),
    )
    .max(MAX_FOLLOWS, `Maximum ${MAX_FOLLOWS} accounts to follow`)
    .default([]),
  // Tiap post: link (mis. https://x.com/nama/status/1234567890) + task yang dipilih
  xPosts: z
    .array(
      z.object({
        url: z.string().trim(),
        like: z.boolean().default(false),
        retweet: z.boolean().default(false),
        quote: z.boolean().default(false),
      }),
    )
    .max(MAX_POSTS, `Maximum ${MAX_POSTS} posts`)
    .default([]),
});

const discordAvatarUrl = (userId: string, hash: string | null) =>
  hash
    ? `https://cdn.discordapp.com/avatars/${userId}/${hash}.png?size=128`
    : `https://cdn.discordapp.com/embed/avatars/${Number((BigInt(userId) >> 22n) % 6n)}.png`;

const tweetIdFrom = (s: string) => s.match(/status(?:es)?\/(\d+)/)?.[1] ?? (/^\d+$/.test(s) ? s : null);

dashboardRouter.post("/guilds/:guildId/raffles", async (req, res) => {
  const guildId = param(req, "guildId");
  const user = userOf(res);
  const ctx = await requireManager(guildId, user.id);
  const parsed = createSchema.safeParse(req.body);
  if (!parsed.success) throw new HttpError(400, parsed.error.issues[0].message);
  const { imageUrl, winnerRoleId, xPosts: postInputs, chain, ...data } = parsed.data;
  const winnerCount = data.gtdCount + data.fcfsCount;
  if (winnerCount < 1) throw new HttpError(400, "Choose at least one allocation (GTD or FCFS) with 1 or more spots");
  if (winnerCount > 1000) throw new HttpError(400, "Maximum 1000 allocations in total");
  // Jenis wallet harus sesuai chain (Solana = wallet Solana, chain lain = EVM)
  if (chain && data.walletType !== "NONE" && data.walletType !== CHAINS[chain].wallet) {
    throw new HttpError(400, `${CHAINS[chain].label} uses ${CHAINS[chain].wallet === "SOL" ? "Solana" : "EVM"} wallets — change the wallet type.`);
  }
  const validRoles = new Set(ctx.roles.map((r) => r.id)); // termasuk @everyone (ID = guildId)
  data.mentionRoleIds = [...new Set(data.mentionRoleIds)].filter((id) => validRoles.has(id));

  const xPosts: XPost[] = [];
  for (const [i, p] of postInputs.entries()) {
    if (!p.url && !p.like && !p.retweet && !p.quote) continue; // baris kosong
    const tweetId = tweetIdFrom(p.url);
    if (!tweetId) throw new HttpError(400, `Post #${i + 1}: invalid X post link (e.g. https://x.com/name/status/123...)`);
    if (!p.like && !p.retweet && !p.quote) throw new HttpError(400, `Post #${i + 1}: choose at least one task (Like, Retweet or Quote)`);
    if (xPosts.some((x) => x.tweetId === tweetId)) throw new HttpError(400, `Post #${i + 1} is a duplicate`);
    xPosts.push({ tweetId, like: p.like, retweet: p.retweet, quote: p.quote });
  }
  // Form Discord maksimal 5 isian: link quote + wallet
  const formFields = xPosts.filter((p) => p.quote).length + (data.walletType !== "NONE" ? 1 : 0);
  if (formFields > 5) {
    throw new HttpError(400, "Too many Quote tasks: Quote posts + wallet can't be more than 5 in total.");
  }
  if ((data.xFollowUsernames.length || xPosts.length) && !xEnabled) {
    throw new HttpError(400, "X tasks are not enabled yet. The admin needs to set X_API_KEY and X_API_SECRET.");
  }

  const raffle = await db.raffle.create({
    data: {
      ...data,
      xFollowUsernames: [...new Set(data.xFollowUsernames)],
      xPosts,
      guildId,
      imageUrl: imageUrl || null,
      winnerRoleId: winnerRoleId || null,
      requireAnyRole: true,
      winnerCount,
      chain: chain || null,
      hostName: user.username,
      hostAvatar: discordAvatarUrl(user.id, user.avatar),
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
  res.json({
    raffle: { ...fresh, xPosts: getXPosts(fresh) },
    // Entry lama menyimpan 1 link quote di kolom tunggal
    entries: entries.map(({ xQuoteUrl, ...e }) => ({
      ...e,
      xQuoteUrls: e.xQuoteUrls.length ? e.xQuoteUrls : xQuoteUrl ? [xQuoteUrl] : [],
    })),
  });
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

dashboardRouter.post("/raffles/:id/entries/:entryId/disqualify", async (req, res) => {
  const raffle = await requireRaffle(param(req, "id"), userOf(res).id);
  const note = z.string().trim().max(200).catch("").parse(req.body?.note) || "Disqualified by admin";
  await disqualifyEntry(raffle.id, param(req, "entryId"), note);
  res.json({ ok: true });
});

// Export winner: hanya data yang dibutuhkan untuk kirim hadiah. Kolom X / wallet hanya ada kalau raffle-nya memakai itu.
// Export winner: hanya data untuk kirim hadiah. Kolom X / wallet hanya ada kalau raffle-nya memakai itu.
// Raffle dengan allocation: satu sheet berisi tabel GTD Winners lalu tabel FCFS Winners (bertumpuk).
dashboardRouter.get("/raffles/:id/winners.xlsx", async (req, res) => {
  const raffle = await requireRaffle(param(req, "id"), userOf(res).id);
  const winners = await db.entry.findMany({ where: { raffleId: raffle.id, status: "WON" }, orderBy: { createdAt: "asc" } });
  const withX = hasXTasks(raffle);
  const withWallet = raffle.walletType !== "NONE";
  const header = ["Discord ID", "Discord Username", ...(withX ? ["X Username"] : []), ...(withWallet ? ["Wallet"] : [])];
  const toRow = (e: (typeof winners)[number]): Cell[] => [
    e.userId,
    e.username,
    ...(withX ? [e.xUsername ? `@${e.xUsername}` : ""] : []),
    ...(withWallet ? [e.wallet] : []),
  ];
  const filename = `${raffle.title.replace(/[^\w-]+/g, "_").slice(0, 50)}_winners.xlsx`;
  res.setHeader("Content-Type", "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet");
  res.setHeader("Content-Disposition", `attachment; filename="${filename}"`);

  if (!hasAllocations(raffle)) {
    res.send(buildXlsx("Winners", [header, ...winners.map(toRow)]));
    return;
  }
  const rows: Cell[][] = [];
  const rowStyles: Record<number, RowStyle> = {};
  for (const a of ALLOCATIONS.filter((a) => allocationCount(raffle, a) > 0)) {
    const group = winners.filter((e) => e.allocation === a);
    if (rows.length) rows.push([]); // baris kosong pemisah tabel
    rowStyles[rows.length] = "title";
    rows.push([`${a} Winners (${group.length})`]);
    rowStyles[rows.length] = "header";
    rows.push(header);
    rows.push(...(group.length ? group.map(toRow) : [["No eligible entrants"]]));
  }
  res.send(buildXlsx("Winners", rows, { rowStyles }));
});
