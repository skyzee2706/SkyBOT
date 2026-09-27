import { randomInt } from "node:crypto";
import { waitUntil } from "@vercel/functions";
import { Routes } from "discord.js";
import type { Allocation, Raffle } from "@prisma/client";
import { hasAllocations } from "../../shared/raffle.js";
import { db } from "../db.js";
import { fetchMember, rest } from "../discord.js";
import { alert } from "../alert.js";
import { audit } from "./audit.js";
import { checkRequirements } from "./requirements.js";
import { scheduleResume } from "./schedule.js";
import { refreshMessage } from "./service.js";

// Undian dibuat bertahap supaya tidak pernah "setengah jadi" secara permanen:
//
//  1. closeRaffle  → status ACTIVE → ENDED (atomik) + tandai drawPending & announcePending.
//  2. runDraw      → undi pemenang yang MASIH KURANG (dihitung dari pemenang yang sudah ada), lalu umumkan.
//                    Kalau terputus (error Discord, batas waktu server), tanda "pending" tetap ada dan undian
//                    dilanjutkan otomatis oleh QStash beberapa detik kemudian (atau cron harian sebagai cadangan).
//
// drawLockUntil memastikan hanya satu proses yang mengundi satu raffle pada saat yang sama.

const DRAW_BUDGET_MS = 40_000; // batas kerja per request (Vercel maxDuration = 60 detik)
const LOCK_MS = 90_000;
const BATCH = 8; // kandidat yang dicek ke Discord bersamaan

export type PickedWinner = { userId: string; allocation: Allocation | null };

class DrawInterrupted extends Error {}

// Jalankan di belakang layar tanpa menahan respons (Vercel tetap menjalankannya sampai selesai)
export function background(task: Promise<unknown>, label: string) {
  waitUntil(task.catch((e) => console.error(`[${label}]`, e)));
}

// Tutup raffle. true = proses ini yang menutupnya (undian perlu dijalankan).
export async function closeRaffle(raffleId: string) {
  const { count } = await db.raffle.updateMany({
    where: { id: raffleId, status: "ACTIVE" },
    data: { status: "ENDED", endedAt: new Date(), drawPending: true, announcePending: true },
  });
  return count > 0;
}

// Tutup + undi sekarang (dipakai tombol "End now" dan jadwal QStash).
export async function endRaffle(raffleId: string) {
  const closed = await closeRaffle(raffleId);
  if (closed) await runDraw(raffleId);
  return closed;
}

// Tutup raffle yang sudah lewat waktunya tanpa menahan request yang sedang berjalan (mis. halaman dibuka pengunjung).
export async function closeOverdueInBackground(raffle: Pick<Raffle, "id" | "status" | "endsAt">) {
  if (raffle.status !== "ACTIVE" || raffle.endsAt.getTime() > Date.now()) return false;
  const closed = await closeRaffle(raffle.id);
  if (closed) background(runDraw(raffle.id), "draw");
  return true;
}

function shuffle<T>(arr: T[]) {
  for (let i = arr.length - 1; i > 0; i--) {
    const j = randomInt(i + 1);
    [arr[i], arr[j]] = [arr[j], arr[i]];
  }
  return arr;
}

// Cek ulang syarat satu kandidat langsung ke Discord. Error sementara → undian dijeda & dilanjutkan nanti.
async function eligibility(raffle: Raffle, userId: string): Promise<string[]> {
  let member;
  try {
    member = await fetchMember(raffle.guildId, userId);
  } catch (e) {
    throw new DrawInterrupted(`Discord error while checking <@${userId}>: ${(e as Error).message}`);
  }
  if (!member && raffle.requireMember) return ["Left the server"];
  // Raffle tanpa syarat member: non-member tetap dicek syarat lain (mis. umur akun), tanpa role
  return checkRequirements(raffle, { userId, roleIds: member?.roles ?? [] });
}

