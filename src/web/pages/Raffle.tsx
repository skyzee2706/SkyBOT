import { useCallback, useEffect, useState } from "react";
import { Link, useParams } from "react-router-dom";
import { api, type Entry, type Raffle } from "../api";
import { ErrorBox, formatDate, Loading, StatusBadge } from "../components";
import { ALLOCATIONS, allocationCount, allocationSummary, chainLabel, hasAllocations, type AllocationType } from "../../shared/raffle";

// GTD / FCFS = pemenang per allocation (raffle baru); WON = semua pemenang (raffle lama)
type Filter = "ALL" | Entry["status"] | AllocationType;

const ENTRY_STATUS: Record<Entry["status"], { label: string; cls: string }> = {
  ENTERED: { label: "Entered", cls: "text-zinc-400" },
  WON: { label: "🏆 Won", cls: "text-emerald-400" },
  DISQUALIFIED: { label: "Disqualified", cls: "text-red-400" },
};

export function RafflePage() {
  const { id } = useParams();
  const [data, setData] = useState<{ raffle: Raffle; entries: Entry[] } | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [filter, setFilter] = useState<Filter>("ALL");
  const [search, setSearch] = useState("");
  const [confirm, setConfirm] = useState<null | "end" | "cancel">(null);

  const load = useCallback(() => {
    api<{ raffle: Raffle; entries: Entry[] }>(`/raffles/${id}`).then(setData).catch((e) => setError(e.message));
  }, [id]);
  useEffect(load, [load]);

  const act = async (path: string, body: unknown = {}) => {
    setBusy(true);
    setError(null);
    try {
      await api(`/raffles/${id}${path}`, { body });
      load();
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(false);
      setConfirm(null);
    }
  };

  if (!data) return error ? <ErrorBox error={error} /> : <Loading />;
  const { raffle, entries } = data;
  const posts = raffle.xPosts;
  const hasX = raffle.xFollowUsernames.length > 0 || posts.length > 0;
  const quoteCount = posts.filter((p) => p.quote).length;

  const withAllocations = hasAllocations(raffle);
  const usedAllocations = ALLOCATIONS.filter((a) => allocationCount(raffle, a) > 0);
  const isWinnerOf = (e: Entry, a: AllocationType) => e.status === "WON" && e.allocation === a;
  const matches = (e: Entry, f: Filter) =>
    f === "ALL" || (f === "GTD" || f === "FCFS" ? isWinnerOf(e, f) : e.status === f);
  const filters: Filter[] = ["ALL", ...(withAllocations ? usedAllocations : (["WON"] as Filter[])), "ENTERED", "DISQUALIFIED"];
  const filterLabel = (f: Filter) =>
    f === "ALL" ? "All" : f === "GTD" || f === "FCFS" ? `🏆 ${f} Winners` : ENTRY_STATUS[f].label;
  const counts = Object.fromEntries(filters.map((f) => [f, entries.filter((e) => matches(e, f)).length])) as Record<Filter, number>;
  const winnerCount = entries.filter((e) => e.status === "WON").length;
  const q = search.trim().toLowerCase();
  const shown = entries.filter(
    (e) =>
      matches(e, filter) &&
      (!q ||
        e.username.toLowerCase().includes(q) ||
        e.userId.includes(q) ||
        e.wallet?.toLowerCase().includes(q) ||
        e.xUsername?.toLowerCase().includes(q)),
  );


  return (
    <div>
      <Link to={`/server/${raffle.guildId}`} className="mb-4 inline-block text-sm text-zinc-400 hover:text-zinc-200">
        ← Back to server
      </Link>
      <ErrorBox error={error} />

      <div className="card mb-6 flex flex-col gap-5 sm:flex-row">
        {raffle.imageUrl && <img src={raffle.imageUrl} className="h-32 w-32 rounded-xl object-cover" alt="" />}
        <div className="min-w-0 flex-1">
          <div className="mb-2 flex items-center gap-2">
            <h1 className="truncate text-2xl font-bold">{raffle.title}</h1>
            <StatusBadge status={raffle.status} />
          </div>
          {raffle.hostName && (
            <div className="mb-2 flex items-center gap-2 text-sm text-zinc-400">
              {raffle.hostAvatar && <img src={raffle.hostAvatar} className="h-5 w-5 rounded-full" alt="" />}
              Hosted by <span className="font-medium text-zinc-200">{raffle.hostName}</span>
            </div>
          )}
          {raffle.description && <p className="mb-3 whitespace-pre-wrap text-sm text-zinc-400">{raffle.description}</p>}
          <div className="flex flex-wrap gap-x-6 gap-y-1 text-sm text-zinc-400">
            <span>{withAllocations ? `Allocations: ${allocationSummary(raffle)}` : allocationSummary(raffle)}</span>
            {chainLabel(raffle.chain) && <span>Chain: {chainLabel(raffle.chain)}</span>}
            <span>
              {entries.length} entr{entries.length === 1 ? "y" : "ies"}
            </span>
            <span>
              {raffle.status === "ACTIVE" ? "Ends" : "Ended"} {formatDate(raffle.endedAt ?? raffle.endsAt)}
            </span>
            {raffle.walletType !== "NONE" && <span>{raffle.walletType} wallet</span>}
          </div>
          {hasX && (
            <div className="mt-3 space-y-1 text-sm text-zinc-400">
              <div className="font-medium text-zinc-300">X tasks</div>
              {raffle.xFollowUsernames.map((u) => (
                <div key={u}>
                  • Follow{" "}
                  <a href={`https://x.com/${u}`} target="_blank" rel="noreferrer" className="text-indigo-400 hover:underline">
                    @{u}
                  </a>
                </div>
              ))}
              {posts.map((p, i) => (
                <div key={p.tweetId}>
                  • {[p.like && "Like", p.retweet && "Retweet", p.quote && "Quote"].filter(Boolean).join(" + ")}{" "}
                  <a href={`https://x.com/i/status/${p.tweetId}`} target="_blank" rel="noreferrer" className="text-indigo-400 hover:underline">
                    post #{i + 1} ↗
                  </a>
                </div>
              ))}
            </div>
          )}
          {raffle.messageId && (
            <a
              href={`https://discord.com/channels/${raffle.guildId}/${raffle.channelId}/${raffle.messageId}`}
              target="_blank"
              rel="noreferrer"
              className="mt-3 inline-block text-sm text-indigo-400 hover:underline"
            >
              View message in Discord ↗
            </a>
          )}
        </div>
      </div>

      <div className="mb-6 flex flex-wrap gap-2">
        {raffle.status === "ACTIVE" &&
          (confirm ? (
            <div className="flex items-center gap-2 rounded-lg border border-zinc-700 px-3 py-1.5 text-sm">
              {confirm === "end" ? "End and draw winners now?" : "Cancel this raffle?"}
              <button className="btn btn-primary px-3 py-1" disabled={busy} onClick={() => act(`/${confirm}`)}>
                Yes
              </button>
              <button className="btn btn-ghost px-3 py-1" onClick={() => setConfirm(null)}>
                No
              </button>
            </div>
          ) : (
            <>
              <button className="btn btn-primary" disabled={busy} onClick={() => setConfirm("end")}>
                End & Draw Now
              </button>
              <button className="btn btn-danger" disabled={busy} onClick={() => setConfirm("cancel")}>
                Cancel Raffle
              </button>
            </>
          ))}
        {/* Raffle dengan allocation: satu file per GTD / FCFS, tombol muncul kalau sudah ada pemenangnya */}
        {withAllocations
          ? usedAllocations
              .filter((a) => counts[a] > 0)
              .map((a) => (
                <a key={a} className="btn btn-ghost" href={`/api/raffles/${raffle.id}/winners.xlsx?allocation=${a}`}>
                  Export {a} Winners (Excel)
                </a>
              ))
          : winnerCount > 0 && (
              <a className="btn btn-ghost" href={`/api/raffles/${raffle.id}/winners.xlsx`}>
                Export Winners (Excel)
              </a>
            )}
      </div>

      <div className="card">
        <div className="mb-4 flex flex-wrap items-center justify-between gap-3">
          <div className="flex flex-wrap gap-1">
            {filters.map((f) => (
              <button
                key={f}
                onClick={() => setFilter(f)}
                className={`rounded-lg px-3 py-1.5 text-sm ${filter === f ? "bg-zinc-800 text-white" : "text-zinc-400 hover:text-zinc-200"}`}
              >
                {filterLabel(f)} ({counts[f]})
              </button>
            ))}
          </div>
          <input className="input sm:max-w-60" placeholder="Search username / X / wallet" value={search} onChange={(e) => setSearch(e.target.value)} />
        </div>

        {shown.length === 0 ? (
          <p className="py-6 text-center text-sm text-zinc-500">No entries yet.</p>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-left text-sm">
              <thead className="text-xs uppercase text-zinc-500">
                <tr>
                  <th className="py-2 pr-4">User</th>
                  {hasX && <th className="py-2 pr-4">X</th>}
                  {quoteCount > 0 && <th className="py-2 pr-4">Quote{quoteCount > 1 ? "s" : ""}</th>}
                  {raffle.walletType !== "NONE" && <th className="py-2 pr-4">Wallet</th>}
                  <th className="py-2 pr-4">Status</th>
                  <th className="py-2 pr-4">Entered</th>
                  <th className="py-2" />
                </tr>
              </thead>
              <tbody className="divide-y divide-zinc-800">
                {shown.slice(0, 500).map((e) => (
                  <tr key={e.id}>
                    <td className="py-2 pr-4">
                      <div>{e.username}</div>
                      <div className="text-xs text-zinc-500">{e.userId}</div>
                    </td>
                    {hasX && (
                      <td className="py-2 pr-4">
                        {e.xUsername && (
                          <a href={`https://x.com/${e.xUsername}`} target="_blank" rel="noreferrer" className="text-indigo-400 hover:underline">
                            @{e.xUsername}
                          </a>
                        )}
                      </td>
                    )}
                    {quoteCount > 0 && (
                      <td className="py-2 pr-4">
                        <div className="flex flex-wrap gap-2">
                          {e.xQuoteUrls.map((url, n) => (
                            <a key={url} href={url} target="_blank" rel="noreferrer" className="text-indigo-400 hover:underline">
                              {e.xQuoteUrls.length > 1 ? `#${n + 1}` : "view"} ↗
                            </a>
                          ))}
                        </div>
                      </td>
                    )}
                    {raffle.walletType !== "NONE" && <td className="py-2 pr-4 font-mono text-xs">{e.wallet}</td>}
                    <td className={`py-2 pr-4 ${ENTRY_STATUS[e.status].cls}`}>
                      {e.status === "WON" && e.allocation ? `🏆 Won · ${e.allocation}` : ENTRY_STATUS[e.status].label}
                      {e.note && <div className="text-xs text-zinc-500">{e.note}</div>}
                    </td>
                    <td className="py-2 pr-4 text-xs text-zinc-500">{formatDate(e.createdAt)}</td>
                    <td className="py-2 text-right">
                      {e.status !== "DISQUALIFIED" && (
                        <button
                          className="text-xs text-red-400 hover:underline disabled:opacity-50"
                          disabled={busy}
                          onClick={() => act(`/entries/${e.id}/disqualify`)}
                        >
                          Disqualify
                        </button>
                      )}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
            {shown.length > 500 && (
              <p className="mt-3 text-xs text-zinc-500">Showing 500 of {shown.length}.</p>
            )}
          </div>
        )}
      </div>
    </div>
  );
}
