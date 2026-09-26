import { useEffect, useState } from "react";
import { Link } from "react-router-dom";
import {
  ArrowRight,
  AtSign,
  Check,
  Search,
  Users,
  Dices,
  FileSpreadsheet,
  Globe,
  MousePointerClick,
  PenLine,
  ShieldCheck,
  Sparkles,
  Trophy,
  type LucideIcon,
} from "lucide-react";
import { api } from "../api";
import { RaffleCard, type RaffleCardData } from "./RafflesList";

type Stats = { raffles: number; live: number; entries: number; winners: number; communities: number };

const FEATURES: { icon: LucideIcon; title: string; text: string }[] = [
  {
    icon: Trophy,
    title: "GTD & FCFS allocations",
    text: "Run guaranteed and first-come spots in one raffle. GTD is drawn first, so no one can win twice.",
  },
  {
    icon: Globe,
    title: "Enter from Discord or the web",
    text: "Members click Enter in Discord or join from a public raffle page. Same rules, one entry each.",
  },
  {
    icon: AtSign,
    title: "X tasks built in",
    text: "Follow, like, retweet and quote tasks with tracked links. Entry unlocks once every task is opened.",
  },
  {
    icon: ShieldCheck,
    title: "Requirement checks",
    text: "Server membership, roles, account age and unique wallets are checked on entry and again at the draw.",
  },
  {
    icon: Dices,
    title: "Fair, secure draws",
    text: "Winners are picked with a cryptographically secure generator, exactly when the timer runs out.",
  },
  {
    icon: FileSpreadsheet,
    title: "Winner exports",
    text: "Download winners to Excel with separate GTD and FCFS tables, ready to send to any project.",
  },
];

const AUDIENCES: { icon: LucideIcon; eyebrow: string; title: string; points: string[]; cta: string; to: string }[] = [
  {
    icon: Search,
    eyebrow: "For collectors",
    title: "Hunt allowlist spots in one place",
    points: [
      "Browse live raffles from every community on SkyBOT",
      "Filter by chain, GTD or FCFS, and raffles open to everyone",
      "Enter on the web, no Discord server join needed when the raffle allows it",
      "Track every entry and win on your My Entries page",
    ],
    cta: "Find WL spots",
    to: "/raffles",
  },
  {
    icon: Users,
    eyebrow: "For communities",
    title: "Run raffles your members trust",
    points: [
      "Create once on the web, the bot posts and updates it in Discord",
      "GTD and FCFS allocations with roles, wallet and X task requirements",
      "Reach collectors beyond your server with a public raffle page",
      "Export winners to Excel, split by allocation",
    ],
    cta: "Create a raffle",
    to: "/create",
  },
];

const STEPS: { icon: LucideIcon; title: string; text: string }[] = [
  { icon: PenLine, title: "Create on the web", text: "Set allocations, chain, requirements and X tasks in one form." },
  { icon: MousePointerClick, title: "Collectors enter", text: "From Discord or the public raffle page, with the same rules." },
  { icon: Sparkles, title: "Winners are drawn", text: "Results are announced in Discord and shown on the raffle page." },
];

const nf = new Intl.NumberFormat("en-US", { notation: "compact", maximumFractionDigits: 1 });

