import { useCallback, useEffect, useState } from "react";
import { Link, useParams } from "react-router-dom";
import { api, type Entry, type Raffle } from "../api";
import { ErrorBox, formatDate, Loading, StatusBadge } from "../components";

type Filter = "ALL" | Entry["status"];

const ENTRY_STATUS: Record<Entry["status"], { label: string; cls: string }> = {
  ENTERED: { label: "Terdaftar", cls: "text-zinc-400" },
  WON: { label: "🏆 Menang", cls: "text-emerald-400" },
  DISQUALIFIED: { label: "Diskualifikasi", cls: "text-red-400" },
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
  const hasX = raffle.xFollowUsernames.length > 0 || !!raffle.xTweetId;

  const counts = {
    ALL: entries.length,
    ENTERED: entries.filter((e) => e.status === "ENTERED").length,
    WON: entries.filter((e) => e.status === "WON").length,
    DISQUALIFIED: entries.filter((e) => e.status === "DISQUALIFIED").length,
  };
  const q = search.trim().toLowerCase();
  const shown = entries.filter(
    (e) =>
      (filter === "ALL" || e.status === filter) &&
      (!q ||
        e.username.toLowerCase().includes(q) ||
        e.userId.includes(q) ||
        e.wallet?.toLowerCase().includes(q) ||
        e.xUsername?.toLowerCase().includes(q)),
  );

  return (
    <div>
      <Link to={`/g/${raffle.guildId}`} className="mb-4 inline-block text-sm text-zinc-400 hover:text-zinc-200">
        ← Kembali ke server
      </Link>
      <ErrorBox error={error} />

      <div className="card mb-6 flex flex-col gap-5 sm:flex-row">
        {raffle.imageUrl && <img src={raffle.imageUrl} className="h-32 w-32 rounded-xl object-cover" alt="" />}
        <div className="min-w-0 flex-1">
          <div className="mb-2 flex items-center gap-2">
            <h1 className="truncate text-2xl font-bold">{raffle.title}</h1>
            <StatusBadge status={raffle.status} />
          </div>
          {raffle.description && <p className="mb-3 whitespace-pre-wrap text-sm text-zinc-400">{raffle.description}</p>}
          <div className="flex flex-wrap gap-x-6 gap-y-1 text-sm text-zinc-400">
            <span>{raffle.winnerCount} pemenang</span>
            <span>{entries.length} peserta</span>
            <span>
              {raffle.status === "ACTIVE" ? "Berakhir" : "Selesai"} {formatDate(raffle.endedAt ?? raffle.endsAt)}
            </span>
            {raffle.walletType !== "NONE" && <span>Wallet {raffle.walletType}</span>}
          </div>
          {hasX && (
            <div className="mt-2 text-sm text-zinc-400">
              Task X:{" "}
              {[
                ...raffle.xFollowUsernames.map((u) => `follow @${u}`),
                raffle.xLike && "like",
                raffle.xRetweet && "retweet",
              ]
                .filter(Boolean)
                .join(", ")}
              {raffle.xTweetId && (
                <a href={`https://x.com/i/status/${raffle.xTweetId}`} target="_blank" rel="noreferrer" className="ml-2 text-indigo-400 hover:underline">
                  lihat post ↗
                </a>
              )}
            </div>
          )}
          {raffle.messageId && (
            <a
              href={`https://discord.com/channels/${raffle.guildId}/${raffle.channelId}/${raffle.messageId}`}
              target="_blank"
              rel="noreferrer"
              className="mt-3 inline-block text-sm text-indigo-400 hover:underline"
            >
              Lihat pesan di Discord ↗
            </a>
          )}
        </div>
      </div>

      <div className="mb-6 flex flex-wrap gap-2">
        {raffle.status === "ACTIVE" &&
          (confirm ? (
            <div className="flex items-center gap-2 rounded-lg border border-zinc-700 px-3 py-1.5 text-sm">
              {confirm === "end" ? "Akhiri & undi sekarang?" : "Batalkan raffle ini?"}
              <button className="btn btn-primary px-3 py-1" disabled={busy} onClick={() => act(`/${confirm}`)}>
                Ya
              </button>
              <button className="btn btn-ghost px-3 py-1" onClick={() => setConfirm(null)}>
                Tidak
              </button>
            </div>
          ) : (
            <>
              <button className="btn btn-primary" disabled={busy} onClick={() => setConfirm("end")}>
                Akhiri & Undi Sekarang
              </button>
              <button className="btn btn-danger" disabled={busy} onClick={() => setConfirm("cancel")}>
                Batalkan
              </button>
            </>
          ))}
        {raffle.status === "ENDED" && (
          <button className="btn btn-primary" disabled={busy || counts.ENTERED === 0} onClick={() => act("/reroll", { count: 1 })}>
            {busy ? "Mengundi..." : "🔁 Reroll 1 Pemenang"}
          </button>
        )}
        <a className="btn btn-ghost" href={`/api/raffles/${raffle.id}/export.csv`}>
          Export Peserta (CSV)
        </a>
        <a className="btn btn-ghost" href={`/api/raffles/${raffle.id}/export.csv?winners=1`}>
          Export Pemenang (CSV)
        </a>
      </div>

      <div className="card">
        <div className="mb-4 flex flex-wrap items-center justify-between gap-3">
          <div className="flex flex-wrap gap-1">
            {(["ALL", "WON", "ENTERED", "DISQUALIFIED"] as Filter[]).map((f) => (
              <button
                key={f}
                onClick={() => setFilter(f)}
                className={`rounded-lg px-3 py-1.5 text-sm ${filter === f ? "bg-zinc-800 text-white" : "text-zinc-400 hover:text-zinc-200"}`}
              >
                {f === "ALL" ? "Semua" : ENTRY_STATUS[f].label} ({counts[f]})
              </button>
            ))}
          </div>
          <input className="input sm:max-w-60" placeholder="Cari username / X / wallet" value={search} onChange={(e) => setSearch(e.target.value)} />
        </div>

        {shown.length === 0 ? (
          <p className="py-6 text-center text-sm text-zinc-500">Belum ada data.</p>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-left text-sm">
              <thead className="text-xs uppercase text-zinc-500">
                <tr>
                  <th className="py-2 pr-4">User</th>
                  {hasX && <th className="py-2 pr-4">X</th>}
                  {raffle.walletType !== "NONE" && <th className="py-2 pr-4">Wallet</th>}
                  <th className="py-2 pr-4">Status</th>
                  <th className="py-2 pr-4">Masuk</th>
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
                    {raffle.walletType !== "NONE" && <td className="py-2 pr-4 font-mono text-xs">{e.wallet}</td>}
                    <td className={`py-2 pr-4 ${ENTRY_STATUS[e.status].cls}`}>
                      {ENTRY_STATUS[e.status].label}
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
                          Diskualifikasi
                        </button>
                      )}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
            {shown.length > 500 && <p className="mt-3 text-xs text-zinc-500">Menampilkan 500 dari {shown.length}. Pakai export CSV untuk semua data.</p>}
          </div>
        )}
      </div>
    </div>
  );
}
