import { randomInt } from "node:crypto";
import { Routes, type APIMessage } from "discord.js";
import type { Raffle } from "@prisma/client";
import { db, isUniqueViolation, uniqueTarget } from "../db.js";
import { fetchMember, isDiscordError, rest } from "../discord.js";
import { connectXUrl } from "../x.js";
import { connectXComponents, hasXTasks, raffleButtons, raffleEmbed, xTaskComponents } from "./embed.js";
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

export async function publishRaffle(raffle: Raffle) {
  const msg = (await rest.post(Routes.channelMessages(raffle.channelId), {
    body: await messagePayload(raffle),
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

const ENDED = "❌ Raffle ini sudah berakhir.";

// Ambil raffle aktif + cek syarat Discord. Mengembalikan pesan error kalau tidak bisa ikut.
async function loadForEntry(raffleId: string, who: Entrant): Promise<Raffle | string> {
  const raffle = await db.raffle.findUnique({ where: { id: raffleId } });
  if (!raffle || raffle.status !== "ACTIVE") return ENDED;
  if (raffle.endsAt.getTime() <= Date.now()) {
    await endRaffle(raffleId);
    return ENDED;
  }
  const errors = checkRequirements(raffle, who);
  if (errors.length) return `❌ Kamu belum memenuhi syarat:\n${errors.map((e) => `• ${e}`).join("\n")}`;
  return raffle;
}

const notLinkedReply = (userId: string): Reply => ({
  content: "🔗 Raffle ini punya task X. Hubungkan akun X kamu dulu (cukup sekali), lalu klik **Enter** lagi.",
  components: connectXComponents(connectXUrl(userId)),
});

// Langkah pertama raffle yang punya task X: pastikan akun X terhubung, lalu tampilkan tombol task.
export async function startXTasks(raffleId: string, who: Entrant): Promise<Reply> {
  const raffle = await loadForEntry(raffleId, who);
  if (typeof raffle === "string") return raffle;
  const [xLink, existing] = await Promise.all([
    db.xLink.findUnique({ where: { discordId: who.userId } }),
    db.entry.findUnique({ where: { raffleId_userId: { raffleId, userId: who.userId } } }),
  ]);
  if (existing) return "✅ Kamu sudah terdaftar di raffle ini.";
  if (!xLink) return notLinkedReply(who.userId);
  return {
    content:
      `Akun X: **@${xLink.xUsername}**\n` +
      "1️⃣ Klik semua tombol task di bawah dan selesaikan di X\n" +
      "2️⃣ Klik **Sudah semua, masukkan saya**",
    components: xTaskComponents(raffle),
  };
}

export async function enterRaffle(raffleId: string, who: Entrant, walletRaw?: string): Promise<Reply> {
  const raffle = await loadForEntry(raffleId, who);
  if (typeof raffle === "string") return raffle;

  let xUsername: string | null = null;
  if (hasXTasks(raffle)) {
    const xLink = await db.xLink.findUnique({ where: { discordId: who.userId } });
    if (!xLink) return notLinkedReply(who.userId);
    xUsername = xLink.xUsername;
  }

  let wallet: string | null = null;
  if (raffle.walletType !== "NONE") {
    wallet = normalizeWallet(raffle.walletType, walletRaw ?? "");
    if (!wallet) return `❌ Alamat wallet ${raffle.walletType === "EVM" ? "EVM" : "Solana"} tidak valid.`;
  }

  try {
    await db.entry.create({ data: { raffleId, userId: who.userId, username: who.username, wallet, xUsername } });
  } catch (e) {
    if (isUniqueViolation(e)) {
      return uniqueTarget(e).includes("wallet")
        ? "❌ Wallet itu sudah dipakai peserta lain di raffle ini."
        : "✅ Kamu sudah terdaftar di raffle ini.";
    }
    throw e;
  }

  await syncMessageThrottled(raffleId).catch((e) => console.error("[raffle] gagal update embed", e));
  return `✅ Berhasil masuk raffle **${raffle.title}**! Semoga menang 🍀${wallet ? `\nWallet: \`${wallet}\`` : ""}`;
}

export async function entryStatus(raffleId: string, userId: string) {
  const entry = await db.entry.findUnique({ where: { raffleId_userId: { raffleId, userId } } });
  if (!entry) return "Kamu belum masuk raffle ini.";
  const label = { ENTERED: "🎟️ Terdaftar", WON: "🏆 MENANG!", DISQUALIFIED: "⛔ Didiskualifikasi" }[entry.status];
  return `${label}${entry.wallet ? `\nWallet: \`${entry.wallet}\`` : ""}${entry.note ? `\nAlasan: ${entry.note}` : ""}`;
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
    const errors = member
      ? checkRequirements(raffle, { userId: c.userId, roleIds: member.roles })
      : ["Sudah keluar dari server"];
    if (errors.length) {
      await db.entry.update({ where: { id: c.id }, data: { status: "DISQUALIFIED", note: errors.join("; ") } });
      continue;
    }
    await db.entry.update({ where: { id: c.id }, data: { status: "WON" } });
    winners.push(c.userId);
    if (raffle.winnerRoleId) {
      await rest
        .put(Routes.guildMemberRole(raffle.guildId, c.userId, raffle.winnerRoleId), {
          reason: `Menang raffle ${raffle.id}`,
        })
        .catch((e) => console.warn(`[raffle] gagal kasih role pemenang ke ${c.userId}: ${e.message}`));
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
      ? `🎉 Raffle **${raffle.title}** selesai! Selamat kepada pemenang:\n`
      : `Raffle **${raffle.title}** selesai, tapi tidak ada peserta yang memenuhi syarat.`,
    winners,
  ).catch((e) => console.error("[raffle] gagal mengumumkan pemenang", e));
  console.log(`[raffle] ${raffleId} selesai, ${winners.length} pemenang`);
  return true;
}

// Mengakhiri semua raffle yang waktunya sudah lewat (jaring pengaman kalau jadwal QStash gagal).
export async function endOverdueRaffles() {
  const due = await db.raffle.findMany({
    where: { status: "ACTIVE", endsAt: { lte: new Date() } },
    select: { id: true },
  });
  for (const r of due) await endRaffle(r.id).catch((e) => console.error(`[raffle] gagal mengundi ${r.id}`, e));
  return due.length;
}

export async function rerollRaffle(raffleId: string, count: number) {
  const raffle = await db.raffle.findUniqueOrThrow({ where: { id: raffleId } });
  if (raffle.status !== "ENDED") throw new Error("Reroll hanya bisa untuk raffle yang sudah selesai.");
  const winners = await pickWinners(raffle, count);
  await refreshMessage(raffleId);
  if (winners.length) await announce(raffle, `🔁 Reroll **${raffle.title}**! Pemenang tambahan:\n`, winners);
  return winners;
}

export async function cancelRaffle(raffleId: string) {
  const { count } = await db.raffle.updateMany({
    where: { id: raffleId, status: "ACTIVE" },
    data: { status: "CANCELLED", endedAt: new Date() },
  });
  if (!count) throw new Error("Raffle ini sudah tidak aktif.");
  await refreshMessage(raffleId);
}

export async function disqualifyEntry(raffleId: string, entryId: string, note: string) {
  await db.entry.update({ where: { id: entryId, raffleId }, data: { status: "DISQUALIFIED", note } });
  await refreshMessage(raffleId);
}
