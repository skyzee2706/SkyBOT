import { useCallback, useEffect, useState, type FormEvent } from "react";
import { Link, useNavigate, useParams } from "react-router-dom";
import {
  ArrowLeft,
  Ban,
  CircleCheckBig,
  ExternalLink,
  Flag,
  Globe,
  Heart,
  Link2,
  Lock,
  MessageSquareQuote,
  Repeat2,
  Settings,
  Ticket,
  Trophy,
  UserPlus,
  UserRoundX,
  type LucideIcon,
} from "lucide-react";
import { api, loginUrl, setPageTitle } from "../api";
import { ErrorBox, formatDate, Loading, roleColor, StatusBadge } from "../components";
import { timeLeft } from "./RafflesList";
import { DiscordMarkdown } from "../DiscordMarkdown";

type PublicRaffle = {
  raffle: {
    id: string;
    title: string;
    description: string;
    imageUrl: string | null;
    status: "ACTIVE" | "ENDED" | "CANCELLED";
    endsAt: string;
    endedAt: string | null;
    hostName: string | null;
    hostAvatar: string | null;
    chain: string | null;
    allocations: string;
    spots: number;
    walletType: "NONE" | "EVM" | "SOL" | "CUSTOM";
    minAccountAgeDays: number;
    requireAnyRole: boolean;
    requireMember: boolean;
    inviteUrl: string | null;
    requiredRoles: { id: string; name: string; color: number }[];
    quoteCount: number;
    hasXTasks: boolean;
    tasks: { key: string; kind: "follow" | "like" | "retweet" | "quote"; label: string }[];
    entryCount: number;
    discordUrl: string | null;
  };
  guild: { id: string; name: string; icon: string | null } | null;
  canManage: boolean;
  viewer: null | {
    userId: string;
    entry: null | {
      status: "ENTERED" | "WON" | "DISQUALIFIED";
      allocation: "GTD" | "FCFS" | null;
      wallet: string | null;
      xUsername: string | null;
      note: string | null;
    };
    isMember: boolean | null;
    requirementErrors: string[];
    wallet: string | null; // wallet tersimpan di profil untuk jenis wallet raffle ini
    xUsername: string | null;
    connectXUrl: string | null;
    tasks: { key: string; done: boolean; url: string | null }[];
  };
};


