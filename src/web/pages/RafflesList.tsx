import { useCallback, useEffect, useState } from "react";
import { Link, useSearchParams } from "react-router-dom";
import { api } from "../api";
import { ErrorBox, formatDate, Loading } from "../components";
import { Ticket } from "lucide-react";

type RaffleCard = {
  id: string;
  title: string;
  imageUrl: string | null;
  status: "ACTIVE" | "ENDED";
  endsAt: string;
  endedAt: string | null;
  hostName: string | null;
  hostAvatar: string | null;
  chain: string | null;
  allocations: string;
  entryCount: number;
  guild: { name: string | null; icon: string | null };
};
type ListResponse = { total: number; pageSize: number; raffles: RaffleCard[] };
type Tab = "live" | "ended";

export function timeLeft(iso: string, now: number) {
  const s = Math.max(0, Math.floor((new Date(iso).getTime() - now) / 1000));
  const d = Math.floor(s / 86400), h = Math.floor((s % 86400) / 3600), m = Math.floor((s % 3600) / 60);
  if (d) return `${d}d ${h}h`;
  if (h) return `${h}h ${m}m`;
  if (m) return `${m}m ${s % 60}s`;
  return `${s}s`;
}

// Beranda: daftar raffle publik dari semua server (Live / Ended)
export function RafflesListPage() {
  const [params, setParams] = useSearchParams();
  const tab: Tab = params.get("tab") === "ended" ? "ended" : "live";
  const [items, setItems] = useState<RaffleCard[] | null>(null);
  const [total, setTotal] = useState(0);
  const [page, setPage] = useState(0);
  const [error, setError] = useState<string | null>(null);
  const [loadingMore, setLoadingMore] = useState(false);
  const [now, setNow] = useState(Date.now());

  const load = useCallback(
    (p: number) =>
      api<ListResponse>(`/p/raffles?status=${tab}&page=${p}`).then((d) => {
        setTotal(d.total);
        setItems((prev) => (p === 0 ? d.raffles : [...(prev ?? []), ...d.raffles]));
        setPage(p);
      }),
    [tab],
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

  return (
    <div>
      <div className="mb-6">
        <h1 className="text-2xl font-bold">Raffles</h1>
        <p className="text-sm text-zinc-400">Browse raffles from every community using SkyBOT. Log in with Discord to enter.</p>
      </div>

      <div className="mb-5 flex gap-1">
        {(["live", "ended"] as Tab[]).map((t) => (
          <button
            key={t}
            onClick={() => setParams(t === "live" ? {} : { tab: t })}
            className={`rounded-lg px-4 py-1.5 text-sm ${tab === t ? "bg-zinc-800 text-white" : "text-zinc-400 hover:text-zinc-200"}`}
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

      <ErrorBox error={error} />
      {!items && !error && <Loading />}
      {items?.length === 0 && (
        <p className="py-10 text-center text-zinc-500">{tab === "live" ? "No live raffles right now." : "No ended raffles yet."}</p>
      )}

      <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
        {items?.map((r) => {
          const live = r.status === "ACTIVE" && new Date(r.endsAt).getTime() > now;
          return (
            <Link key={r.id} to={`/raffle/${r.id}`} className="card flex flex-col gap-3 p-0 transition hover:border-zinc-600">
              {r.imageUrl ? (
                <img src={r.imageUrl} className="h-40 w-full rounded-t-2xl object-cover" alt="" />
              ) : (
                <div className="grid h-40 w-full place-items-center rounded-t-2xl bg-gradient-to-br from-brand-900/60 to-zinc-900">
                  <Ticket className="h-12 w-12 text-brand-300/70" strokeWidth={1.5} />
                </div>
              )}
              <div className="flex flex-1 flex-col gap-2 px-4 pb-4">
                <div className="flex items-center gap-2 text-xs text-zinc-400">
                  {r.guild.icon ? (
                    <img src={r.guild.icon} className="h-4 w-4 rounded-full" alt="" />
                  ) : (
                    <div className="h-4 w-4 rounded-full bg-zinc-700" />
                  )}
                  <span className="truncate">{r.guild.name ?? "Discord server"}</span>
                </div>
                <div className="line-clamp-2 font-semibold">{r.title}</div>
                <div className="flex flex-wrap gap-1.5 text-xs">
                  <span className="rounded-full bg-zinc-800 px-2 py-0.5 text-zinc-300">{r.allocations}</span>
                  {r.chain && <span className="rounded-full bg-zinc-800 px-2 py-0.5 text-zinc-300">{r.chain}</span>}
                </div>
                <div className="mt-auto flex items-center justify-between pt-1 text-xs text-zinc-400">
                  <span>{r.entryCount} entr{r.entryCount === 1 ? "y" : "ies"}</span>
                  <span className={live ? "font-medium text-emerald-400" : ""}>
                    {live ? `Ends in ${timeLeft(r.endsAt, now)}` : `Ended ${formatDate(r.endedAt ?? r.endsAt)}`}
                  </span>
                </div>
              </div>
            </Link>
          );
        })}
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
