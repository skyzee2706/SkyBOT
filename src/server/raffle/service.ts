import { randomInt } from "node:crypto";
import { Routes, type APIMessage } from "discord.js";
import type { Allocation, Raffle } from "@prisma/client";
import { hasAllocations } from "../../shared/raffle.js";
import { db, isUniqueViolation, uniqueTarget } from "../db.js";
import { fetchMember, isDiscordError, rest } from "../discord.js";
import { connectXUrl, parseQuoteUrl, type TaskClick } from "../x.js";
import { connectXComponents, raffleButtons, raffleEmbed, xTaskComponents } from "./embed.js";
import { hasXTasks, quotePosts, xTaskList } from "./xtasks.js";
import { checkRequirements, normalizeWallet } from "./requirements.js";
import { scheduleDraw } from "./schedule.js";

const MESSAGE_SYNC_INTERVAL_MS = 15_000;

export type Winner = { userId: string; allocation: Allocation | null };

async function winnersOf(raffleId: string): Promise<Winner[]> {
  return db.entry.findMany({
    where: { raffleId, status: "WON" },
    select: { userId: true, allocation: true },
    orderBy: { createdAt: "asc" },
  });
}

async function messagePayload(raffle: Raffle) {
  const [count, winners] = await Promise.all([
    db.entry.count({ where: { raffleId: raffle.id } }),
    raffle.status === "ENDED" ? winnersOf(raffle.id) : Promise.resolve([]),
  ]);
  return { embeds: [raffleEmbed(raffle, count, winners).toJSON()], components: [raffleButtons(raffle).toJSON()] };
}

export async function refreshMessage(raffleId: string) {
  const raffle = await db.raffle.findUnique({ where: { id: raffleId } });
  if (!raffle?.messageId) return;
  try {
    await rest.patch(Routes.channelMessage(raffle.channelId, raffle.messageId), { body: await messagePayload(raffle) });
    await db.raffle.update({ where: { id: raffleId }, data: { messageSyncedAt: new Date() } });
  } catch (e) {
    if (!isDiscordError(e, 10003, 10008, 50001)) throw e; // channel/pesan sudah dihapus atau bot tidak punya akses
  }
}

// Update jumlah peserta di embed paling sering sekali per 15 detik (supaya tidak kena rate limit Discord).
export async function syncMessageThrottled(raffleId: string) {
  const cutoff = new Date(Date.now() - MESSAGE_SYNC_INTERVAL_MS);
  const { count } = await db.raffle.updateMany({
    where: { id: raffleId, OR: [{ messageSyncedAt: null }, { messageSyncedAt: { lt: cutoff } }] },
    data: { messageSyncedAt: new Date() },
  });
  if (count) await refreshMessage(raffleId);
}

// Baris "NEW RAFFLE" + mention yang dipilih di dashboard (ID = guildId berarti @everyone).
function announcement(raffle: Raffle) {
  const everyone = raffle.mentionRoleIds.includes(raffle.guildId);
  const roles = raffle.mentionRoleIds.filter((id) => id !== raffle.guildId);
  const mentions = [...(everyone ? ["@everyone"] : []), ...roles.map((id) => `<@&${id}>`)];
  return {
    content: ["**NEW RAFFLE**", ...mentions].join(" "),
    allowed_mentions: { parse: everyone ? ["everyone"] : [], roles },
  };
}

export async function publishRaffle(raffle: Raffle) {
  const msg = (await rest.post(Routes.channelMessages(raffle.channelId), {
    body: {
      ...(await messagePayload(raffle)),
      ...announcement(raffle),
    },
  })) as APIMessage;
  const updated = await db.raffle.update({
    where: { id: raffle.id },
    data: { messageId: msg.id, messageSyncedAt: new Date() },
  });
  await scheduleDraw(updated);
  return updated;
}

export type Entrant = { userId: string; username: string; roleIds: string[]; avatar?: string | null };
export type Reply = string | { content: string; components?: unknown[] };
export type Submission = { wallet?: string; quoteUrls?: (string | undefined)[] };