// Halaman raffle publik: bisa dibuka tanpa login, ikut raffle butuh login Discord.
export function PublicRafflePage() {
  const { id } = useParams();
  const navigate = useNavigate();
  const [data, setData] = useState<PublicRaffle | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [now, setNow] = useState(Date.now());

  const load = useCallback(() => {
    api<PublicRaffle>(`/p/raffles/${id}`)
      .then((d) => {
        setData(d);
        setError(null);
      })
      .catch((e) => setError(e.message));
  }, [id]);

  useEffect(load, [load]);
  useEffect(() => {
    if (data) setPageTitle(data.raffle.title);
    return () => setPageTitle();
  }, [data?.raffle.title]);
  // Setelah membuka task X / Connect X di tab lain, status diperbarui saat peserta kembali ke tab ini
  useEffect(() => {
    const onFocus = () => document.visibilityState === "visible" && load();
    window.addEventListener("focus", onFocus);
    document.addEventListener("visibilitychange", onFocus);
    return () => {
      window.removeEventListener("focus", onFocus);
      document.removeEventListener("visibilitychange", onFocus);
    };
  }, [load]);
  useEffect(() => {
    const t = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(t);
  }, []);
  // Saat hitung mundur habis, muat ulang supaya hasil undian tampil
  const ended = data && data.raffle.status === "ACTIVE" && new Date(data.raffle.endsAt).getTime() <= now;
  useEffect(() => {
    if (ended) {
      const t = setTimeout(load, 1500);
      return () => clearTimeout(t);
    }
  }, [ended, load]);

  if (!data) return error ? <ErrorBox error={error} /> : <Loading />;
  const { raffle: r, guild, viewer, canManage } = data;
  const active = r.status === "ACTIVE";
  // Kembali ke halaman sebelumnya kalau datang dari dalam web; kalau dibuka langsung (mis. dari Discord), ke daftar raffle
  const cameFromApp = (window.history.state?.idx ?? 0) > 0;
  const listPath = "/raffles";

  return (
    <>
      <button
        type="button"
        onClick={() => (cameFromApp ? navigate(-1) : navigate(listPath))}
        className="mb-4 inline-flex items-center gap-1 text-sm text-zinc-400 hover:text-brand-300"
      >
        <ArrowLeft className="h-4 w-4" /> Back to raffles
      </button>
      <div className="grid gap-6 lg:grid-cols-[1fr_380px]">
        <div className="space-y-6">
          <div className="card">
            {guild && (
              <div className="mb-3 flex items-center gap-2 text-sm text-zinc-400">
                {guild.icon && (
                  <img src={`https://cdn.discordapp.com/icons/${guild.id}/${guild.icon}.png?size=64`} className="h-5 w-5 rounded-full" alt="" />
                )}
                {guild.name}
              </div>
            )}
            <div className="mb-2 flex flex-wrap items-center gap-2">
              <h1 className="text-2xl font-bold">{r.title}</h1>
              <StatusBadge status={r.status} />
            </div>
            {r.hostName && (
              <div className="mb-3 flex items-center gap-2 text-sm text-zinc-400">
                {r.hostAvatar && <img src={r.hostAvatar} className="h-5 w-5 rounded-full" alt="" />}
                Hosted by <span className="font-medium text-zinc-200">{r.hostName}</span>
              </div>
            )}
            {r.imageUrl && <img src={r.imageUrl} className="mb-4 max-h-96 w-full rounded-xl object-cover" alt="" />}
            {r.description && <DiscordMarkdown text={r.description} />}
          </div>

          <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
            <Info label="Allocations" value={r.allocations} />
            <Info label="Chain" value={r.chain ?? "—"} />
            <Info
              label="Entries"
              value={String(r.entryCount)}
              sub={
                active && r.spots > 0
                  ? r.entryCount <= r.spots
                    ? "Every entry wins so far"
                    : `~1 in ${(r.entryCount / r.spots).toFixed(r.entryCount / r.spots < 10 ? 1 : 0)} odds`
                  : undefined
              }
            />
            <Info
              label={active ? "Ends in" : "Ended"}
              value={active ? timeLeft(r.endsAt, now) : formatDate(r.endedAt ?? r.endsAt)}
              sub={active ? formatDate(r.endsAt) : undefined}
            />
          </div>

          <div className="card space-y-2 text-sm">
            <h2 className="mb-1 font-semibold">Requirements</h2>
            {r.requiredRoles.length > 0 && (
              <div>
                {r.requireAnyRole && r.requiredRoles.length > 1 ? "Have one of these roles: " : "Required role: "}
                {r.requiredRoles.map((role, i) => (
                  <span key={role.id}>
                    {i > 0 && (r.requireAnyRole ? " or " : ", ")}
                    <span style={{ color: roleColor(role.color) }}>@{role.name}</span>
                  </span>
                ))}
              </div>
            )}
            {r.requireMember ? (
              <div>
                Member of <b>{guild?.name ?? "the Discord server"}</b>
                {r.inviteUrl && (
                  <a href={r.inviteUrl} target="_blank" rel="noreferrer" className="ml-2 inline-flex items-center gap-1 text-brand-400 hover:underline">
                    Join server <ExternalLink className="h-3.5 w-3.5" />
                  </a>
                )}
              </div>
            ) : (
              <div className="flex items-center gap-2">
                <Globe className="h-4 w-4 text-zinc-400" /> Open to everyone, no need to join the server
              </div>
            )}
            {r.minAccountAgeDays > 0 && <div>Discord account at least {r.minAccountAgeDays} days old</div>}
            {r.hasXTasks && <div>Connect your X account and complete the X tasks</div>}
            {r.walletType !== "NONE" && (
              <div>Submit {r.walletType === "EVM" ? "an EVM (0x...)" : r.walletType === "SOL" ? "a Solana" : `your ${r.chain}`} wallet</div>
            )}
            {r.discordUrl && (
              <a href={r.discordUrl} target="_blank" rel="noreferrer" className="inline-flex items-center gap-1 pt-2 text-brand-400 hover:underline">
                View in Discord <ExternalLink className="h-3.5 w-3.5" />
              </a>
            )}
          </div>
          <Entrants raffleId={r.id} ended={r.status === "ENDED"} total={r.entryCount} />
        </div>

        <div className="space-y-4 lg:sticky lg:top-6 lg:self-start">
          {canManage && (
            <Link to={`/r/${r.id}`} className="btn btn-ghost w-full">
              <Settings className="h-4 w-4" /> Manage raffle (full entrant data)
            </Link>
          )}
          <EntryPanel data={data} reload={load} />
        </div>
      </div>
    </>
  );
}

