import { useEffect, useState } from "react";
import { Link, useSearchParams } from "react-router-dom";
import { CircleCheckBig, Clock, Ticket, Trophy, XCircle } from "lucide-react";
import { api, setPageTitle } from "../api";
import { ErrorBox, Loading, Pagination } from "../components";
import { RAFFLE_GRID, RaffleCard, type RaffleCardData } from "./RafflesList";

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
  return { icon: Clock, text: "Waiting for the draw", cls: "bg-brand-500/15 text-brand-200 ring-brand-500/30" };
}

type Page = {
  total: number;
  page: number;
  pageSize: number;
  totalPages: number;
  summary: { entered: number; live: number; won: number };
  entries: MyEntry[];
};

// Semua raffle yang pernah diikuti user + hasilnya, 10 per halaman (?page=2, dst.)
export function MyEntriesPage() {
  const [params, setParams] = useSearchParams();
  const page = Math.max(1, Number(params.get("page")) || 1);
  const [data, setData] = useState<Page | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [now, setNow] = useState(Date.now());

  useEffect(() => {
    setPageTitle("My entries");
    return () => setPageTitle();
  }, []);
  useEffect(() => {
    const t = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(t);
  }, []);
  useEffect(() => {
    setError(null);
    api<Page>(`/p/me/entries?page=${page}`)
      .then((d) => {
        setData(d);
        // Halaman di luar jangkauan (mis. ?page=99) → ke halaman terakhir
        if (d.total > 0 && page > d.totalPages) setParams({ page: String(d.totalPages) }, { replace: true });
      })
      .catch((e) => setError(e.message));
  }, [page, setParams]);

  const goTo = (p: number) => {
    setParams(p === 1 ? {} : { page: String(p) });
    window.scrollTo({ top: 0, behavior: "smooth" });
  };

  const items = data?.entries;
  return (
    <div>
      <div className="mb-6 flex flex-wrap items-end justify-between gap-4">
        <div>
          <h1 className="text-2xl font-bold">My entries</h1>
          <p className="text-sm text-zinc-400">Every raffle you've entered, from Discord or the web, and how it turned out.</p>
        </div>
        {data && data.total > 0 && (
          <div className="flex gap-2 text-sm">
            <span className="inline-flex items-center gap-1.5 rounded-full bg-brand-500/10 px-3 py-1 text-brand-200 ring-1 ring-brand-500/25">
              <Ticket className="h-3.5 w-3.5" /> {data.summary.entered} entered
            </span>
            <span className="inline-flex items-center gap-1.5 rounded-full bg-brand-500/10 px-3 py-1 text-brand-200 ring-1 ring-brand-500/25">
              <Clock className="h-3.5 w-3.5" /> {data.summary.live} live
            </span>
            <span className="inline-flex items-center gap-1.5 rounded-full bg-emerald-500/10 px-3 py-1 text-emerald-300 ring-1 ring-emerald-500/25">
              <CircleCheckBig className="h-3.5 w-3.5" /> {data.summary.won} won
            </span>
          </div>
        )}
      </div>

      <ErrorBox error={error} />
      {!data && !error && <Loading />}
      {data?.total === 0 && (
        <div className="card py-12 text-center">
          <Ticket className="mx-auto h-10 w-10 text-zinc-600" strokeWidth={1.5} />
          <p className="mt-3 text-zinc-400">You haven't entered any raffles yet.</p>
          <Link to="/raffles" className="btn btn-primary mt-5">
            Find a raffle
          </Link>
        </div>
      )}

      {data && data.total > 0 && (
        <p className="mb-3 text-xs text-zinc-500">
          Showing {(data.page - 1) * data.pageSize + 1}–{Math.min(data.page * data.pageSize, data.total)} of {data.total}
        </p>
      )}
      <div className={RAFFLE_GRID}>
        {items?.map((e) => {
          const res = result(e, now);
          const Icon = res.icon;
          return (
            <RaffleCard
              key={e.raffle.id}
              r={e.raffle}
              now={now}
              footer={
                <div className={`mt-1 flex items-center gap-1.5 rounded-lg px-2 py-1.5 text-[11px] font-medium ring-1 sm:px-2.5 sm:text-xs ${res.cls}`}>
                  <Icon className="h-3.5 w-3.5 shrink-0" /> <span className="line-clamp-2">{res.text}</span>
                </div>
              }
            />
          );
        })}
      </div>

      {data && <Pagination page={data.page} totalPages={data.totalPages} onChange={goTo} />}
    </div>
  );
}
