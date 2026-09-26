import { useCallback, useEffect, useState, type ReactNode } from "react";
import { Link, useSearchParams } from "react-router-dom";
import { Globe, Search, SlidersHorizontal, Ticket, Users, X } from "lucide-react";
import { api, setPageTitle } from "../api";
import { ErrorBox, Loading, Pagination } from "../components";
import { CHAIN_IDS, CHAINS } from "../../shared/raffle";

export type RaffleCardData = {
  id: string;
  title: string;
  imageUrl: string | null;
  status: "ACTIVE" | "ENDED" | "CANCELLED";
  endsAt: string;
  endedAt: string | null;
  hostName: string | null;
  hostAvatar: string | null;
  chain: string | null;
  allocations: string;
  spots: number;
  requireMember: boolean;
  entryCount: number;
  guild: { name: string | null; icon: string | null };
};
type ListResponse = { total: number; page: number; pageSize: number; totalPages: number; raffles: RaffleCardData[] };

export function timeLeft(iso: string, now: number) {
  const s = Math.max(0, Math.floor((new Date(iso).getTime() - now) / 1000));
  const d = Math.floor(s / 86400), h = Math.floor((s % 86400) / 3600), m = Math.floor((s % 3600) / 60);
  if (d) return `${d}d ${h}h`;
  if (h) return `${h}h ${m}m`;
  if (m) return `${m}m ${s % 60}s`;
  return `${s}s`;
}

const SORTS = [
  { value: "ending", label: "Ending soon" },
  { value: "newest", label: "Newest" },
  { value: "popular", label: "Most entries" },
  { value: "odds", label: "Best odds" },
];