function Info({ label, value, sub }: { label: string; value: string; sub?: string }) {
  return (
    <div className="card p-4">
      <div className="text-xs uppercase tracking-wide text-brand-300/80">{label}</div>
      <div className="mt-1 font-semibold">{value}</div>
      {sub && <div className="mt-0.5 text-xs text-zinc-500">{sub}</div>}
    </div>
  );
}

function EntryPanel({ data, reload }: { data: PublicRaffle; reload: () => void }) {
  const { raffle: r, viewer, guild } = data;
  const [wallet, setWallet] = useState("");
  const [quotes, setQuotes] = useState<string[]>(() => Array(r.quoteCount).fill(""));
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const returnTo = `/raffle/${r.id}`;

  const submit = async (e: FormEvent) => {
    e.preventDefault();
    setBusy(true);
    setError(null);
    try {
      await api(`/p/raffles/${r.id}/enter`, {
        body: { wallet: (!viewer?.wallet && wallet) || undefined, quoteUrls: r.quoteCount ? quotes : undefined },
      });
      reload();
    } catch (err) {
      setError((err as Error).message);
      reload();
    } finally {
      setBusy(false);
    }
  };

  // Raffle selesai / batal
  if (r.status !== "ACTIVE") {
    const entry = viewer?.entry;
    return (
      <div className="card space-y-2 text-center">
        <StatusIcon
          icon={r.status === "CANCELLED" ? Ban : entry?.status === "WON" ? Trophy : Flag}
          tone={r.status === "CANCELLED" ? "red" : entry?.status === "WON" ? "green" : "zinc"}
        />
        <div className="font-semibold">{r.status === "CANCELLED" ? "This raffle was cancelled" : "This raffle has ended"}</div>
        {r.status === "ENDED" && viewer && (
          <p className="text-sm text-zinc-400">
            {!entry
              ? "You didn't enter this raffle."
              : entry.status === "WON"
                ? `Congratulations, you won${entry.allocation ? ` a ${entry.allocation} spot` : ""}!`
                : entry.status === "DISQUALIFIED"
                  ? `You were disqualified${entry.note ? `: ${entry.note}` : "."}`
                  : "You weren't selected this time."}
          </p>
        )}
        {!viewer && r.status === "ENDED" && <LoginButton returnTo={returnTo} label="Log in to see your result" />}
      </div>
    );
  }

  if (!viewer) {
    return (
      <div className="card space-y-3 text-center">
        <div className="font-semibold">Enter this raffle</div>
        <p className="text-sm text-zinc-400">
          {r.requireMember
            ? `Log in with Discord to enter. You must be a member of ${guild?.name ?? "the server"}.`
            : "Log in with Discord to enter. No need to join the server."}
        </p>
        <LoginButton returnTo={returnTo} label="Log in with Discord" />
      </div>
    );
  }

  if (viewer.entry) {
    return (
      <div className="card space-y-2 text-center">
        <StatusIcon icon={CircleCheckBig} tone="green" />
        <div className="font-semibold">You're entered!</div>
        <p className="text-sm text-zinc-400">Winners are drawn automatically when the raffle ends. Good luck!</p>
        {viewer.entry.xUsername && <p className="text-xs text-zinc-500">X: @{viewer.entry.xUsername}</p>}
        {viewer.entry.wallet && <p className="break-all font-mono text-xs text-zinc-500">{viewer.entry.wallet}</p>}
      </div>
    );
  }

  // Raffle khusus member: non-member harus join server dulu (task tambahan)
  if (r.requireMember && viewer.isMember === false) {
    return (
      <div className="card space-y-3 text-center">
        <StatusIcon icon={UserRoundX} tone="amber" />
        <div className="font-semibold">You haven't joined the Discord server yet</div>
        {r.inviteUrl ? (
          <>
            <p className="text-sm text-zinc-400">
              This raffle is only open to members of <b className="text-zinc-200">{guild?.name ?? "the community"}</b>. Join the
              server, then come back to enter.
            </p>
            <a href={r.inviteUrl} target="_blank" rel="noreferrer" className="btn btn-primary w-full py-3">
              Join {guild?.name ?? "the Server"} Now <ExternalLink className="h-4 w-4" />
            </a>
          </>
        ) : (
          <p className="text-sm text-zinc-400">
            This raffle is only open to members of <b className="text-zinc-200">{guild?.name ?? "the community"}</b>. Please
            contact the community to get an invite link, then come back to enter.
          </p>
        )}
        <button className="btn btn-ghost w-full" onClick={reload}>
          I've joined, check again
        </button>
      </div>
    );
  }

  const tasksDone = viewer.tasks.every((t) => t.done);
  const needsX = r.hasXTasks && !viewer.xUsername;
  const blocked = viewer.requirementErrors.length > 0;

  return (
    <form onSubmit={submit} className="card space-y-4">
      <div className="font-semibold">Enter this raffle</div>

      {blocked && (
        <div className="rounded-lg border border-red-900 bg-red-950/50 px-3 py-2 text-sm text-red-300">
          <div className="mb-1 font-medium">You don't meet the requirements yet:</div>
          {viewer.requirementErrors.map((e) => (
            <div key={e}>• {e}</div>
          ))}
        </div>
      )}

      {r.hasXTasks && (
        <div className="space-y-2">
          <div className="flex items-center justify-between text-sm">
            <span className="font-medium">X account</span>
            {viewer.xUsername && <span className="text-zinc-400">@{viewer.xUsername}</span>}
          </div>
          {viewer.connectXUrl && (
            <a href={viewer.connectXUrl} className={`btn w-full ${needsX ? "btn-primary" : "btn-ghost"}`}>
              {needsX ? (
                <>
                  <Link2 className="h-4 w-4" /> Connect X account
                </>
              ) : (
                "Switch X account"
              )}
            </a>
          )}
        </div>
      )}

      {r.hasXTasks && !needsX && (
        <div className="space-y-2">
          <div className="text-sm font-medium">
            Tasks{" "}
            <span className="text-zinc-500">
              ({viewer.tasks.filter((t) => t.done).length}/{viewer.tasks.length})
            </span>
          </div>
          {r.tasks.map((t) => {
            const state = viewer.tasks.find((v) => v.key === t.key);
            return state?.done ? (
              <div key={t.key} className="flex items-center justify-between rounded-lg border border-emerald-700 bg-emerald-500/10 px-3 py-2 text-sm text-emerald-300">
                <TaskLabel kind={t.kind} label={t.label} /> <CircleCheckBig className="h-4 w-4" />
              </div>
            ) : (
              <a
                key={t.key}
                href={state?.url ?? "#"}
                target="_blank"
                rel="noreferrer"
                className="flex items-center justify-between rounded-lg border border-zinc-700 px-3 py-2 text-sm hover:border-zinc-500"
              >
                <TaskLabel kind={t.kind} label={t.label} /> <ExternalLink className="h-4 w-4 text-zinc-500" />
              </a>
            );
          })}
          {!tasksDone && <p className="hint">Open every task. Each one turns green once opened.</p>}
        </div>
      )}

      {r.quoteCount > 0 && !needsX &&
        quotes.map((q, i) => (
          <div key={i}>
            <label className="label">{r.quoteCount > 1 ? `Link to your quote of post #${i + 1}` : "Link to your quote post"}</label>
            <input
              className="input"
              placeholder="https://x.com/yourname/status/..."
              value={q}
              onChange={(e) => setQuotes((qs) => qs.map((v, n) => (n === i ? e.target.value : v)))}
              required
            />
          </div>
        ))}

      {r.walletType !== "NONE" && viewer.wallet && (
        <div>
          <div className="label">{r.walletType === "EVM" ? "EVM wallet" : `${r.chain} wallet`}</div>
          <div className="input break-all font-mono text-zinc-400">{viewer.wallet}</div>
        </div>
      )}

      {r.walletType !== "NONE" && !viewer.wallet && (
        <div>
          <label className="label">{r.walletType === "EVM" ? "EVM wallet address" : `${r.walletType === "SOL" ? "Solana" : r.chain} wallet address`}</label>
          <input
            className="input font-mono"
            placeholder={r.walletType === "EVM" ? "0x..." : `Your ${r.walletType === "SOL" ? "Solana" : r.chain} address`}
            value={wallet}
            onChange={(e) => setWallet(e.target.value.trim())}
            required
          />
        </div>
      )}

      {error && <p className="text-sm text-red-400">{error}</p>}
      <button className="btn btn-primary w-full py-3" disabled={busy || blocked || needsX || !tasksDone}>
        {busy ? (
          "Entering..."
        ) : !tasksDone || needsX ? (
          <>
            <Lock className="h-4 w-4" /> Complete the tasks to enter
          </>
        ) : (
          <>
            <Ticket className="h-4 w-4" /> Enter raffle
          </>
        )}
      </button>
    </form>
  );
}