const ENDED = "❌ This raffle has already ended.";
const ALREADY_ENTERED = "✅ You're already entered in this raffle.";

// Ambil raffle aktif + cek syarat Discord. Mengembalikan pesan error kalau tidak bisa ikut.
async function loadForEntry(raffleId: string, who: Entrant): Promise<Raffle | string> {
  const raffle = await db.raffle.findUnique({ where: { id: raffleId } });
  if (!raffle || raffle.status !== "ACTIVE") return ENDED;
  if (raffle.endsAt.getTime() <= Date.now()) {
    await endRaffle(raffleId);
    return ENDED;
  }
  const errors = checkRequirements(raffle, who);
  if (errors.length) return `❌ You don't meet the requirements yet:\n${errors.map((e) => `• ${e}`).join("\n")}`;
  return raffle;
}

const notLinkedReply = (userId: string): Reply => ({
  content: "🔗 This raffle has X tasks. Connect your X account first (one-time only), then click **Enter** again.",
  components: connectXComponents(connectXUrl(userId)),
});

// Tombol "Connect X" di pesan raffle: tampilkan status akun X + link untuk (ganti) hubungkan.
export async function connectXReply(userId: string): Promise<Reply> {
  const xLink = await db.xLink.findUnique({ where: { discordId: userId } });
  return {
    content: xLink
      ? `✅ Your X account is connected: **@${xLink.xUsername}**\nWant to use a different account? Click the button below.`
      : "🔗 Connect your X account to join raffles with X tasks (one-time only).",
    components: connectXComponents(connectXUrl(userId), xLink ? "Switch X account" : "Connect X account"),
  };
}

// Token interaksi Discord berlaku 15 menit; setelah itu pesan task tidak bisa diperbarui lagi.
const INTERACTION_TOKEN_TTL_MS = 14 * 60_000;
export type InteractionRef = { appId: string; token: string };

function taskListReply(raffle: Raffle, xUsername: string, userId: string, done: ReadonlySet<string>): Reply {
  const tasks = xTaskList(raffle);
  const doneCount = tasks.filter((t) => done.has(t.key)).length;
  const quotes = quotePosts(raffle).length;
  return {
    content:
      `X account: **@${xUsername}**\n` +
      "1️⃣ Complete all tasks below\n" +
      (quotes
        ? `2️⃣ Then, click **Done, enter me** and paste the link to your quote post${quotes > 1 ? "s" : ""}`
        : "2️⃣ Then, click **Done, enter me**") +
      `\n\nProgress: **${doneCount}/${tasks.length}** tasks` +
      (doneCount < tasks.length ? " — **Done, enter me** unlocks when all are green." : " ✅") +
      "\n-# Buttons not updating? Click **Enter** on the raffle again.",
    components: xTaskComponents(raffle, userId, done),
  };
}

// Langkah pertama raffle yang punya task X: pastikan akun X terhubung, lalu tampilkan tombol task.
export async function startXTasks(raffleId: string, who: Entrant, interaction?: InteractionRef): Promise<Reply> {
  const raffle = await loadForEntry(raffleId, who);
  if (typeof raffle === "string") return raffle;
  const [xLink, existing] = await Promise.all([
    db.xLink.findUnique({ where: { discordId: who.userId } }),
    db.entry.findUnique({ where: { raffleId_userId: { raffleId, userId: who.userId } } }),
  ]);
  if (existing) return ALREADY_ENTERED;
  if (!xLink) return notLinkedReply(who.userId);
  const ref = interaction
    ? { appId: interaction.appId, interactionToken: interaction.token, tokenAt: new Date() }
    : {};
  const progress = await db.taskProgress.upsert({
    where: { raffleId_userId: { raffleId, userId: who.userId } },
    create: { raffleId, userId: who.userId, ...ref },
    update: ref,
  });
  return taskListReply(raffle, xLink.xUsername, who.userId, new Set(progress.done));
}

