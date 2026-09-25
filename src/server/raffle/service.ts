import { randomInt } from "node:crypto";
import { Routes, type APIMessage } from "discord.js";
import type { Raffle } from "@prisma/client";
import { db, isUniqueViolation, uniqueTarget } from "../db.js";
import { fetchMember, isDiscordError, rest } from "../discord.js";
import { connectXUrl, parseQuoteUrl } from "../x.js";
import { connectXComponents, raffleButtons, raffleEmbed, xTaskComponents } from "./embed.js";
import { hasXTasks, quotePosts } from "./xtasks.js";
import { checkRequirements, normalizeWallet } from "./requirements.js";
import { scheduleDraw } from "./schedule.js";

const MESSAGE_SYNC_INTERVAL_MS = 15_000;

async function winnerIdsOf(raffleId: string) {
  const winners = await db.entry.findMany({
    where: { raffleId, status: "WON" },
    select: { userId: true },
    orderBy: { createdAt: "asc" },
  });
  return winners.map((w) => w.userId);
}

async function messagePayload(raffle: Raffle) {
  const [count, winners] = await Promise.all([
    db.entry.count({ where: { raffleId: raffle.id } }),
    raffle.status === "ENDED" ? winnerIdsOf(raffle.id) : Promise.resolve([]),
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

export type Entrant = { userId: string; username: string; roleIds: string[] };
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

// Langkah pertama raffle yang punya task X: pastikan akun X terhubung, lalu tampilkan tombol task.
export async function startXTasks(raffleId: string, who: Entrant): Promise<Reply> {
  const raffle = await loadForEntry(raffleId, who);
  if (typeof raffle === "string") return raffle;
  const [xLink, existing] = await Promise.all([
    db.xLink.findUnique({ where: { discordId: who.userId } }),
    db.entry.findUnique({ where: { raffleId_userId: { raffleId, userId: who.userId } } }),
  ]);
  if (existing) return ALREADY_ENTERED;
  if (!xLink) return notLinkedReply(who.userId);
  const quotes = quotePosts(raffle).length;
  return {
    content:
      `X account: **@${xLink.xUsername}**\n` +
      "1️⃣ Click every task button below and complete it on X\n" +
      (quotes
        ? `2️⃣ Copy the link of your quote post${quotes > 1 ? "s" : ""}\n3️⃣ Click **Done, enter me** and paste the link${quotes > 1 ? "s" : ""}`
        : "2️⃣ Click **Done, enter me**"),
    components: xTaskComponents(raffle),
  };
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
      data: { raffleId, userId: who.userId, username: who.username, wallet, xUsername, xQuoteUrls },
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
  const label = { ENTERED: "🎟️ Entered", WON: "🏆 YOU WON!", DISQUALIFIED: "⛔ Disqualified" }[entry.status];
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
async function pickWinners(raffle: Raffle, count: number): Promise<string[]> {
  const candidates = shuffle(
    await db.entry.findMany({ where: { raffleId: raffle.id, status: "ENTERED" }, select: { id: true, userId: true } }),
  );
  const winners: string[] = [];

  for (const c of candidates) {
    if (winners.length >= count) break;
    const member = await fetchMember(raffle.guildId, c.userId);
    const errors = member ? checkRequirements(raffle, { userId: c.userId, roleIds: member.roles }) : ["Left the server"];
    if (errors.length) {
      await db.entry.update({ where: { id: c.id }, data: { status: "DISQUALIFIED", note: errors.join("; ") } });
      continue;
    }
    await db.entry.update({ where: { id: c.id }, data: { status: "WON" } });
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

async function announce(raffle: Raffle, text: string, winners: string[]) {
  const chunks: string[] = [];
  let cur = text;
  for (const m of winners.map((id) => `<@${id}>`)) {
    if (cur.length + m.length + 1 > 1900) {
      chunks.push(cur);
      cur = "";
    }
    cur += (cur && !cur.endsWith("\n") ? " " : "") + m;
  }
  chunks.push(cur);

  for (const [i, content] of chunks.entries()) {
    await rest.post(Routes.channelMessages(raffle.channelId), {
      body: {
        content,
        allowed_mentions: { users: winners },
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
  const winners = await pickWinners(raffle, raffle.winnerCount);
  await refreshMessage(raffleId);
  await announce(
    raffle,
    winners.length
      ? `🎉 **${raffle.title}** has ended! Congratulations to the winners:\n`
      : `**${raffle.title}** has ended, but no entrants met the requirements.`,
    winners,
  ).catch((e) => console.error("[raffle] failed to announce winners", e));
  console.log(`[raffle] ${raffleId} ended, ${winners.length} winners`);
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

export async function rerollRaffle(raffleId: string, count: number) {
  const raffle = await db.raffle.findUniqueOrThrow({ where: { id: raffleId } });
  if (raffle.status !== "ENDED") throw new Error("Reroll is only available for ended raffles.");
  const winners = await pickWinners(raffle, count);
  await refreshMessage(raffleId);
  if (winners.length) await announce(raffle, `🔁 **${raffle.title}** reroll! Additional winners:\n`, winners);
  return winners;
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
  await db.entry.update({ where: { id: entryId, raffleId }, data: { status: "DISQUALIFIED", note } });
  await refreshMessage(raffleId);
}