function LoginButton({ returnTo, label }: { returnTo: string; label: string }) {
  return (
    <a href={loginUrl(returnTo)} className="btn btn-primary w-full">
      {label}
    </a>
  );
}

type EntrantRow = { id: string; username: string; avatarUrl: string; winner: "GTD" | "FCFS" | "WINNER" | null };

// Daftar peserta publik: username + foto Discord saja (wallet / X hanya terlihat oleh host di halaman kelola)
function Entrants({ raffleId, ended, total }: { raffleId: string; ended: boolean; total: number }) {
  const [rows, setRows] = useState<EntrantRow[] | null>(null);
  const [page, setPage] = useState(0);
  const [hasMore, setHasMore] = useState(false);
  const [busy, setBusy] = useState(false);

  const load = useCallback(
    async (p: number) => {
      const d = await api<{ entries: EntrantRow[]; hasMore: boolean }>(`/p/raffles/${raffleId}/entries?page=${p}`);
      setRows((prev) => (p === 0 ? d.entries : [...(prev ?? []), ...d.entries]));
      setHasMore(d.hasMore);
      setPage(p);
    },
    [raffleId],
  );
  // Muat ulang saat jumlah peserta / status berubah (mis. setelah ikut atau setelah undian)
  useEffect(() => {
    load(0).catch(() => setRows([]));
  }, [load, total, ended]);

  return (
    <div className="card">
      <h2 className="mb-3 font-semibold">
        Entrants <span className="text-zinc-500">({total})</span>
      </h2>
      {!rows ? (
        <Loading />
      ) : rows.length === 0 ? (
        <p className="text-sm text-zinc-500">No one has entered yet. Be the first!</p>
      ) : (
        <div className="grid gap-2 sm:grid-cols-2">
          {rows.map((e) => (
            <div
              key={e.id}
              className={`flex items-center gap-2 rounded-lg px-2 py-1.5 ${e.winner ? "bg-emerald-500/10 ring-1 ring-emerald-700" : ""}`}
            >
              <img src={e.avatarUrl} className="h-7 w-7 rounded-full" alt="" loading="lazy" />
              <span className="min-w-0 flex-1 truncate text-sm">{e.username}</span>
              {e.winner && (
                <span className="inline-flex items-center gap-1 rounded-full bg-emerald-500/20 px-2 py-0.5 text-xs text-emerald-300">
                  <Trophy className="h-3 w-3" /> {e.winner === "WINNER" ? "Winner" : e.winner}
                </span>
              )}
            </div>
          ))}
        </div>
      )}
      {hasMore && (
        <button
          className="btn btn-ghost mt-3 w-full"
          disabled={busy}
          onClick={async () => {
            setBusy(true);
            await load(page + 1).catch(() => {});
            setBusy(false);
          }}
        >
          {busy ? "Loading..." : "Show more"}
        </button>
      )}
    </div>
  );
}

const TASK_ICON: Record<"follow" | "like" | "retweet" | "quote", LucideIcon> = {
  follow: UserPlus,
  like: Heart,
  retweet: Repeat2,
  quote: MessageSquareQuote,
};

function TaskLabel({ kind, label }: { kind: keyof typeof TASK_ICON; label: string }) {
  const Icon = TASK_ICON[kind] ?? ExternalLink;
  return (
    <span className="inline-flex items-center gap-2">
      <Icon className="h-4 w-4" /> {label}
    </span>
  );
}

const TONES = {
  green: "bg-emerald-500/15 text-emerald-400",
  red: "bg-red-500/15 text-red-400",
  amber: "bg-amber-500/15 text-amber-400",
  zinc: "bg-zinc-800 text-zinc-300",
};

function StatusIcon({ icon: Icon, tone }: { icon: LucideIcon; tone: keyof typeof TONES }) {
  return (
    <div className={`mx-auto grid h-12 w-12 place-items-center rounded-full ${TONES[tone]}`}>
      <Icon className="h-6 w-6" />
    </div>
  );
}