// Daftar raffle yang sedang live dari semua server, dengan filter untuk pemburu WL.
// 10 per halaman; semua filter & nomor halaman disimpan di URL supaya bisa dibagikan.
export function RafflesListPage() {
  const [params, setParams] = useSearchParams();
  const chain = params.get("chain") ?? "";
  const open = params.get("open") === "1";
  const alloc = params.get("alloc") ?? "";
  const sort = SORTS.some((s) => s.value === params.get("sort")) ? params.get("sort")! : SORTS[0].value;
  const q = params.get("q") ?? "";
  const page = Math.max(1, Number(params.get("page")) || 1);

  const [search, setSearch] = useState(q);
  const [data, setData] = useState<ListResponse | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [now, setNow] = useState(Date.now());

  useEffect(() => {
    setPageTitle("Raffles");
    return () => setPageTitle();
  }, []);

  // Ganti filter → kembali ke halaman 1
  const update = useCallback(
    (patch: Record<string, string>) => {
      const next = new URLSearchParams(params);
      for (const [k, v] of Object.entries(patch)) (v ? next.set(k, v) : next.delete(k));
      if (!("page" in patch)) next.delete("page");
      setParams(next, { replace: !("page" in patch) });
    },
    [params, setParams],
  );

  // Pencarian diketik → tunggu sebentar sebelum memuat ulang
  useEffect(() => {
    if (search.trim() === q) return;
    const t = setTimeout(() => update({ q: search.trim() }), 300);
    return () => clearTimeout(t);
  }, [search, q, update]);

  const query = new URLSearchParams({
    sort,
    page: String(page),
    ...(q && { q }),
    ...(chain && { chain }),
    ...(open && { open: "1" }),
    ...(alloc && { alloc }),
  }).toString();

  useEffect(() => {
    setError(null);
    api<ListResponse>(`/p/raffles?${query}`)
      .then((d) => {
        setData(d);
        // Halaman di luar jangkauan (mis. setelah filter) → ke halaman terakhir
        if (d.total > 0 && page > d.totalPages) update({ page: String(d.totalPages) });
      })
      .catch((e) => setError(e.message));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [query]);
  useEffect(() => {
    const t = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(t);
  }, []);

  const goTo = (p: number) => {
    update({ page: p === 1 ? "" : String(p) });
    window.scrollTo({ top: 0, behavior: "smooth" });
  };

  const items = data?.raffles;
  const filtered = !!(q || chain || open || alloc);
  const pill = (active: boolean) =>
    `inline-flex items-center gap-1.5 rounded-full px-3 py-1.5 text-sm transition ${
      active
        ? "bg-brand-500/15 text-brand-200 ring-1 ring-brand-500/40"
        : "text-zinc-400 ring-1 ring-zinc-800 hover:text-zinc-200 hover:ring-zinc-700"
    }`;

  return (
    <div>
      <div className="mb-5 flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
        <div>
          <h1 className="text-2xl font-bold">Find your next allowlist</h1>
          <div className="mt-1 flex items-center gap-2 text-sm font-medium text-emerald-400">
            <span className="h-2 w-2 rounded-full bg-emerald-400" /> Live raffles
          </div>
        </div>
        <div className="relative sm:w-72">
          <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-zinc-500" />
          <input
            className="input pl-9"
            placeholder="Search raffles or communities"
            value={search}
            onChange={(e) => setSearch(e.target.value)}
          />
        </div>
      </div>

      <div className="mb-6 flex flex-wrap items-center gap-2">
        <SlidersHorizontal className="h-4 w-4 text-zinc-500" />
        <button className={pill(open)} onClick={() => update({ open: open ? "" : "1" })}>
          <Globe className="h-3.5 w-3.5" /> Open to everyone
        </button>
        <button className={pill(alloc === "gtd")} onClick={() => update({ alloc: alloc === "gtd" ? "" : "gtd" })}>
          GTD
        </button>
        <button className={pill(alloc === "fcfs")} onClick={() => update({ alloc: alloc === "fcfs" ? "" : "fcfs" })}>
          FCFS
        </button>
        <select
          className={`${pill(!!chain)} cursor-pointer bg-zinc-950 outline-none`}
          value={chain}
          onChange={(e) => update({ chain: e.target.value })}
          aria-label="Chain"
        >
          <option value="">All chains</option>
          {CHAIN_IDS.map((c) => (
            <option key={c} value={c}>
              {CHAINS[c].label}
            </option>
          ))}
          <option value="OTHER">Other chains</option>
        </select>
        <select
          className={`${pill(false)} cursor-pointer bg-zinc-950 outline-none sm:ml-auto`}
          value={sort}
          onChange={(e) => update({ sort: e.target.value === SORTS[0].value ? "" : e.target.value })}
          aria-label="Sort"
        >
          {SORTS.map((s) => (
            <option key={s.value} value={s.value}>
              Sort: {s.label}
            </option>
          ))}
        </select>
        {filtered && (
          <button
            className="inline-flex items-center gap-1 text-sm text-zinc-400 hover:text-brand-300"
            onClick={() => {
              setSearch("");
              update({ q: "", chain: "", open: "", alloc: "" });
            }}
          >
            <X className="h-3.5 w-3.5" /> Clear filters
          </button>
        )}
      </div>

      <ErrorBox error={error} />
      {!data && !error && <Loading />}
      {data?.total === 0 && (
        <div className="card py-12 text-center">
          <Ticket className="mx-auto h-10 w-10 text-zinc-600" strokeWidth={1.5} />
          <p className="mt-3 text-zinc-400">{filtered ? "No live raffles match your filters." : "No live raffles right now."}</p>
        </div>
      )}
      {data && data.total > 0 && (
        <p className="mb-3 text-xs text-zinc-500">
          Showing {(data.page - 1) * data.pageSize + 1}–{Math.min(data.page * data.pageSize, data.total)} of {data.total} live raffle
          {data.total === 1 ? "" : "s"}
        </p>
      )}

      <div className={RAFFLE_GRID}>
        {items?.map((r) => <RaffleCard key={r.id} r={r} now={now} />)}
      </div>

      {data && <Pagination page={data.page} totalPages={data.totalPages} onChange={goTo} />}
    </div>
  );
}

// Tanggal ringkas untuk kartu (muat di layar HP): "Sep 26"
const shortDate = (iso: string) => new Date(iso).toLocaleDateString("en-US", { month: "short", day: "numeric" });

// Grid kartu raffle: 2 per baris di HP, 4 per baris di desktop (12 per halaman = 6 × 2 / 3 × 4)
export const RAFFLE_GRID = "grid grid-cols-2 gap-3 sm:gap-4 lg:grid-cols-4";

// Kartu raffle (dipakai di daftar raffle, landing page & My entries). Dibuat ringkas supaya muat 2 kolom di HP.
export function RaffleCard({ r, now, footer }: { r: RaffleCardData; now: number; footer?: ReactNode }) {
  const live = r.status === "ACTIVE" && new Date(r.endsAt).getTime() > now;
  const chip = "truncate rounded-full bg-brand-500/10 px-1.5 py-0.5 text-brand-200 ring-1 ring-brand-500/20 sm:px-2";
  return (
    <Link to={`/raffle/${r.id}`} className="card group flex min-w-0 flex-col gap-2 p-0 transition hover:border-brand-500/50 sm:gap-3">
      <div className="relative">
        {r.imageUrl ? (
          <img src={r.imageUrl} className="aspect-[4/3] w-full rounded-t-2xl object-cover" alt="" loading="lazy" />
        ) : (
          <div className="grid aspect-[4/3] w-full place-items-center rounded-t-2xl bg-gradient-to-br from-brand-900/60 to-zinc-900">
            <Ticket className="h-10 w-10 text-brand-300/70 sm:h-12 sm:w-12" strokeWidth={1.5} />
          </div>
        )}
        <span
          className={`absolute left-2 top-2 inline-flex items-center gap-1 rounded-full px-1.5 py-0.5 text-[10px] font-medium backdrop-blur sm:left-3 sm:top-3 sm:px-2 sm:text-xs ${
            r.requireMember ? "bg-zinc-950/75 text-zinc-300" : "bg-emerald-950/70 text-emerald-200 ring-1 ring-emerald-400/30"
          }`}
        >
          {r.requireMember ? <Users className="h-3 w-3" /> : <Globe className="h-3 w-3" />}
          {r.requireMember ? "Members only" : "Open to all"}
        </span>
      </div>
      <div className="flex min-w-0 flex-1 flex-col gap-1.5 px-3 pb-3 sm:gap-2 sm:px-4 sm:pb-4">
        <div className="flex min-w-0 items-center gap-1.5 text-[11px] text-zinc-400 sm:text-xs">
          {r.guild.icon ? (
            <img src={r.guild.icon} className="h-4 w-4 shrink-0 rounded-full" alt="" />
          ) : (
            <div className="h-4 w-4 shrink-0 rounded-full bg-zinc-700" />
          )}
          <span className="truncate">{r.guild.name ?? "Discord server"}</span>
        </div>
        <div className="line-clamp-2 text-sm font-semibold leading-snug text-brand-50 sm:text-base">{r.title}</div>
        <div className="flex min-w-0 flex-wrap gap-1 text-[11px] sm:gap-1.5 sm:text-xs">
          <span className={chip}>{r.allocations}</span>
          {r.chain && <span className={chip}>{r.chain}</span>}
        </div>
        <div className="mt-auto flex flex-col gap-0.5 pt-1 text-[11px] text-zinc-400 sm:text-xs">
          <span className={live ? "font-medium text-emerald-400" : "text-red-300/80"}>
            {live ? `Ends in ${timeLeft(r.endsAt, now)}` : `Ended ${shortDate(r.endedAt ?? r.endsAt)}`}
          </span>
          <span className="truncate">
            {r.entryCount} entr{r.entryCount === 1 ? "y" : "ies"}
          </span>
        </div>
        {footer}
      </div>
    </Link>
  );
}
