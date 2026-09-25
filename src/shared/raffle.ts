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

export const isChainId = (v: unknown): v is ChainId => typeof v === "string" && v in CHAINS;
export const chainLabel = (v: string | null | undefined) => (isChainId(v) ? CHAINS[v].label : null);

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