// Undi sampai jumlah pemenang tiap allocation terpenuhi. false = waktu habis (dilanjutkan nanti).
// GTD diundi dulu, lalu FCFS dari peserta sisanya, jadi satu orang tidak bisa menang dua kali.
async function drawWinners(raffle: Raffle, deadline: number, picked: PickedWinner[]): Promise<boolean> {
  const groups: [Allocation | null, number][] = hasAllocations(raffle)
    ? [
        ["GTD", raffle.gtdCount],
        ["FCFS", raffle.fcfsCount],
      ]
    : [[null, raffle.winnerCount]]; // raffle lama tanpa allocation

  for (const [allocation, target] of groups) {
    let need = target - (await db.entry.count({ where: { raffleId: raffle.id, status: "WON", allocation } }));
    if (need <= 0) continue;
    const pool = shuffle(
      await db.entry.findMany({ where: { raffleId: raffle.id, status: "ENTERED" }, select: { id: true, userId: true } }),
    );
    let i = 0;
    while (i < pool.length && need > 0) {
      if (Date.now() > deadline) return false;
      // Cek beberapa kandidat sekaligus (sedikit lebih banyak dari yang dibutuhkan, untuk cadangan yang gugur)
      const batch = pool.slice(i, i + Math.min(BATCH, need + 2));
      i += batch.length;
      const results = await Promise.all(batch.map((c) => eligibility(raffle, c.userId)));
      // Diproses berurutan sesuai hasil acak; berhenti tepat saat kuota terpenuhi
      for (const [n, c] of batch.entries()) {
        if (need <= 0) break;
        const errors = results[n];
        if (errors.length) {
          await db.entry.update({ where: { id: c.id }, data: { status: "DISQUALIFIED", note: errors.join("; ") } });
          continue;
        }
        await db.entry.update({ where: { id: c.id }, data: { status: "WON", allocation } });
        picked.push({ userId: c.userId, allocation });
        need--;
        if (raffle.winnerRoleId) {
          await rest
            .put(Routes.guildMemberRole(raffle.guildId, c.userId, raffle.winnerRoleId), { reason: `Won raffle ${raffle.id}` })
            .catch((e) => console.warn(`[draw] failed to give winner role to ${c.userId}: ${e.message}`));
        }
      }
    }
  }
  return true;
}

// Kirim teks panjang berisi mention, dipecah per ±1900 karakter (batas Discord 2000 & 100 mention per pesan).
async function postMentions(raffle: Raffle, lines: string[], replyToRaffle: boolean) {
  const chunks: string[] = [];
  let cur = "";
  for (const line of lines) {
    const next = cur ? `${cur}${line.startsWith("\n") || cur.endsWith("\n") ? "" : " "}${line}` : line.replace(/^\n/, "");
    if (next.length > 1900 && cur) {
      chunks.push(cur);
      cur = line.replace(/^\n/, "");
    } else cur = next;
  }
  if (cur) chunks.push(cur);
  for (const [i, content] of chunks.entries()) {
    await rest.post(Routes.channelMessages(raffle.channelId), {
      body: {
        content,
        allowed_mentions: { users: [...content.matchAll(/<@(\d+)>/g)].map((m) => m[1]) },
        message_reference:
          replyToRaffle && i === 0 && raffle.messageId ? { message_id: raffle.messageId, fail_if_not_exists: false } : undefined,
      },
    });
  }
}

// Pengumuman utama: semua pemenang, dikelompokkan per allocation.
async function announceWinners(raffle: Raffle) {
  const winners = await db.entry.findMany({
    where: { raffleId: raffle.id, status: "WON" },
    orderBy: [{ allocation: "asc" }, { createdAt: "asc" }],
    select: { userId: true, allocation: true },
  });
  if (!winners.length) {
    await postMentions(raffle, [`**${raffle.title}** has ended, but no participants met the requirements.`], true);
    return;
  }
  const lines = [`🎉 **${raffle.title}** has ended! Congratulations to the winners:`];
  if (hasAllocations(raffle)) {
    for (const [a, title] of [
      ["GTD", "**🏆 GTD Winners**"],
      ["FCFS", "**🎟️ FCFS Winners**"],
    ] as const) {
      const ids = winners.filter((w) => w.allocation === a).map((w) => `<@${w.userId}>`);
      if (ids.length) lines.push(`\n${title}\n`, ...ids);
    }
  } else {
    lines.push("\n", ...winners.map((w) => `<@${w.userId}>`));
  }
  await postMentions(raffle, lines, true);
}

