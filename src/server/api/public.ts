import { Router, type Request } from "express";
import { Routes, type APIGuild } from "discord.js";
import type { Prisma, Raffle } from "@prisma/client";
import { z } from "zod";
import { db } from "../db.js";
import { fetchMember, isDiscordError, rest } from "../discord.js";
import { connectXUrl, taskClickUrl } from "../x.js";
import { endRaffle, enterRaffle, type Reply } from "../raffle/service.js";
import { checkRequirements } from "../raffle/requirements.js";
import { hasXTasks, quotePosts, xTaskList } from "../raffle/xtasks.js";
import { allocationSummary, CHAIN_IDS, chainLabel, discordAvatarUrl, isChainId, publicRafflePath } from "../../shared/raffle.js";
import { currentUser } from "./auth.js";
import { canManageGuild, HttpError } from "./dashboard.js";

// Halaman raffle publik (/raffle/:id): siapa pun bisa melihat, peserta bisa ikut lewat web
// dengan aturan yang sama persis seperti tombol Enter di Discord.

type GuildInfo = { name: string; icon: string | null; roles: Map<string, { name: string; color: number }> };

// Info server (nama, ikon, nama role) di-cache sebentar supaya tidak memanggil Discord tiap kali halaman dibuka
const guildCache = new Map<string, { at: number; info: GuildInfo | null }>();
async function guildInfo(guildId: string): Promise<GuildInfo | null> {
  const hit = guildCache.get(guildId);
  if (hit && Date.now() - hit.at < 60_000) return hit.info;
  let info: GuildInfo | null = null;
  try {
    const g = (await rest.get(Routes.guild(guildId))) as APIGuild;
    info = { name: g.name, icon: g.icon, roles: new Map(g.roles.map((r) => [r.id, { name: r.name, color: r.color }])) };
  } catch (e) {
    if (!isDiscordError(e)) throw e; // bot sudah dikeluarkan dari server
  }
  guildCache.set(guildId, { at: Date.now(), info });
  return info;
}