// Dipanggil saat peserta membuka tombol task (lewat /api/x/task). Mengembalikan link X tujuan, atau null kalau tidak valid.
export async function recordTaskClick({ raffleId, userId, task }: TaskClick): Promise<string | null> {
  const raffle = await db.raffle.findUnique({ where: { id: raffleId } });
  if (!raffle || raffle.status !== "ACTIVE") return null;
  const target = xTaskList(raffle).find((t) => t.key === task);
  if (!target) return null;
  const progress = await db.taskProgress.findUnique({ where: { raffleId_userId: { raffleId, userId } } });
  if (!progress) {
    await db.taskProgress.create({ data: { raffleId, userId, done: [task] } }).catch((e) => {
      if (!isUniqueViolation(e)) throw e;
    });
  } else if (!progress.done.includes(task)) {
    await db.taskProgress.update({ where: { raffleId_userId: { raffleId, userId } }, data: { done: { push: task } } });
  }
  return target.url;
}

// Perbarui pesan daftar task (ephemeral) supaya tombol yang sudah dibuka jadi hijau.
export async function refreshTaskMessage(raffleId: string, userId: string) {
  const [raffle, progress, xLink, entry] = await Promise.all([
    db.raffle.findUnique({ where: { id: raffleId } }),
    db.taskProgress.findUnique({ where: { raffleId_userId: { raffleId, userId } } }),
    db.xLink.findUnique({ where: { discordId: userId } }),
    db.entry.findUnique({ where: { raffleId_userId: { raffleId, userId } } }),
  ]);
  if (!raffle || !progress?.appId || !progress.interactionToken || !progress.tokenAt || !xLink || entry) return;
  if (Date.now() - progress.tokenAt.getTime() > INTERACTION_TOKEN_TTL_MS) return;
  const reply = taskListReply(raffle, xLink.xUsername, userId, new Set(progress.done));
  await rest
    .patch(Routes.webhookMessage(progress.appId, progress.interactionToken), { body: reply, auth: false })
    .catch((e) => {
      if (!isDiscordError(e, 10008, 10015, 50027)) throw e; // pesan dihapus / token kedaluwarsa
    });
}

// Validasi link quote untuk tiap post ber-task quote. Mengembalikan pesan error atau daftar link yang sudah dinormalisasi.
function validateQuotes(raffle: Raffle, xUsername: string, submitted: (string | undefined)[]): string | string[] {
  const posts = quotePosts(raffle);
  const urls: string[] = [];
  for (const [i, post] of posts.entries()) {
    const url = parseQuoteUrl(submitted[i] ?? "", xUsername, post.tweetId);
    const which = posts.length > 1 ? ` for post #${i + 1}` : "";
    if (!url) {
      return `❌ Invalid quote link${which}. It must be a link to your own post from **@${xUsername}**, e.g. \`https://x.com/${xUsername}/status/123...\``;
    }
    if (urls.includes(url)) return `❌ Each quote needs its own post — you used the same link twice.`;
    urls.push(url);
  }
  return urls;
}

