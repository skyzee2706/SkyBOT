import { Routes, type APIMessage } from "discord.js";
import type { Allocation, Raffle } from "@prisma/client";
import { chainLabel } from "../../shared/raffle.js";
import { db, isUniqueViolation, uniqueTarget } from "../db.js";
import { isDiscordError, rest } from "../discord.js";
import { connectXUrl, parseQuoteUrl, type TaskClick } from "../x.js";
import { connectXComponents, raffleButtons, raffleEmbed } from "./embed.js";
import { hasXTasks, quotePosts, xTaskList } from "./xtasks.js";
import { checkRequirements, normalizeWallet } from "./requirements.js";
import { saveWallet, savedWallet } from "./wallets.js";
import { scheduleDraw } from "./schedule.js";
import { closeOverdueInBackground } from "./draw.js";

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
  if (await closeOverdueInBackground(raffle)) return ENDED;
  const errors = checkRequirements(raffle, who);
  if (errors.length) return requirementsReply(errors);
  return raffle;
}

const requirementsReply = (errors: string[]) => `❌ You don't meet the requirements yet:\n${errors.map((e) => `• ${e}`).join("\n")}`;

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

// Tombol Enter di Discord untuk raffle dengan task X: tentukan langkah berikutnya.
// form = tampilkan form wallet / link quote; enter = langsung ikut; lainnya = balasan (sudah ikut, belum connect X, dst.)
export type DiscordEntryStep =
  | { kind: "reply"; reply: Reply }
  | { kind: "form"; walletType: string; quoteCount: number; chain?: string }
  | { kind: "enter" };

export async function discordEntryStep(raffleId: string, userId: string, roleIds: string[]): Promise<DiscordEntryStep> {
  const [raffle, xLink, entry, wallets] = await Promise.all([
    db.raffle.findUnique({ where: { id: raffleId } }),
    db.xLink.findUnique({ where: { discordId: userId } }),
    db.entry.findUnique({ where: { raffleId_userId: { raffleId, userId } } }),
    db.userWallet.findUnique({ where: { discordId: userId } }),
  ]);
  if (!raffle || raffle.status !== "ACTIVE" || raffle.endsAt.getTime() <= Date.now()) return { kind: "reply", reply: ENDED };
  if (entry) return { kind: "reply", reply: ALREADY_ENTERED };
  const errors = checkRequirements(raffle, { userId, roleIds });
  if (errors.length) return { kind: "reply", reply: requirementsReply(errors) };
  if (hasXTasks(raffle) && !xLink) return { kind: "reply", reply: notLinkedReply(userId) };
  const quoteCount = hasXTasks(raffle) ? quotePosts(raffle).length : 0;
  // Wallet cukup diisi sekali; setelah tersimpan, form hanya muncul untuk link quote
  const needWallet =
    raffle.walletType === "CUSTOM" ||
    (raffle.walletType === "EVM" && !wallets?.evm) ||
    (raffle.walletType === "SOL" && !wallets?.sol);
  if (quoteCount || needWallet) {
    return { kind: "form", walletType: needWallet ? raffle.walletType : "NONE", quoteCount, chain: chainLabel(raffle.chain) ?? undefined };
  }
  return { kind: "enter" };
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

// Web: peserta wajib membuka semua task X dulu (requireTaskClicks). Discord: cukup Enter + form.
export async function enterRaffle(
  raffleId: string,
  who: Entrant,
  input: Submission = {},
  opts: { requireTaskClicks?: boolean } = {},
): Promise<Reply> {
  const raffle = await loadForEntry(raffleId, who);
  if (typeof raffle === "string") return raffle;

  let xUsername: string | null = null;
  let xQuoteUrls: string[] = [];
  if (hasXTasks(raffle)) {
    const xLink = await db.xLink.findUnique({ where: { discordId: who.userId } });
    if (!xLink) return notLinkedReply(who.userId);
    xUsername = xLink.xUsername;
    if (opts.requireTaskClicks) {
      const progress = await db.taskProgress.findUnique({ where: { raffleId_userId: { raffleId, userId: who.userId } } });
      const done = new Set(progress?.done);
      if (!xTaskList(raffle).every((t) => done.has(t.key))) {
        return "❌ Open every task button first (each one turns green ✅). Click **Enter** on the raffle to see your tasks.";
      }
    }
    const quotes = validateQuotes(raffle, xLink.xUsername, input.quoteUrls ?? []);
    if (typeof quotes === "string") return quotes;
    xQuoteUrls = quotes;
  }

  // Wallet tersimpan dipakai langsung; kalau belum ada, wallet dari form disimpan untuk raffle berikutnya
  let wallet: string | null = null;
  if (raffle.walletType === "CUSTOM") {
    // Chain manual: wallet diisi tiap raffle dan tidak disimpan ke profil
    wallet = normalizeWallet("CUSTOM", input.wallet ?? "");
    if (!wallet) return `❌ Invalid ${chainLabel(raffle.chain) ?? ""} wallet address.`.replace("  ", " ");
  } else if (raffle.walletType !== "NONE") {
    wallet = await savedWallet(who.userId, raffle.walletType);
    if (!wallet) {
      const saved = await saveWallet(who.userId, raffle.walletType, input.wallet ?? "");
      if ("error" in saved) return `❌ ${saved.error}`;
      wallet = saved.wallet;
    }
  }

  try {
    await db.entry.create({
      data: { raffleId, userId: who.userId, username: who.username, avatar: who.avatar ?? null, wallet, xUsername, xQuoteUrls },
    });
  } catch (e) {
    if (isUniqueViolation(e)) {
      return uniqueTarget(e).includes("wallet")
        ? "❌ That wallet is already used by another participant in this raffle."
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
