import { SnowflakeUtil } from "discord.js";
import type { Raffle, WalletType } from "@prisma/client";

export type RequirementInput = Pick<Raffle, "requiredRoleIds" | "blockedRoleIds" | "minAccountAgeDays">;

export type CheckContext = {
  userId: string;
  roleIds: string[];
};

type Check = (raffle: RequirementInput, ctx: CheckContext) => string | null;

// Tiap check mengembalikan pesan error atau null kalau lolos.
// Requirement baru (mis. X/Twitter, holding NFT) tinggal ditambah ke daftar ini.
const checks: Check[] = [
  (r, ctx) => {
    const missing = r.requiredRoleIds.filter((id) => !ctx.roleIds.includes(id));
    return missing.length ? `Kamu belum punya role: ${missing.map((id) => `<@&${id}>`).join(", ")}` : null;
  },
  (r, ctx) => {
    const blocked = r.blockedRoleIds.filter((id) => ctx.roleIds.includes(id));
    return blocked.length ? `Role ${blocked.map((id) => `<@&${id}>`).join(", ")} tidak boleh ikut raffle ini` : null;
  },
  (r, ctx) => {
    if (!r.minAccountAgeDays) return null;
    const ageDays = (Date.now() - Number(SnowflakeUtil.timestampFrom(ctx.userId))) / 86_400_000;
    return ageDays < r.minAccountAgeDays ? `Akun Discord kamu harus berumur minimal ${r.minAccountAgeDays} hari` : null;
  },
];

export function checkRequirements(raffle: RequirementInput, ctx: CheckContext): string[] {
  return checks.map((c) => c(raffle, ctx)).filter((x): x is string => x !== null);
}

const EVM_RE = /^0x[a-fA-F0-9]{40}$/;
const SOL_RE = /^[1-9A-HJ-NP-Za-km-z]{32,44}$/;

export function normalizeWallet(type: WalletType, raw: string): string | null {
  const v = raw.trim();
  if (type === "EVM") return EVM_RE.test(v) ? v.toLowerCase() : null;
  if (type === "SOL") return SOL_RE.test(v) ? v : null;
  return null;
}