export async function enterRaffle(raffleId: string, who: Entrant, input: Submission = {}): Promise<Reply> {
  const raffle = await loadForEntry(raffleId, who);
  if (typeof raffle === "string") return raffle;

  let xUsername: string | null = null;
  let xQuoteUrls: string[] = [];
  if (hasXTasks(raffle)) {
    const xLink = await db.xLink.findUnique({ where: { discordId: who.userId } });
    if (!xLink) return notLinkedReply(who.userId);
    xUsername = xLink.xUsername;
    const progress = await db.taskProgress.findUnique({ where: { raffleId_userId: { raffleId, userId: who.userId } } });
    const done = new Set(progress?.done);
    if (!xTaskList(raffle).every((t) => done.has(t.key))) {
      return "❌ Open every task button first (each one turns green ✅). Click **Enter** on the raffle to see your tasks.";
    }
    const quotes = validateQuotes(raffle, xLink.xUsername, input.quoteUrls ?? []);
    if (typeof quotes === "string") return quotes;
    xQuoteUrls = quotes;
  }

  let wallet: string | null = null;
  if (raffle.walletType !== "NONE") {
    wallet = normalizeWallet(raffle.walletType, input.wallet ?? "");
    if (!wallet) return `❌ Invalid ${raffle.walletType === "EVM" ? "EVM" : "Solana"} wallet address.`;
  }

  try {
    await db.entry.create({
      data: { raffleId, userId: who.userId, username: who.username, avatar: who.avatar ?? null, wallet, xUsername, xQuoteUrls },
    });
  } catch (e) {
    if (isUniqueViolation(e)) {
      return uniqueTarget(e).includes("wallet")
        ? "❌ That wallet is already used by another entrant in this raffle."
        : ALREADY_ENTERED;
    }
    throw e;
  }

  await syncMessageThrottled(raffleId).catch((e) => console.error("[raffle] failed to update embed", e));
  return `✅ You're in **${raffle.title}**! Good luck 🍀${wallet ? `\nWallet: \`${wallet}\`` : ""}`;
}

export async function entryStatus(raffleId: string, userId: string) {
  const entry = await db.entry.findUnique({ where: { raffleId_userId: { raffleId, userId } } });
  if (!entry) return "You haven't entered this raffle yet.";
  const won = entry.allocation ? `🏆 YOU WON! (${entry.allocation})` : "🏆 YOU WON!";
  const label = { ENTERED: "🎟️ Entered", WON: won, DISQUALIFIED: "⛔ Disqualified" }[entry.status];
  return (
    label +
    (entry.xUsername ? `\nX: @${entry.xUsername}` : "") +
    (entry.wallet ? `\nWallet: \`${entry.wallet}\`` : "") +
    (entry.note ? `\nReason: ${entry.note}` : "")
  );
}

function shuffle<T>(arr: T[]) {
  for (let i = arr.length - 1; i > 0; i--) {
    const j = randomInt(i + 1);
    [arr[i], arr[j]] = [arr[j], arr[i]];
  }
  return arr;
}

// Mengundi pemenang dari peserta yang belum menang. Tiap kandidat dicek ULANG syaratnya langsung ke Discord
// (masih di server, role masih ada) sebelum dinyatakan menang; yang gagal didiskualifikasi dan diganti.
// `allocation` (GTD / FCFS) disimpan di entry pemenang; null untuk raffle lama.
async function pickWinners(raffle: Raffle, count: number, allocation: Allocation | null): Promise<string[]> {
  if (count <= 0) return [];
  const candidates = shuffle(
    await db.entry.findMany({ where: { raffleId: raffle.id, status: "ENTERED" }, select: { id: true, userId: true } }),
  );
  const winners: string[] = [];

  for (const c of candidates) {
    if (winners.length >= count) break;
    const member = await fetchMember(raffle.guildId, c.userId);
    // Raffle tanpa syarat member: non-member tetap dicek syarat lain (mis. umur akun), tanpa role
    const errors =
      member || !raffle.requireMember
        ? checkRequirements(raffle, { userId: c.userId, roleIds: member?.roles ?? [] })
        : ["Left the server"];
    if (errors.length) {
      await db.entry.update({ where: { id: c.id }, data: { status: "DISQUALIFIED", note: errors.join("; ") } });
      continue;
    }
    await db.entry.update({ where: { id: c.id }, data: { status: "WON", allocation } });
    winners.push(c.userId);
    if (raffle.winnerRoleId) {
      await rest
        .put(Routes.guildMemberRole(raffle.guildId, c.userId, raffle.winnerRoleId), {
          reason: `Won raffle ${raffle.id}`,
        })
        .catch((e) => console.warn(`[raffle] failed to give winner role to ${c.userId}: ${e.message}`));
    }
  }
  return winners;
}

type WinnerGroup = { title: string | null; userIds: string[] };

