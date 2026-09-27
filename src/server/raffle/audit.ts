import { db } from "../db.js";

export type Actor = { id: string; username: string } | null; // null = otomatis (sistem)

// Catat aksi di riwayat raffle (terlihat oleh host & manager). Gagal mencatat tidak menggagalkan aksinya.
export async function audit(raffleId: string, actor: Actor, action: string, detail?: string) {
  await db.auditLog
    .create({
      data: {
        raffleId,
        actorId: actor?.id ?? "system",
        actorName: actor?.username ?? "SkyBOT",
        action,
        detail: detail?.slice(0, 500),
      },
    })
    .catch((e) => console.error("[audit] failed to record", e));
}