// Halaman utama: perkenalan SkyBOT + raffle yang sedang live
export function LandingPage() {
  const [stats, setStats] = useState<Stats | null>(null);
  const [live, setLive] = useState<RaffleCardData[]>([]);
  const [now, setNow] = useState(Date.now());

  useEffect(() => {
    api<Stats>("/p/stats").then(setStats).catch(() => {});
    api<{ raffles: RaffleCardData[] }>("/p/raffles?status=live&page=0")
      .then((d) => setLive(d.raffles.slice(0, 3)))
      .catch(() => {});
    const t = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(t);
  }, []);

  return (
    <div className="space-y-24 pb-8">
      {/* Hero */}
      <section className="relative pt-6 text-center sm:pt-12">
        <div
          aria-hidden="true"
          className="pointer-events-none absolute left-1/2 top-0 -z-10 h-72 w-72 -translate-x-1/2 rounded-full bg-brand-500/25 blur-3xl"
        />
        <img
          src="/logo.png"
          alt="SkyBOT"
          className="mx-auto h-24 w-24 rounded-3xl shadow-[0_0_60px_-10px_rgb(242_150_58/0.6)] ring-1 ring-brand-500/40"
        />
        <div className="mx-auto mt-8 inline-flex items-center gap-2 rounded-full border border-brand-500/30 bg-brand-500/10 px-3 py-1 text-xs font-medium text-brand-200">
          <span className="h-1.5 w-1.5 rounded-full bg-brand-400" /> For NFT collectors and Web3 communities
        </div>
        <h1 className="mx-auto mt-5 max-w-3xl text-4xl font-bold leading-tight tracking-tight sm:text-6xl">
          Find allowlist spots.{" "}
          <br className="hidden sm:block" />
          <span className="bg-gradient-to-r from-brand-300 via-brand-400 to-brand-600 bg-clip-text text-transparent">
            Run fair raffles.
          </span>
        </h1>
        <p className="mx-auto mt-5 max-w-xl text-base text-zinc-400 sm:text-lg">
          Hunt GTD and FCFS spots from NFT projects across every chain, many open to everyone with no Discord join
          needed. Or run your own raffle for your community in under a minute.
        </p>
        <div className="mt-8 flex flex-col items-center justify-center gap-3 sm:flex-row">
          <Link to="/raffles" className="btn btn-primary w-full px-6 py-3 text-base sm:w-auto">
            Find WL spots <ArrowRight className="h-4 w-4" />
          </Link>
          <Link to="/create" className="btn btn-ghost w-full px-6 py-3 text-base sm:w-auto">
            Create a raffle
          </Link>
        </div>

        {stats && stats.raffles > 0 && (
          <div className="mx-auto mt-14 grid max-w-3xl grid-cols-2 gap-px overflow-hidden rounded-2xl border border-zinc-800 bg-zinc-800 sm:grid-cols-4">
            {[
              ["Raffles hosted", stats.raffles],
              ["Live now", stats.live],
              ["Entries", stats.entries],
              ["Communities", stats.communities],
            ].map(([label, value]) => (
              <div key={label} className="bg-zinc-900 px-4 py-5">
                <div className="text-2xl font-bold text-brand-100 tabular-nums sm:text-3xl">{nf.format(Number(value))}</div>
                <div className="mt-1 text-xs uppercase tracking-wide text-brand-300/80">{label}</div>
              </div>
            ))}
          </div>
        )}
      </section>

      {/* Raffle yang sedang live */}
      {live.length > 0 && (
        <section>
          <div className="mb-6 flex items-end justify-between gap-4">
            <div>
              <div className="flex items-center gap-2 text-sm font-medium text-emerald-400">
                <span className="relative flex h-2 w-2">
                  <span className="absolute inline-flex h-full w-full animate-ping rounded-full bg-emerald-400 opacity-60" />
                  <span className="relative inline-flex h-2 w-2 rounded-full bg-emerald-400" />
                </span>
                Live now
              </div>
              <h2 className="mt-1 text-2xl font-bold sm:text-3xl">Enter a raffle today</h2>
            </div>
            <Link to="/raffles" className="hidden items-center gap-1 text-sm text-brand-300 hover:text-brand-200 sm:inline-flex">
              View all <ArrowRight className="h-4 w-4" />
            </Link>
          </div>
          <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
            {live.map((r) => (
              <RaffleCard key={r.id} r={r} now={now} />
            ))}
          </div>
          <Link to="/raffles" className="btn btn-ghost mt-6 w-full sm:hidden">
            View all raffles <ArrowRight className="h-4 w-4" />
          </Link>
        </section>
      )}

      {/* Dua jenis pengguna: pemburu WL & komunitas */}
      <section className="grid gap-4 lg:grid-cols-2">
        {AUDIENCES.map(({ icon: Icon, eyebrow, title, points, cta, to }) => (
          <div key={title} className="card relative flex flex-col overflow-hidden p-7">
            <div aria-hidden="true" className="pointer-events-none absolute -right-16 -top-16 h-48 w-48 rounded-full bg-brand-500/10 blur-2xl" />
            <div className="flex items-center gap-3">
              <div className="grid h-11 w-11 place-items-center rounded-xl bg-brand-500/15 text-brand-300 ring-1 ring-brand-500/25">
                <Icon className="h-5 w-5" />
              </div>
              <div className="text-xs font-medium uppercase tracking-widest text-brand-400">{eyebrow}</div>
            </div>
            <h2 className="mt-5 text-2xl font-bold">{title}</h2>
            <ul className="mt-5 flex-1 space-y-3">
              {points.map((p) => (
                <li key={p} className="flex gap-3 text-sm text-zinc-300">
                  <Check className="mt-0.5 h-4 w-4 shrink-0 text-brand-400" /> {p}
                </li>
              ))}
            </ul>
            <Link to={to} className="btn btn-ghost mt-7 self-start">
              {cta} <ArrowRight className="h-4 w-4" />
            </Link>
          </div>
        ))}
      </section>

      {/* Fitur */}
      <section>
        <div className="mx-auto mb-10 max-w-2xl text-center">
          <div className="text-sm font-medium uppercase tracking-widest text-brand-400">Features</div>
          <h2 className="mt-2 text-2xl font-bold sm:text-3xl">Everything a raffle needs, nothing it doesn't</h2>
        </div>
        <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
          {FEATURES.map(({ icon: Icon, title, text }) => (
            <div key={title} className="card transition hover:border-brand-500/40">
              <div className="mb-4 grid h-10 w-10 place-items-center rounded-xl bg-brand-500/15 text-brand-300 ring-1 ring-brand-500/25">
                <Icon className="h-5 w-5" />
              </div>
              <h3 className="font-semibold text-brand-50">{title}</h3>
              <p className="mt-2 text-sm leading-relaxed text-zinc-400">{text}</p>
            </div>
          ))}
        </div>
      </section>

      {/* Cara kerja */}
      <section>
        <div className="mx-auto mb-10 max-w-2xl text-center">
          <div className="text-sm font-medium uppercase tracking-widest text-brand-400">How it works</div>
          <h2 className="mt-2 text-2xl font-bold sm:text-3xl">From idea to winners in three steps</h2>
        </div>
        <ol className="grid gap-4 sm:grid-cols-3">
          {STEPS.map(({ icon: Icon, title, text }, i) => (
            <li key={title} className="card relative overflow-hidden">
              <span className="absolute -right-2 -top-6 text-8xl font-black text-brand-500/10">{i + 1}</span>
              <Icon className="h-6 w-6 text-brand-400" />
              <h3 className="mt-4 font-semibold text-brand-50">{title}</h3>
              <p className="mt-2 text-sm text-zinc-400">{text}</p>
            </li>
          ))}
        </ol>
      </section>

      {/* Ajakan akhir */}
      <section className="relative overflow-hidden rounded-3xl border border-brand-500/30 bg-gradient-to-br from-brand-500/20 via-zinc-900 to-zinc-900 px-6 py-12 text-center sm:px-12">
        <div aria-hidden="true" className="pointer-events-none absolute -right-20 -top-20 h-64 w-64 rounded-full bg-brand-500/20 blur-3xl" />
        <h2 className="text-2xl font-bold sm:text-3xl">Your next allowlist is one click away</h2>
        <p className="mx-auto mt-3 max-w-lg text-zinc-400">
          Collectors: find a raffle and enter in seconds. Communities: log in with Discord and have a raffle live in under a
          minute.
        </p>
        <div className="mt-7 flex flex-col items-center justify-center gap-3 sm:flex-row">
          <Link to="/raffles" className="btn btn-primary w-full px-6 py-3 text-base sm:w-auto">
            Find WL spots <ArrowRight className="h-4 w-4" />
          </Link>
          <Link to="/create" className="btn btn-ghost w-full px-6 py-3 text-base sm:w-auto">
            Create a raffle
          </Link>
        </div>
      </section>
    </div>
  );
}