// Pengumuman pemenang. Tiap grup (mis. GTD / FCFS) punya judul sendiri; dipecah jadi beberapa pesan kalau terlalu panjang.
async function announce(raffle: Raffle, text: string, groups: WinnerGroup[]) {
  const pieces: string[] = [];
  for (const g of groups.filter((g) => g.userIds.length)) {
    if (g.title) pieces.push(`\n${g.title}\n`);
    pieces.push(...g.userIds.map((id) => `<@${id}>`));
  }
  const chunks: string[] = [];
  let cur = text;
  for (const p of pieces) {
    if (cur.length + p.length + 1 > 1900) {
      chunks.push(cur);
      cur = p.replace(/^\n/, "");
      continue;
    }
    // Judul grup selalu diawali satu baris kosong; mention dipisah spasi
    const joiner = p.startsWith("\n") ? (cur.endsWith("\n") ? "" : "\n") : !cur || cur.endsWith("\n") ? "" : " ";
    cur += joiner + p;
  }
  chunks.push(cur);

  for (const [i, content] of chunks.entries()) {
    await rest.post(Routes.channelMessages(raffle.channelId), {
      body: {
        content,
        // Discord maksimal 100 user per pesan; tiap potongan (≤1900 karakter) berisi < 100 mention
        allowed_mentions: { users: [...content.matchAll(/<@(\d+)>/g)].map((m) => m[1]) },
        message_reference:
          i === 0 && raffle.messageId ? { message_id: raffle.messageId, fail_if_not_exists: false } : undefined,
      },
    });
  }
}

export async function endRaffle(raffleId: string) {
  // Update atomik: hanya satu proses yang bisa mengubah ACTIVE -> ENDED, jadi undian tidak pernah dobel.
  const { count } = await db.raffle.updateMany({
    where: { id: raffleId, status: "ACTIVE" },
    data: { status: "ENDED", endedAt: new Date() },
  });
  if (!count) return false;

  const raffle = await db.raffle.findUniqueOrThrow({ where: { id: raffleId } });
  // GTD diundi dulu, lalu FCFS dari peserta sisanya — satu orang tidak bisa menang dua kali.
  const groups: WinnerGroup[] = hasAllocations(raffle)
    ? [
        { title: "**🏆 GTD Winners**", userIds: await pickWinners(raffle, raffle.gtdCount, "GTD") },
        { title: "**🎟️ FCFS Winners**", userIds: await pickWinners(raffle, raffle.fcfsCount, "FCFS") },
      ]
    : [{ title: null, userIds: await pickWinners(raffle, raffle.winnerCount, null) }];
  const total = groups.reduce((n, g) => n + g.userIds.length, 0);
  await refreshMessage(raffleId);
  await announce(
    raffle,
    total
      ? `🎉 **${raffle.title}** has ended! Congratulations to the winners:\n`
      : `**${raffle.title}** has ended, but no entrants met the requirements.`,
    groups,
  ).catch((e) => console.error("[raffle] failed to announce winners", e));
  console.log(`[raffle] ${raffleId} ended, ${total} winners`);
  return true;
}

// Mengakhiri semua raffle yang waktunya sudah lewat (jaring pengaman kalau jadwal QStash gagal).
export async function endOverdueRaffles() {
  const due = await db.raffle.findMany({
    where: { status: "ACTIVE", endsAt: { lte: new Date() } },
    select: { id: true },
  });
  for (const r of due) await endRaffle(r.id).catch((e) => console.error(`[raffle] failed to draw ${r.id}`, e));
  return due.length;
}

export async function cancelRaffle(raffleId: string) {
  const { count } = await db.raffle.updateMany({
    where: { id: raffleId, status: "ACTIVE" },
    data: { status: "CANCELLED", endedAt: new Date() },
  });
  if (!count) throw new Error("This raffle is no longer active.");
  await refreshMessage(raffleId);
}

export async function disqualifyEntry(raffleId: string, entryId: string, note: string) {
  await db.entry.update({ where: { id: entryId, raffleId }, data: { status: "DISQUALIFIED", allocation: null, note } });
  await refreshMessage(raffleId);
}
