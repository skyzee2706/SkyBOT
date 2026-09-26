import { useCallback, useEffect, useState, type ReactNode } from "react";
import { Link, useSearchParams } from "react-router-dom";
import { Globe, Search, SlidersHorizontal, Ticket, Users, X } from "lucide-react";
import { api, setPageTitle } from "../api";
import { ErrorBox, formatDate, Loading } from "../components";
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
type ListResponse = { total: number; pageSize: number; raffles: RaffleCardData[] };
type Tab = "live" | "ended";

export function timeLeft(iso: string, now: number) {
  const s = Math.max(0, Math.floor((new Date(iso).getTime() - now) / 1000));
  const d = Math.floor(s / 86400), h = Math.floor((s % 86400) / 3600), m = Math.floor((s % 3600) / 60);
  if (d) return `${d}d ${h}h`;
  if (h) return `${h}h ${m}m`;
  if (m) return `${m}m ${s % 60}s`;
  return `${s}s`;
}

const SORTS: Record<Tab, { value: string; label: string }[]> = {
  live: [
    { value: "ending", label: "Ending soon" },
    { value: "newest", label: "Newest" },
    { value: "popular", label: "Most entries" },
    { value: "odds", label: "Best odds" },
  ],
  ended: [
    { value: "newest", label: "Recently ended" },
    { value: "popular", label: "Most entries" },
  ],
};

