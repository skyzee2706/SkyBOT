import { SnowflakeUtil } from "discord.js";
import type { Raffle, WalletType } from "@prisma/client";

export type RequirementInput = Pick<Raffle, "requiredRoleIds" | "requireAnyRole" | "blockedRoleIds" | "minAccountAgeDays">;

export type CheckContext = {
  userId: string;
  roleIds: string[];
};

type Check = (raffle: RequirementInput, ctx: CheckContext) => string | null;

// Tiap check mengembalikan pesan error atau null kalau lolos.
// Requirement baru (mis. X/Twitter, holding NFT) tinggal ditambah ke daftar ini.
const checks: Check[] = [
  (r, ctx) => {
    if (!r.requiredRoleIds.length) return null;
    const roles = (ids: string[]) => ids.map((id) => `<@&${id}>`).join(", ");
    if (r.requireAnyRole) {
      return r.requiredRoleIds.some((id) => ctx.roleIds.includes(id)) ? null : `You need one of these roles: ${roles(r.requiredRoleIds)}`;
    }
    const missing = r.requiredRoleIds.filter((id) => !ctx.roleIds.includes(id));
    return missing.length ? `Missing required role: ${roles(missing)}` : null;
  },
  (r, ctx) => {
    const blocked = r.blockedRoleIds.filter((id) => ctx.roleIds.includes(id));
    return blocked.length ? `Role ${blocked.map((id) => `<@&${id}>`).join(", ")} is not allowed in this raffle` : null;
  },
  (r, ctx) => {
    if (!r.minAccountAgeDays) return null;
    const ageDays = (Date.now() - Number(SnowflakeUtil.timestampFrom(ctx.userId))) / 86_400_000;
    return ageDays < r.minAccountAgeDays ? `Your Discord account must be at least ${r.minAccountAgeDays} days old` : null;
  },
];

export function checkRequirements(raffle: RequirementInput, ctx: CheckContext): string[] {
  return checks.map((c) => c(raffle, ctx)).filter((x): x is string => x !== null);
}

const EVM_RE = /^0x[a-fA-F0-9]{40}$/;
const SOL_RE = /^[1-9A-HJ-NP-Za-km-z]{32,44}$/;
const CUSTOM_RE = /^[\x21-\x7e]{8,255}$/;

export function normalizeWallet(type: WalletType, raw: string): string | null {
  const v = raw.trim();
  if (type === "EVM") return EVM_RE.test(v) ? v.toLowerCase() : null;
  if (type === "SOL") return SOL_RE.test(v) ? v : null;
  // Chain manual: formatnya beda-beda (Zcash, Sui, Aptos...), cukup dicek panjang & tanpa spasi
  if (type === "CUSTOM") return CUSTOM_RE.test(v) ? v : null;
  return null;
}
