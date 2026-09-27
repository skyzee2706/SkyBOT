import { Link } from "react-router-dom";
import { useEffect, useState } from "react";
import QRCode from "qrcode";
import { Check, Copy, Heart } from "lucide-react";
import { LogoMark } from "./Logo";

export const CREATOR = {
  handle: "SkyzeeReal",
  url: "https://x.com/SkyzeeReal",
  avatar: "/creator.jpg",
  wallet: "0xe9973af1b69e407745926fa985c0090e0e78dcf1",
};

export function CreatorCredit({ className = "" }: { className?: string }) {
  return (
    <a
      href={CREATOR.url}
      target="_blank"
      rel="noreferrer"
      className={`inline-flex items-center gap-2 text-sm text-zinc-400 transition hover:text-zinc-100 ${className}`}
    >
      <span>Created by</span>
      <img src={CREATOR.avatar} alt="" className="h-6 w-6 rounded-full ring-1 ring-zinc-700" />
      <span className="font-medium text-zinc-200">@{CREATOR.handle}</span>
    </a>
  );
}

export function DonateModal({ onClose }: { onClose: () => void }) {
  const [qr, setQr] = useState<string | null>(null);
  const [copied, setCopied] = useState(false);

  useEffect(() => {
    QRCode.toDataURL(CREATOR.wallet, { width: 220, margin: 1 }).then(setQr).catch(() => setQr(null));
    const onKey = (e: KeyboardEvent) => e.key === "Escape" && onClose();
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [onClose]);

  const copy = async () => {
    try {
      await navigator.clipboard.writeText(CREATOR.wallet);
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    } catch {
      setCopied(false);
    }
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/70 p-4" onClick={onClose}>
      <div
        role="dialog"
        aria-modal="true"
        aria-labelledby="donate-title"
        className="w-full max-w-sm rounded-2xl border border-zinc-800 bg-zinc-900 p-6 text-center"
        onClick={(e) => e.stopPropagation()}
      >
        <img src={CREATOR.avatar} alt="" className="mx-auto mb-3 h-16 w-16 rounded-full ring-2 ring-brand-500/60" />
        <h2 id="donate-title" className="text-lg font-semibold">
          Support development
        </h2>
        <p className="mb-4 mt-1 text-sm text-zinc-400">
          Enjoying SkyBOT Raffle? Donations help keep it free and growing. Thank you!
        </p>

        {qr && <img src={qr} alt="Wallet address QR code" className="mx-auto mb-4 h-44 w-44 rounded-lg bg-white p-2" />}

        <div className="mb-1 text-xs font-medium uppercase tracking-wide text-zinc-500">EVM wallet</div>
        <div className="mb-3 break-all rounded-lg border border-zinc-800 bg-zinc-950 px-3 py-2 font-mono text-xs text-zinc-200">
          {CREATOR.wallet}
        </div>
        <p className="mb-4 text-xs text-zinc-500">
          Accepts ETH & tokens on any EVM chain (Ethereum, Base, Arbitrum, BNB Chain, Polygon…).
        </p>

        <div className="flex gap-2">
          <button className="btn btn-primary flex-1" onClick={copy}>
            {copied ? (
              <>
                <Check className="h-4 w-4" /> Copied!
              </>
            ) : (
              <>
                <Copy className="h-4 w-4" /> Copy address
              </>
            )}
          </button>
          <button className="btn btn-ghost" onClick={onClose}>
            Close
          </button>
        </div>

        <CreatorCredit className="mt-5" />
      </div>
    </div>
  );
}

export function DonateButton({ className = "" }: { className?: string }) {
  const [open, setOpen] = useState(false);
  return (
    <>
      <button onClick={() => setOpen(true)} className={`btn btn-ghost px-3 py-1.5 text-sm ${className}`}>
        <Heart className="h-4 w-4 fill-pink-400 text-pink-400" /> Donate
      </button>
      {open && <DonateModal onClose={() => setOpen(false)} />}
    </>
  );
}

const FOOTER_LINKS: { title: string; links: { label: string; to: string }[] }[] = [
  {
    title: "Raffles",
    links: [
      { label: "Live raffles", to: "/raffles" },
      { label: "Ended raffles", to: "/raffles?status=ended" },
      { label: "Dashboard", to: "/manage" },
    ],
  },
  {
    title: "Legal",
    links: [
      { label: "Privacy Policy", to: "/privacy" },
      { label: "Terms of Use", to: "/terms" },
    ],
  },
];

// Baris "Created by" + Donate (dipakai di semua halaman)
function CreditBar() {
  return (
    <div className="flex flex-wrap items-center gap-4">
      <CreatorCredit />
      <DonateButton />
    </div>
  );
}

// full = footer lengkap (hanya di landing page); halaman lain cukup Created by + Donate
export function Footer({ full = false }: { full?: boolean }) {
  if (!full) {
    return (
      <footer className="border-t border-brand-500/15">
        <div className="mx-auto flex max-w-6xl justify-end px-4 py-4">
          <CreditBar />
        </div>
      </footer>
    );
  }
  return (
    <footer className="border-t border-brand-500/15">
      <div className="mx-auto max-w-6xl px-4 pb-6 pt-10">
        <div className="flex flex-col gap-8 sm:flex-row sm:justify-between">
          <div className="max-w-xs">
            <Link to="/" className="inline-flex items-center gap-2 font-semibold">
              <LogoMark className="h-7 w-7" />
              <span className="text-brand-50">
                SkyBOT <span className="text-brand-400">Raffle</span>
              </span>
            </Link>
            <p className="mt-3 text-sm leading-relaxed text-zinc-500">Fair allowlist raffles for NFT collectors and Web3 communities.</p>
          </div>
          <div className="flex gap-16">
            {FOOTER_LINKS.map((group) => (
              <nav key={group.title} aria-label={group.title}>
                <h3 className="text-xs font-semibold uppercase tracking-widest text-brand-300/80">{group.title}</h3>
                <ul className="mt-3 space-y-2">
                  {group.links.map((l) => (
                    <li key={l.label}>
                      <Link to={l.to} className="text-sm text-zinc-400 transition hover:text-zinc-100">
                        {l.label}
                      </Link>
                    </li>
                  ))}
                </ul>
              </nav>
            ))}
          </div>
        </div>
        <div className="mt-8 flex flex-col-reverse gap-4 border-t border-zinc-800/80 pt-5 sm:flex-row sm:items-center sm:justify-between">
          <p className="text-xs text-zinc-500">© {new Date().getFullYear()} SkyBOT Raffle. All rights reserved.</p>
          <CreditBar />
        </div>
      </div>
    </footer>
  );
}