// Pesan dari logika bot memakai format Discord (**tebal**, `kode`, <@&role>) — ubah jadi teks biasa untuk web
function plainText(reply: Reply, guild: GuildInfo | null) {
  const text = typeof reply === "string" ? reply : reply.content;
  return text
    .replace(/<@&(\d+)>/g, (_, id) => `@${guild?.roles.get(id)?.name ?? "role"}`)
    .replace(/\*\*|`/g, "");
}

async function loadRaffle(req: Request) {
  const raffle = await db.raffle.findUnique({ where: { id: String(req.params.id) } });
  if (!raffle) throw new HttpError(404, "Raffle not found.");
  // Raffle yang waktunya sudah lewat langsung diundi (jaring pengaman kalau jadwal terlambat)
  if (raffle.status === "ACTIVE" && raffle.endsAt.getTime() <= Date.now()) {
    await endRaffle(raffle.id);
    return db.raffle.findUniqueOrThrow({ where: { id: raffle.id } });
  }
  return raffle;
}

export const publicRouter = Router();

const PAGE_SIZE = 24;

// Angka ringkas untuk landing page (tanpa data pribadi), di-cache 1 menit
let statsCache: { at: number; data: unknown } | null = null;
publicRouter.get("/stats", async (_req, res) => {
  if (!statsCache || Date.now() - statsCache.at > 60_000) {
    const now = new Date();
    const [raffles, live, entries, winners, communities] = await Promise.all([
      db.raffle.count({ where: { status: { not: "CANCELLED" } } }),
      db.raffle.count({ where: { status: "ACTIVE", endsAt: { gt: now } } }),
      db.entry.count(),
      db.entry.count({ where: { status: "WON" } }),
      db.raffle.findMany({ distinct: ["guildId"], select: { guildId: true } }).then((r) => r.length),
    ]);
    statsCache = { at: Date.now(), data: { raffles, live, entries, winners, communities } };
  }
  res.json(statsCache.data);
});
const guildIconUrl = (id: string, icon: string | null) => (icon ? `https://cdn.discordapp.com/icons/${id}/${icon}.png?size=64` : null);

// Daftar raffle publik: ?status=live (sedang berjalan, yang paling cepat berakhir dulu) atau ended (terbaru dulu).
// Raffle yang dibatalkan tidak ditampilkan.
const listQuery = z.object({
  status: z.enum(["live", "ended"]).catch("live"),
  page: z.coerce.number().int().min(0).max(1000).catch(0),
  q: z.string().trim().max(80).catch(""),
  chain: z.string().max(40).catch(""), // ID chain dari daftar, atau "OTHER" untuk chain manual
  open: z.enum(["1", ""]).catch(""), // 1 = hanya raffle yang tidak wajib join server
  alloc: z.enum(["gtd", "fcfs", ""]).catch(""),
  sort: z.enum(["ending", "newest", "popular", "odds", ""]).catch(""),
});

// Daftar raffle publik dengan filter untuk pemburu WL. Raffle yang dibatalkan tidak ditampilkan.
publicRouter.get("/raffles", async (req, res) => {
  const f = listQuery.parse(req.query);
  const live = f.status === "live";
  const sort = f.sort || (live ? "ending" : "newest");
  const now = new Date();
  const where: Prisma.RaffleWhereInput = {
    ...(live ? { status: "ACTIVE", endsAt: { gt: now } } : { status: "ENDED" }),
    ...(f.q
      ? { OR: [{ title: { contains: f.q, mode: "insensitive" } }, { guildName: { contains: f.q, mode: "insensitive" } }] }
      : {}),
    ...(f.chain === "OTHER"
      ? { chain: { notIn: CHAIN_IDS }, NOT: { chain: null } }
      : isChainId(f.chain)
        ? { chain: f.chain }
        : {}),
    ...(f.open ? { requireMember: false } : {}),
    ...(f.alloc === "gtd" ? { gtdCount: { gt: 0 } } : f.alloc === "fcfs" ? { fcfsCount: { gt: 0 } } : {}),
  };
  const include = { _count: { select: { entries: true } } } as const;

  let raffles: (Raffle & { _count: { entries: number } })[];
  let total: number;
  if (sort === "odds") {
    // Peluang terbaik = jumlah spot dibanding jumlah peserta; dihitung di memori (maks 1000 raffle)
    const all = await db.raffle.findMany({ where, include, take: 1000, orderBy: { endsAt: "asc" } });
    const odds = (r: (typeof all)[number]) => r.winnerCount / Math.max(1, r._count.entries);
    all.sort((a, b) => odds(b) - odds(a));
    total = all.length;
    raffles = all.slice(f.page * PAGE_SIZE, (f.page + 1) * PAGE_SIZE);
  } else {
    const orderBy: Prisma.RaffleOrderByWithRelationInput[] =
      sort === "popular"
        ? [{ entries: { _count: "desc" } }, { endsAt: "asc" }]
        : sort === "newest"
          ? live
            ? [{ createdAt: "desc" }]
            : [{ endedAt: "desc" }]
          : [{ endsAt: live ? "asc" : "desc" }];
    [raffles, total] = await Promise.all([
      db.raffle.findMany({ where, orderBy, skip: f.page * PAGE_SIZE, take: PAGE_SIZE, include }),
      db.raffle.count({ where }),
    ]);
  }

  const cards = await toCards(raffles);
  res.json({ total, pageSize: PAGE_SIZE, raffles: cards });
});

// Data kartu raffle (daftar publik & "My entries")
async function toCards(raffles: (Raffle & { _count: { entries: number } })[]) {
  // Raffle lama belum menyimpan nama server: ambil sekali dari Discord lalu simpan
  const missing = [...new Set(raffles.filter((r) => !r.guildName).map((r) => r.guildId))];
  const fetched = new Map<string, GuildInfo | null>();
  await Promise.all(
    missing.map(async (id) => {
      const info = await guildInfo(id).catch(() => null);
      fetched.set(id, info);
      if (info) await db.raffle.updateMany({ where: { guildId: id, guildName: null }, data: { guildName: info.name, guildIcon: info.icon } });
    }),
  );
  return raffles.map((r) => {
    const name = r.guildName ?? fetched.get(r.guildId)?.name ?? null;
    const icon = r.guildName ? r.guildIcon : (fetched.get(r.guildId)?.icon ?? null);
    return {
      id: r.id,
      title: r.title,
      imageUrl: r.imageUrl,
      status: r.status,
      endsAt: r.endsAt,
      endedAt: r.endedAt,
      hostName: r.hostName,
      hostAvatar: r.hostAvatar,
      chain: chainLabel(r.chain),
      allocations: allocationSummary(r),
      spots: r.winnerCount,
      requireMember: r.requireMember,
      entryCount: r._count.entries,
      guild: { name, icon: guildIconUrl(r.guildId, icon) },
    };
  });
}

// Raffle yang pernah diikuti user yang login, beserta hasilnya
publicRouter.get("/me/entries", async (req, res) => {
  const user = await currentUser(req);
  if (!user) throw new HttpError(401, "Log in with Discord to see your entries.");
  // Per halaman 10 raffle; ?page= mulai dari 1
  const size = 10;
  const page = Math.max(1, Math.min(10_000, Number(req.query.page) || 1));
  const mine = { userId: user.id };
  const [entries, total, won, live] = await Promise.all([
    db.entry.findMany({
      where: mine,
      orderBy: { createdAt: "desc" },
      skip: (page - 1) * size,
      take: size,
      include: { raffle: { include: { _count: { select: { entries: true } } } } },
    }),
    db.entry.count({ where: mine }),
    db.entry.count({ where: { ...mine, status: "WON" } }),
    db.entry.count({ where: { ...mine, status: "ENTERED", raffle: { status: "ACTIVE", endsAt: { gt: new Date() } } } }),
  ]);
  const cards = await toCards(entries.map((e) => e.raffle));
  res.json({
    total,
    page,
    pageSize: size,
    totalPages: Math.max(1, Math.ceil(total / size)),
    // Ringkasan dihitung dari SEMUA entry, bukan hanya halaman ini
    summary: { entered: total, live, won },
    entries: entries.map((e, i) => ({
      enteredAt: e.createdAt,
      status: e.status,
      allocation: e.allocation,
      raffle: cards[i],
    })),
  });
});

// Daftar peserta publik: hanya username + foto Discord (+ tanda pemenang). Wallet, X & link quote hanya untuk host.
publicRouter.get("/raffles/:id/entries", async (req, res) => {
  const raffle = await db.raffle.findUnique({ where: { id: String(req.params.id) }, select: { id: true, status: true } });
  if (!raffle) throw new HttpError(404, "Raffle not found.");
  const page = Math.max(0, Math.min(10_000, Number(req.query.page) || 0));
  const size = 100;
  const select = { id: true, userId: true, username: true, avatar: true, status: true, allocation: true } as const;
  // Setelah undian: semua pemenang tampil paling atas di halaman pertama (GTD dulu, lalu FCFS),
  // peserta lain di bawahnya urut waktu ikut. Sebelum undian: semua urut waktu ikut.
  const ended = raffle.status === "ENDED";
  const [winners, others, total] = await Promise.all([
    ended && page === 0
      ? db.entry.findMany({ where: { raffleId: raffle.id, status: "WON" }, orderBy: [{ allocation: "asc" }, { createdAt: "asc" }], select })
      : Promise.resolve([]),
    db.entry.findMany({
      where: { raffleId: raffle.id, ...(ended ? { status: { not: "WON" as const } } : {}) },
      orderBy: { createdAt: "asc" },
      skip: page * size,
      take: size,
      select,
    }),
    db.entry.count({ where: { raffleId: raffle.id } }),
  ]);
  const entries = [...winners, ...others];
  res.json({
    total,
    hasMore: others.length === size, // halaman penuh = mungkin masih ada lanjutannya
    entries: entries.map((e) => ({
      id: e.id,
      username: e.username,
      avatarUrl: discordAvatarUrl(e.userId, e.avatar),
      winner: e.status === "WON" ? (e.allocation ?? "WINNER") : null,
    })),
  });
});

publicRouter.get("/raffles/:id", async (req, res) => {
  const raffle = await loadRaffle(req);
  const [guild, entryCount, user] = await Promise.all([
    guildInfo(raffle.guildId),
    db.entry.count({ where: { raffleId: raffle.id } }),
    currentUser(req),
  ]);
  const tasks = xTaskList(raffle);
  res.json({
    raffle: {
      id: raffle.id,
      title: raffle.title,
      description: raffle.description,
      imageUrl: raffle.imageUrl,
      status: raffle.status,
      endsAt: raffle.endsAt,
      endedAt: raffle.endedAt,
      hostName: raffle.hostName,
      hostAvatar: raffle.hostAvatar,
      chain: chainLabel(raffle.chain),
      allocations: allocationSummary(raffle),
      spots: raffle.winnerCount,
      walletType: raffle.walletType,
      minAccountAgeDays: raffle.minAccountAgeDays,
      requireAnyRole: raffle.requireAnyRole,
      requireMember: raffle.requireMember,
      inviteUrl: raffle.inviteUrl,
      requiredRoles: raffle.requiredRoleIds.map((id) => ({ id, ...(guild?.roles.get(id) ?? { name: "deleted-role", color: 0 }) })),
      quoteCount: quotePosts(raffle).length,
      hasXTasks: hasXTasks(raffle),
      tasks: tasks.map((t) => ({ key: t.key, kind: t.kind, label: t.text })),
      entryCount,
      discordUrl: raffle.messageId ? `https://discord.com/channels/${raffle.guildId}/${raffle.channelId}/${raffle.messageId}` : null,
    },
    guild: guild ? { id: raffle.guildId, name: guild.name, icon: guild.icon } : null,
    viewer: user ? await viewerState(raffle, user.id) : null,
    // Host / admin / role pengelola server ini: boleh membuka halaman kelola (data lengkap)
    canManage: user ? await canManageGuild(raffle.guildId, user.id).catch(() => false) : false,
  });
});

// Status peserta yang sedang melihat: sudah ikut? memenuhi syarat? task mana yang sudah dibuka?
async function viewerState(raffle: Raffle, userId: string) {
  const [entry, member, xLink, progress] = await Promise.all([
    db.entry.findUnique({ where: { raffleId_userId: { raffleId: raffle.id, userId } } }),
    raffle.status === "ACTIVE" ? fetchMember(raffle.guildId, userId) : Promise.resolve(null),
    db.xLink.findUnique({ where: { discordId: userId } }),
    db.taskProgress.findUnique({ where: { raffleId_userId: { raffleId: raffle.id, userId } } }),
  ]);
  const guild = await guildInfo(raffle.guildId);
  const done = new Set(progress?.done);
  const returnTo = publicRafflePath(raffle.id);
  return {
    userId,
    entry: entry
      ? { status: entry.status, allocation: entry.allocation, wallet: entry.wallet, xUsername: entry.xUsername, note: entry.note }
      : null,
    isMember: raffle.status === "ACTIVE" ? !!member : null,
    requirementErrors:
      member || !raffle.requireMember
        ? checkRequirements(raffle, { userId, roleIds: member?.roles ?? [] }).map((e) => plainText(e, guild))
        : [],
    xUsername: xLink?.xUsername ?? null,
    connectXUrl: hasXTasks(raffle) ? connectXUrl(userId, returnTo) : null,
    tasks: xTaskList(raffle).map((t) => ({
      key: t.key,
      done: done.has(t.key),
      url: raffle.status === "ACTIVE" ? taskClickUrl({ raffleId: raffle.id, userId, task: t.key }) : null,
    })),
  };
}

const enterSchema = z.object({
  wallet: z.string().max(100).optional(),
  quoteUrls: z.array(z.string().max(300)).max(5).optional(),
});

publicRouter.post("/raffles/:id/enter", async (req, res) => {
  const user = await currentUser(req);
  if (!user) throw new HttpError(401, "Log in with Discord to enter.");
  const raffle = await loadRaffle(req);
  const input = enterSchema.safeParse(req.body ?? {});
  if (!input.success) throw new HttpError(400, "Invalid form data.");

  const member = await fetchMember(raffle.guildId, user.id);
  const guild = await guildInfo(raffle.guildId);
  if (!member && raffle.requireMember) {
    throw new HttpError(403, `Join ${guild?.name ?? "the Discord server"} first, then try again.`);
  }
  // Logika yang sama dengan tombol Enter / Done di Discord (syarat, task X, wallet, quote, anti-duplikat).
  // Non-member (hanya kalau raffle mengizinkan): data diambil dari akun Discord yang login, tanpa role.
  const reply = await enterRaffle(
    raffle.id,
    member
      ? { userId: user.id, username: member.user.username, roleIds: member.roles, avatar: member.user.avatar }
      : { userId: user.id, username: user.username, roleIds: [], avatar: user.avatar },
    input.data,
  );
  const entered = !!(await db.entry.findUnique({ where: { raffleId_userId: { raffleId: raffle.id, userId: user.id } } }));
  res.status(entered ? 200 : 400).json(entered ? { ok: true, message: plainText(reply, guild) } : { error: plainText(reply, guild) });
});
