import { useCallback, useEffect, useState } from "react";
import { Link } from "react-router-dom";
import { CircleCheckBig, Clock, Ticket, Trophy, XCircle } from "lucide-react";
import { api, setPageTitle } from "../api";
import { ErrorBox, Loading } from "../components";
import { RaffleCard, type RaffleCardData } from "./RafflesList";

type MyEntry = {
  enteredAt: string;
  status: "ENTERED" | "WON" | "DISQUALIFIED";
  allocation: "GTD" | "FCFS" | null;
  raffle: RaffleCardData;
};

// Hasil untuk satu entry, dilihat dari sisi peserta
function result(e: MyEntry, now: number) {
  const r = e.raffle;
  if (e.status === "WON")
    return { icon: Trophy, text: e.allocation ? `You won a ${e.allocation} spot` : "You won", cls: "bg-emerald-500/15 text-emerald-300 ring-emerald-500/30" };
  if (e.status === "DISQUALIFIED") return { icon: XCircle, text: "Disqualified", cls: "bg-red-500/15 text-red-300 ring-red-500/30" };
  if (r.status === "CANCELLED") return { icon: XCircle, text: "Raffle cancelled", cls: "bg-zinc-800 text-zinc-400 ring-zinc-700" };
  if (r.status === "ENDED" || new Date(r.endsAt).getTime() <= now)
    return { icon: XCircle, text: r.status === "ENDED" ? "Not selected" : "Drawing winners...", cls: "bg-zinc-800 text-zinc-400 ring-zinc-700" };
  return { icon: Clock, text: "Entered, waiting for the draw", cls: "bg-brand-500/15 text-brand-200 ring-brand-500/30" };
}

// Semua raffle yang pernah diikuti user + hasilnya
export function MyEntriesPage() {
  const [items, setItems] = useState<MyEntry[] | null>(null);
  const [total, setTotal] = useState(0);
  const [page, setPage] = useState(0);
  const [hasMore, setHasMore] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [now, setNow] = useState(Date.now());

  const load = useCallback(async (p: number) => {
    const d = await api<{ total: number; hasMore: boolean; entries: MyEntry[] }>(`/p/me/entries?page=${p}`);
    setItems((prev) => (p === 0 ? d.entries : [...(prev ?? []), ...d.entries]));
    setTotal(d.total);
    setHasMore(d.hasMore);
    setPage(p);
  }, []);

  useEffect(() => {
    setPageTitle("My entries");
    return () => setPageTitle();
  }, []);
  useEffect(() => {
    load(0).catch((e) => setError(e.message));
    const t = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(t);
  }, [load]);

  const wins = items?.filter((e) => e.status === "WON").length ?? 0;
  const active = items?.filter((e) => e.status === "ENTERED" && e.raffle.status === "ACTIVE").length ?? 0;

  return (
    <div>
      <div className="mb-6 flex flex-wrap items-end justify-between gap-4">
        <div>
          <h1 className="text-2xl font-bold">My entries</h1>
          <p className="text-sm text-zinc-400">Every raffle you've entered, from Discord or the web, and how it turned out.</p>
        </div>
        {items && items.length > 0 && (
          <div className="flex gap-2 text-sm">
            <span className="inline-flex items-center gap-1.5 rounded-full bg-brand-500/10 px-3 py-1 text-brand-200 ring-1 ring-brand-500/25">
              <Ticket className="h-3.5 w-3.5" /> {total} entered
            </span>
            <span className="inline-flex items-center gap-1.5 rounded-full bg-brand-500/10 px-3 py-1 text-brand-200 ring-1 ring-brand-500/25">
              <Clock className="h-3.5 w-3.5" /> {active} live
            </span>
            <span className="inline-flex items-center gap-1.5 rounded-full bg-emerald-500/10 px-3 py-1 text-emerald-300 ring-1 ring-emerald-500/25">
              <CircleCheckBig className="h-3.5 w-3.5" /> {wins} won
            </span>
          </div>
        )}
      </div>

      <ErrorBox error={error} />
      {!items && !error && <Loading />}
      {items?.length === 0 && (
        <div className="card py-12 text-center">
          <Ticket className="mx-auto h-10 w-10 text-zinc-600" strokeWidth={1.5} />
          <p className="mt-3 text-zinc-400">You haven't entered any raffles yet.</p>
          <Link to="/raffles" className="btn btn-primary mt-5">
            Find a raffle
          </Link>
        </div>
      )}

      <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
        {items?.map((e) => {
          const res = result(e, now);
          const Icon = res.icon;
          return (
            <RaffleCard
              key={e.raffle.id}
              r={e.raffle}
              now={now}
              footer={
                <div className={`mt-1 inline-flex items-center gap-1.5 rounded-lg px-2.5 py-1.5 text-xs font-medium ring-1 ${res.cls}`}>
                  <Icon className="h-3.5 w-3.5" /> {res.text}
                </div>
              }
            />
          );
        })}
      </div>

      {hasMore && (
        <div className="mt-6 text-center">
          <button className="btn btn-ghost" onClick={() => load(page + 1).catch((e) => setError(e.message))}>
            Load more
          </button>
        </div>
      )}
    </div>
  );
}