// Daftar raffle publik dari semua server, dengan filter untuk pemburu WL.
// Semua filter disimpan di URL supaya hasil pencarian bisa dibagikan.
export function RafflesListPage() {
  const [params, setParams] = useSearchParams();
  const tab: Tab = params.get("tab") === "ended" ? "ended" : "live";
  const chain = params.get("chain") ?? "";
  const open = params.get("open") === "1";
  const alloc = params.get("alloc") ?? "";
  const sort = SORTS[tab].some((s) => s.value === params.get("sort")) ? params.get("sort")! : SORTS[tab][0].value;
  const q = params.get("q") ?? "";

  const [search, setSearch] = useState(q);
  useEffect(() => {
    setPageTitle("Raffles");
    return () => setPageTitle();
  }, []);
  const [items, setItems] = useState<RaffleCardData[] | null>(null);
  const [total, setTotal] = useState(0);
  const [page, setPage] = useState(0);
  const [error, setError] = useState<string | null>(null);
  const [loadingMore, setLoadingMore] = useState(false);
  const [now, setNow] = useState(Date.now());

  const update = useCallback(
    (patch: Record<string, string>) => {
      const next = new URLSearchParams(params);
      for (const [k, v] of Object.entries(patch)) (v ? next.set(k, v) : next.delete(k));
      setParams(next, { replace: true });
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
    status: tab,
    sort,
    ...(q && { q }),
    ...(chain && { chain }),
    ...(open && { open: "1" }),
    ...(alloc && { alloc }),
  }).toString();
  const load = useCallback(
    (p: number) =>
      api<ListResponse>(`/p/raffles?${query}&page=${p}`).then((d) => {
        setTotal(d.total);
        setItems((prev) => (p === 0 ? d.raffles : [...(prev ?? []), ...d.raffles]));
        setPage(p);
      }),
    [query],
  );

  useEffect(() => {
    setItems(null);
    setError(null);
    load(0).catch((e) => setError(e.message));
  }, [load]);
  useEffect(() => {
    const t = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(t);
  }, []);

  const more = async () => {
    setLoadingMore(true);
    await load(page + 1).catch((e) => setError(e.message));
    setLoadingMore(false);
  };

  const filtered = !!(q || chain || open || alloc);
  const pill = (active: boolean) =>
    `inline-flex items-center gap-1.5 rounded-full px-3 py-1.5 text-sm transition ${
      active
        ? "bg-brand-500/15 text-brand-200 ring-1 ring-brand-500/40"
        : "text-zinc-400 ring-1 ring-zinc-800 hover:text-zinc-200 hover:ring-zinc-700"
    }`;

  return (
    <div>
      <div className="mb-6">
        <h1 className="text-2xl font-bold">Find your next allowlist</h1>
        <p className="text-sm text-zinc-400">
          Raffles from every community on SkyBOT. Many are open to everyone, no Discord server join needed.
        </p>
      </div>

      <div className="mb-4 flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
        <div className="flex gap-1">
          {(["live", "ended"] as Tab[]).map((t) => (
            <button
              key={t}
              onClick={() => update({ tab: t === "live" ? "" : t, sort: "" })}
              className={`rounded-lg px-4 py-1.5 text-sm ${
                tab === t ? "bg-brand-500/15 text-brand-200 ring-1 ring-brand-500/30" : "text-zinc-400 hover:text-zinc-200"
              }`}
            >
              {t === "live" ? (
                <span className="inline-flex items-center gap-2">
                  <span className="h-2 w-2 rounded-full bg-emerald-400" /> Live
                </span>
              ) : (
                "Ended"
              )}
            </button>
          ))}
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
          Has GTD
        </button>
        <button className={pill(alloc === "fcfs")} onClick={() => update({ alloc: alloc === "fcfs" ? "" : "fcfs" })}>
          Has FCFS
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
          onChange={(e) => update({ sort: e.target.value === SORTS[tab][0].value ? "" : e.target.value })}
          aria-label="Sort"
        >
          {SORTS[tab].map((s) => (
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
      {!items && !error && <Loading />}
      {items?.length === 0 && (
        <div className="card py-12 text-center">
          <Ticket className="mx-auto h-10 w-10 text-zinc-600" strokeWidth={1.5} />
          <p className="mt-3 text-zinc-400">
            {filtered ? "No raffles match your filters." : tab === "live" ? "No live raffles right now." : "No ended raffles yet."}
          </p>
        </div>
      )}
      {items && items.length > 0 && (
        <p className="mb-3 text-xs text-zinc-500">
          {total} raffle{total === 1 ? "" : "s"}
        </p>
      )}

      <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
        {items?.map((r) => <RaffleCard key={r.id} r={r} now={now} />)}
      </div>

      {items && items.length < total && (
        <div className="mt-6 text-center">
          <button className="btn btn-ghost" onClick={more} disabled={loadingMore}>
            {loadingMore ? "Loading..." : "Load more"}
          </button>
        </div>
      )}
    </div>
  );
}

// Perkiraan peluang: jumlah peserta per 1 spot
const oddsLabel = (spots: number, entries: number) => {
  if (entries <= spots) return "every entry wins so far";
  const ratio = entries / spots;
  return `~1 in ${ratio < 10 ? ratio.toFixed(1) : Math.round(ratio)}`;
};

// Kartu raffle (dipakai di daftar raffle, landing page & My entries)
export function RaffleCard({ r, now, footer }: { r: RaffleCardData; now: number; footer?: ReactNode }) {
  const live = r.status === "ACTIVE" && new Date(r.endsAt).getTime() > now;
  return (
    <Link to={`/raffle/${r.id}`} className="card group flex flex-col gap-3 p-0 transition hover:border-brand-500/50">
      <div className="relative">
        {r.imageUrl ? (
          <img src={r.imageUrl} className="h-40 w-full rounded-t-2xl object-cover" alt="" />
        ) : (
          <div className="grid h-40 w-full place-items-center rounded-t-2xl bg-gradient-to-br from-brand-900/60 to-zinc-900">
            <Ticket className="h-12 w-12 text-brand-300/70" strokeWidth={1.5} />
          </div>
        )}
        <span
          className={`absolute left-3 top-3 inline-flex items-center gap-1 rounded-full px-2 py-0.5 text-xs font-medium backdrop-blur ${
            r.requireMember ? "bg-zinc-950/75 text-zinc-300" : "bg-emerald-950/70 text-emerald-200 ring-1 ring-emerald-400/30"
          }`}
        >
          {r.requireMember ? <Users className="h-3 w-3" /> : <Globe className="h-3 w-3" />}
          {r.requireMember ? "Members only" : "Open to all"}
        </span>
      </div>
      <div className="flex flex-1 flex-col gap-2 px-4 pb-4">
        <div className="flex items-center gap-2 text-xs text-zinc-400">
          {r.guild.icon ? <img src={r.guild.icon} className="h-4 w-4 rounded-full" alt="" /> : <div className="h-4 w-4 rounded-full bg-zinc-700" />}
          <span className="truncate">{r.guild.name ?? "Discord server"}</span>
        </div>
        <div className="line-clamp-2 font-semibold text-brand-50">{r.title}</div>
        <div className="flex flex-wrap gap-1.5 text-xs">
          <span className="rounded-full bg-brand-500/10 px-2 py-0.5 text-brand-200 ring-1 ring-brand-500/20">{r.allocations}</span>
          {r.chain && <span className="rounded-full bg-brand-500/10 px-2 py-0.5 text-brand-200 ring-1 ring-brand-500/20">{r.chain}</span>}
        </div>
        <div className="mt-auto flex items-center justify-between gap-2 pt-1 text-xs text-zinc-400">
          <span className="truncate">
            {r.entryCount} entr{r.entryCount === 1 ? "y" : "ies"}
            {live && r.spots > 0 && <span className="text-zinc-500"> · {oddsLabel(r.spots, r.entryCount)}</span>}
          </span>
          <span className={`shrink-0 ${live ? "font-medium text-emerald-400" : "text-red-300/80"}`}>
            {live ? `Ends in ${timeLeft(r.endsAt, now)}` : `Ended ${formatDate(r.endedAt ?? r.endsAt)}`}
          </span>
        </div>
        {footer}
      </div>
    </Link>
  );
}
