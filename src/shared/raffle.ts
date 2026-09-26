// Dipakai bersama oleh server dan web supaya daftar chain & label allocation selalu sama.

export const CHAINS = {
  ETHEREUM: { label: "Ethereum", wallet: "EVM" },
  BASE: { label: "Base", wallet: "EVM" },
  ROBINHOOD: { label: "Robinhood", wallet: "EVM" },
  INK: { label: "Ink", wallet: "EVM" },
  ARC: { label: "Arc", wallet: "EVM" },
  UNICHAIN: { label: "Unichain", wallet: "EVM" },
  SOLANA: { label: "Solana", wallet: "SOL" },
} as const;

export type ChainId = keyof typeof CHAINS;
export const CHAIN_IDS = Object.keys(CHAINS) as ChainId[];

export const isChainId = (v: unknown): v is ChainId => typeof v === "string" && Object.hasOwn(CHAINS, v);
export const CUSTOM_CHAIN_MAX = 40;

// Chain disimpan sebagai ID dari daftar (mis. "ARC") atau nama yang ditulis manual (mis. "Monad").
export const chainLabel = (v: string | null | undefined) => (!v ? null : isChainId(v) ? CHAINS[v].label : v);

// Nama manual yang sama dengan chain di daftar (mis. "base") disamakan jadi ID-nya, supaya aturan wallet tetap berlaku.
export function normalizeChain(raw: string): string {
  const name = raw.replace(/\s+/g, " ").trim().slice(0, CUSTOM_CHAIN_MAX);
  const preset = CHAIN_IDS.find((id) => id === name.toUpperCase() || CHAINS[id].label.toLowerCase() === name.toLowerCase());
  return preset ?? name;
}

// Wallet yang wajib dipakai untuk chain ini; null = chain manual (boleh EVM atau Solana)
export const chainWallet = (v: string | null | undefined) => (isChainId(v) ? CHAINS[v].wallet : null);

export type AllocationType = "GTD" | "FCFS";
export const ALLOCATIONS: AllocationType[] = ["GTD", "FCFS"];

type AllocationCounts = { gtdCount: number; fcfsCount: number; winnerCount: number };

// Raffle lama (sebelum ada allocation) punya gtdCount = fcfsCount = 0.
export const hasAllocations = (r: AllocationCounts) => r.gtdCount + r.fcfsCount > 0;
export const allocationCount = (r: AllocationCounts, a: AllocationType) => (a === "GTD" ? r.gtdCount : r.fcfsCount);

// "GTD 14 · FCFS 20" / "GTD 14" / "3 winners" (raffle lama)
export function allocationSummary(r: AllocationCounts, sep = " · ") {
  if (!hasAllocations(r)) return `${r.winnerCount} winner${r.winnerCount === 1 ? "" : "s"}`;
  return ALLOCATIONS.filter((a) => allocationCount(r, a) > 0)
    .map((a) => `${a} ${allocationCount(r, a)}`)
    .join(sep);
}

// Halaman raffle publik (peserta bisa ikut lewat web)
export const publicRafflePath = (raffleId: string) => `/raffle/${raffleId}`;
// Hanya path halaman raffle publik yang boleh jadi tujuan redirect (mencegah open redirect)
export const safeReturnPath = (v: unknown): string | null =>
  typeof v === "string" && /^\/raffle\/[A-Za-z0-9]{1,40}$/.test(v) ? v : null;