// Undi (lanjutkan) & umumkan satu raffle. Aman dipanggil berkali-kali dan dari beberapa tempat sekaligus.
export async function runDraw(raffleId: string, deadline = Date.now() + DRAW_BUDGET_MS): Promise<"done" | "partial" | "skipped"> {
  const now = new Date();
  const { count } = await db.raffle.updateMany({
    where: {
      id: raffleId,
      status: "ENDED",
      OR: [{ drawPending: true }, { announcePending: true }],
      AND: [{ OR: [{ drawLockUntil: null }, { drawLockUntil: { lt: now } }] }],
    },
    data: { drawLockUntil: new Date(now.getTime() + LOCK_MS) },
  });
  if (!count) return "skipped"; // tidak ada yang perlu dikerjakan, atau sedang dikerjakan proses lain

  const picked: PickedWinner[] = [];
  let raffle = await db.raffle.findUniqueOrThrow({ where: { id: raffleId } });
  try {
    if (raffle.drawPending) {
      if (!(await drawWinners(raffle, deadline, picked))) {
        await scheduleResume(raffleId);
        return "partial";
      }
      raffle = await db.raffle.update({ where: { id: raffleId }, data: { drawPending: false } });
    }
    await refreshMessage(raffleId).catch((e) => console.error("[draw] failed to update embed", e));

    if (raffle.announcePending) {
      await announceWinners(raffle);
      await db.raffle.update({ where: { id: raffleId }, data: { announcePending: false } });
      const total = await db.entry.count({ where: { raffleId, status: "WON" } });
      await audit(raffleId, null, "drawn", `${total} winner${total === 1 ? "" : "s"}`);
    } else if (picked.length) {
      // Pengumuman sudah terkirim sebelumnya → ini pemenang pengganti (setelah diskualifikasi)
      await postMentions(
        raffle,
        [`🔁 Replacement winner${picked.length > 1 ? "s" : ""} for **${raffle.title}**:`, ...picked.map((p) => `<@${p.userId}>${p.allocation ? ` (${p.allocation})` : ""}`)],
        true,
      );
      await audit(raffleId, null, "replacement", picked.map((p) => p.userId).join(", "));
    }
    await db.raffle.update({ where: { id: raffleId }, data: { drawError: null } });
    console.log(`[draw] ${raffleId} done (${picked.length} picked this run)`);
    return "done";
  } catch (e) {
    const message = e instanceof Error ? e.message : String(e);
    console.error(`[draw] ${raffleId} interrupted`, e);
    await db.raffle.update({ where: { id: raffleId }, data: { drawError: message.slice(0, 500) } }).catch(() => {});
    await alert(`Draw interrupted for **${raffle.title}** (\`${raffleId}\`) — it will retry automatically.\n${message}`);
    await scheduleResume(raffleId).catch((err) => console.error("[draw] failed to schedule retry", err));
    return "partial";
  } finally {
    await db.raffle.update({ where: { id: raffleId }, data: { drawLockUntil: null } }).catch(() => {});
  }
}

// Jaring pengaman (cron harian / dev ticker): tutup raffle yang lewat waktu & lanjutkan undian yang tertunda.
export async function sweepDraws() {
  const now = new Date();
  const [overdue, pending] = await Promise.all([
    db.raffle.findMany({ where: { status: "ACTIVE", endsAt: { lte: now } }, select: { id: true } }),
    db.raffle.findMany({
      where: {
        status: "ENDED",
        OR: [{ drawPending: true }, { announcePending: true }],
        AND: [{ OR: [{ drawLockUntil: null }, { drawLockUntil: { lt: now } }] }],
      },
      select: { id: true },
    }),
  ]);
  for (const r of overdue) await closeRaffle(r.id);
  const ids = [...new Set([...overdue, ...pending].map((r) => r.id))];
  for (const id of ids) await runDraw(id).catch((e) => console.error(`[draw] sweep failed for ${id}`, e));
  return ids.length;
}

// Diskualifikasi peserta. Kalau dia pemenang dari raffle yang sudah diundi, spotnya otomatis diundi ulang
// dari peserta lain (allocation yang sama) dan pemenang pengganti diumumkan di channel.
export async function disqualifyEntry(raffleId: string, entryId: string, note: string) {
  const entry = await db.entry.findFirst({ where: { id: entryId, raffleId } });
  if (!entry) return { replaced: false };
  const wasWinner = entry.status === "WON";
  const raffle = await db.raffle.update({
    where: { id: raffleId },
    data: wasWinner ? { drawPending: true } : {},
  });
  await db.entry.update({ where: { id: entryId }, data: { status: "DISQUALIFIED", allocation: null, note } });
  if (wasWinner && raffle.winnerRoleId) {
    await rest
      .delete(Routes.guildMemberRole(raffle.guildId, entry.userId, raffle.winnerRoleId), { reason: `Disqualified from raffle ${raffleId}` })
      .catch((e) => console.warn(`[draw] failed to remove winner role from ${entry.userId}: ${e.message}`));
  }
  if (wasWinner && raffle.status === "ENDED") await runDraw(raffleId);
  else await refreshMessage(raffleId);
  return { replaced: wasWinner && raffle.status === "ENDED" };
}

export async function cancelRaffle(raffleId: string) {
  const { count } = await db.raffle.updateMany({
    where: { id: raffleId, status: "ACTIVE" },
    data: { status: "CANCELLED", endedAt: new Date() },
  });
  if (!count) throw new Error("This raffle is no longer active.");
  await refreshMessage(raffleId);
}
