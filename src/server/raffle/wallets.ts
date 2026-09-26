import type { WalletType } from "@prisma/client";
import { db, isUniqueViolation } from "../db.js";
import { normalizeWallet } from "./requirements.js";

export type WalletKind = "EVM" | "SOL"; // hanya wallet ini yang disimpan di profil
const field = (type: WalletKind) => (type === "EVM" ? "evm" : "sol");

// Wallet tersimpan milik user untuk jenis ini (null = belum pernah diisi)
export async function savedWallet(discordId: string, type: WalletType): Promise<string | null> {
  if (type !== "EVM" && type !== "SOL") return null; // chain manual: selalu diisi di form
  const w = await db.userWallet.findUnique({ where: { discordId } });
  return w?.[field(type)] ?? null;
}

// Simpan / ganti wallet user. Raffle yang masih berjalan ikut memakai wallet baru;
// raffle yang sudah selesai tetap memakai wallet saat diundi.
export async function saveWallet(discordId: string, type: WalletKind, raw: string): Promise<{ wallet: string } | { error: string }> {
  const wallet = normalizeWallet(type, raw);
  if (!wallet) return { error: `Invalid ${type === "EVM" ? "EVM" : "Solana"} wallet address.` };
  const f = field(type);
  try {
    await db.userWallet.upsert({ where: { discordId }, create: { discordId, [f]: wallet }, update: { [f]: wallet } });
  } catch (e) {
    if (isUniqueViolation(e)) return { error: "That wallet is already connected to another Discord account." };
    throw e;
  }
  const entries = await db.entry.findMany({
    where: { userId: discordId, status: "ENTERED", raffle: { status: "ACTIVE", walletType: type }, NOT: { wallet } },
    select: { id: true },
  });
  for (const e of entries) {
    await db.entry.update({ where: { id: e.id }, data: { wallet } }).catch((err) => {
      if (!isUniqueViolation(err)) throw err; // wallet ini sudah dipakai peserta lain di raffle itu (data lama)
    });
  }
  return { wallet };
}
