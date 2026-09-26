import { useEffect, useState, type FormEvent } from "react";
import { ArrowLeft, ChevronRight, X } from "lucide-react";
import { api } from "./api";

export type WalletKind = "EVM" | "SOL";
export type Profile = {
  wallets: Record<WalletKind, string | null>;
  xUsername: string | null;
  connectXUrl: string | null;
};

const WALLETS: Record<WalletKind, { label: string; placeholder: string; test: RegExp }> = {
  EVM: { label: "EVM wallet", placeholder: "0x...", test: /^0x[a-fA-F0-9]{40}$/ },
  SOL: { label: "Solana wallet", placeholder: "Your Solana address", test: /^[1-9A-HJ-NP-Za-km-z]{32,44}$/ },
};

const short = (w: string) => `${w.slice(0, 6)}...${w.slice(-4)}`;

// Logo X (bukan emoji) supaya tampil sama di semua perangkat
export function XLogo({ className = "h-4 w-4" }: { className?: string }) {
  return (
    <svg viewBox="0 0 24 24" className={className} fill="currentColor" aria-hidden="true">
      <path d="M18.244 2.25h3.308l-7.227 8.26 8.502 11.24H16.17l-5.214-6.817L4.99 21.75H1.68l7.73-8.835L1.254 2.25H8.08l4.713 6.231zm-1.161 17.52h1.833L7.084 4.126H5.117z" />
    </svg>
  );
}

// Wallet disimpan sekali di profil dan dipakai otomatis untuk semua raffle (web & Discord)
export function WalletDialog({ profile, onClose, onSaved }: { profile: Profile; onClose: () => void; onSaved: (p: Profile) => void }) {
  const [kind, setKind] = useState<WalletKind | null>(null);
  const [value, setValue] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => e.key === "Escape" && onClose();
    document.addEventListener("keydown", onKey);
    return () => document.removeEventListener("keydown", onKey);
  }, [onClose]);

  const pick = (k: WalletKind) => {
    setKind(k);
    setValue(profile.wallets[k] ?? "");
    setError(null);
  };

  const save = async (e: FormEvent) => {
    e.preventDefault();
    if (!kind) return;
    const address = value.trim();
    if (!WALLETS[kind].test.test(address)) return setError(`Invalid ${kind === "EVM" ? "EVM" : "Solana"} wallet address.`);
    setBusy(true);
    setError(null);
    try {
      const { wallet } = await api<{ wallet: string }>("/p/me/wallet", { body: { type: kind, address } });
      onSaved({ ...profile, wallets: { ...profile.wallets, [kind]: wallet } });
      setKind(null);
    } catch (err) {
      setError((err as Error).message);
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="fixed inset-0 z-50 grid place-items-center bg-black/70 p-4 backdrop-blur-sm" onMouseDown={(e) => e.target === e.currentTarget && onClose()}>
      <div role="dialog" aria-modal="true" className="card w-full max-w-md space-y-4 bg-zinc-900 shadow-2xl">
        <div className="flex items-center justify-between gap-3">
          <div className="flex items-center gap-2">
            {kind && (
              <button type="button" onClick={() => setKind(null)} className="rounded-md p-1 text-zinc-400 hover:bg-zinc-800" aria-label="Back">
                <ArrowLeft className="h-4 w-4" />
              </button>
            )}
            <h2 className="font-semibold">{kind ? WALLETS[kind].label : "Connect Wallet"}</h2>
          </div>
          <button type="button" onClick={onClose} className="rounded-md p-1 text-zinc-400 hover:bg-zinc-800" aria-label="Close">
            <X className="h-4 w-4" />
          </button>
        </div>

        {!kind ? (
          <div className="space-y-2">
            {(Object.keys(WALLETS) as WalletKind[]).map((k) => (
              <button
                key={k}
                type="button"
                onClick={() => pick(k)}
                className="flex w-full items-center justify-between gap-3 rounded-lg border border-zinc-700 px-4 py-3 text-left hover:border-brand-500/50"
              >
                <div>
                  <div className="text-sm font-medium">{WALLETS[k].label}</div>
                  <div className={`font-mono text-xs ${profile.wallets[k] ? "text-emerald-400" : "text-zinc-500"}`}>
                    {profile.wallets[k] ? short(profile.wallets[k]!) : "Not connected"}
                  </div>
                </div>
                <ChevronRight className="h-4 w-4 text-zinc-500" />
              </button>
            ))}
          </div>
        ) : (
          <form onSubmit={save} className="space-y-3">
            <div>
              <label className="label">Paste your {kind === "EVM" ? "EVM" : "Solana"} wallet address</label>
              <input
                autoFocus
                className="input font-mono"
                placeholder={WALLETS[kind].placeholder}
                value={value}
                onChange={(e) => setValue(e.target.value.trim())}
              />
            </div>
            {error && <p className="text-sm text-red-400">{error}</p>}
            <button className="btn btn-primary w-full" disabled={busy || !value}>
              {busy ? "Saving..." : "Save wallet"}
            </button>
          </form>
        )}
      </div>
    </div>
  );
}
