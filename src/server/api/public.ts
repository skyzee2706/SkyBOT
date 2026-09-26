import { Router, type Request } from "express";
import { Routes, type APIGuild } from "discord.js";
import type { Raffle } from "@prisma/client";
import { z } from "zod";
import { db } from "../db.js";
import { fetchMember, isDiscordError, rest } from "../discord.js";
import { connectXUrl, taskClickUrl } from "../x.js";
import { endRaffle, enterRaffle, type Reply } from "../raffle/service.js";
import { checkRequirements } from "../raffle/requirements.js";
import { hasXTasks, quotePosts, xTaskList } from "../raffle/xtasks.js";
import { allocationSummary, chainLabel, publicRafflePath } from "../../shared/raffle.js";
import { currentUser } from "./auth.js";
import { HttpError } from "./dashboard.js";

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
      walletType: raffle.walletType,
      minAccountAgeDays: raffle.minAccountAgeDays,
      requireAnyRole: raffle.requireAnyRole,
      requiredRoles: raffle.requiredRoleIds.map((id) => ({ id, ...(guild?.roles.get(id) ?? { name: "deleted-role", color: 0 }) })),
      quoteCount: quotePosts(raffle).length,
      hasXTasks: hasXTasks(raffle),
      tasks: tasks.map((t) => ({ key: t.key, label: t.label })),
      entryCount,
      discordUrl: raffle.messageId ? `https://discord.com/channels/${raffle.guildId}/${raffle.channelId}/${raffle.messageId}` : null,
    },
    guild: guild ? { id: raffle.guildId, name: guild.name, icon: guild.icon } : null,
    viewer: user ? await viewerState(raffle, user.id) : null,
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
    requirementErrors: member
      ? checkRequirements(raffle, { userId, roleIds: member.roles }).map((e) => plainText(e, guild))
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
  if (!member) {
    throw new HttpError(403, `Join ${guild?.name ?? "the Discord server"} first, then try again.`);
  }
  // Logika yang sama dengan tombol Enter / Done di Discord (syarat, task X, wallet, quote, anti-duplikat)
  const reply = await enterRaffle(
    raffle.id,
    { userId: user.id, username: member.user.username, roleIds: member.roles },
    input.data,
  );
  const entered = !!(await db.entry.findUnique({ where: { raffleId_userId: { raffleId: raffle.id, userId: user.id } } }));
  res.status(entered ? 200 : 400).json(entered ? { ok: true, message: plainText(reply, guild) } : { error: plainText(reply, guild) });
});
