import { useCallback, useEffect, useState, type FormEvent } from "react";
import { Link } from "react-router-dom";
import { api, ApiError } from "../api";
import { ErrorBox, formatDate, Loading } from "../components";
import { Lock } from "lucide-react";
import { LogoMark } from "../Logo";

type Stats = {
  totals: {
    raffles: number;
    active: number;
    ended: number;
    cancelled: number;
    entries: number;
    winners: number;
    users: number;
    creators: number;
    communities: number | null;
    communitiesWithRaffles: number;
  };
  communities: {
    id: string;
    name: string | null;
    icon: string | null;
    botPresent: boolean | null;
    raffles: number;
    entries: number;
    lastRaffleAt: string | null;
  }[];
  users: {
    id: string;
    username: string;
    avatar: string | null;
    firstLoginAt: string;
    lastLoginAt: string | null;
    rafflesCreated: number;
  }[];
  recentRaffles: {
    id: string;
    title: string;
    guildId: string;
    guildName: string | null;
    hostName: string | null;
    status: string;
    allocations: string;
    chain: string | null;
    entries: number;
    createdAt: string;
  }[];
};

const guildIcon = (g: { id: string; icon: string | null }) =>
  g.icon ? `https://cdn.discordapp.com/icons/${g.id}/${g.icon}.png?size=64` : null;
const userAvatar = (u: { id: string; avatar: string | null }) =>
  u.avatar
    ? `https://cdn.discordapp.com/avatars/${u.id}/${u.avatar}.png?size=64`
    : `https://cdn.discordapp.com/embed/avatars/${Number((BigInt(u.id) >> 22n) % 6n)}.png`;

// Halaman tersembunyi (tidak ada link ke sini). Login pakai PIN, terpisah dari login Discord.
export function AdminPage() {
  const [state, setState] = useState<"loading" | "disabled" | "locked" | "open">("loading");

  useEffect(() => {
    api<{ enabled: boolean; loggedIn: boolean }>("/admin/session")
      .then((s) => setState(!s.enabled ? "disabled" : s.loggedIn ? "open" : "locked"))
      .catch(() => setState("locked"));
  }, []);

  return (
    <div className="min-h-screen">
      <header className="border-b border-brand-500/20 bg-zinc-950/80">
        <div className="mx-auto flex max-w-6xl items-center justify-between px-4 py-3">
          <Link to="/" className="flex items-center gap-2 font-semibold">
            <LogoMark /> SkyBOT Raffle <span className="text-sm font-normal text-zinc-500">· Admin</span>
          </Link>
          {state === "open" && (
            <button
              className="text-sm text-zinc-400 hover:text-zinc-200"
              onClick={async () => {
                await api("/admin/logout", { method: "POST" });
                setState("locked");
              }}
            >
              Lock
            </button>
          )}
        </div>
      </header>
      <main className="mx-auto max-w-6xl px-4 py-8">
        {state === "loading" && <Loading />}
        {state === "disabled" && (
          <p className="text-center text-zinc-400">The admin page is disabled. Set ADMIN_PIN in Vercel to enable it.</p>
        )}
        {state === "locked" && <PinForm onUnlock={() => setState("open")} />}
        {state === "open" && <Dashboard onExpired={() => setState("locked")} />}
      </main>
    </div>
  );
}

function PinForm({ onUnlock }: { onUnlock: () => void }) {
  const [pin, setPin] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const submit = async (e: FormEvent) => {
    e.preventDefault();
    setBusy(true);
    setError(null);
    try {
      await api("/admin/login", { body: { pin } });
      onUnlock();
    } catch (err) {
      setError((err as Error).message);
      setPin("");
    } finally {
      setBusy(false);
    }
  };

  return (
    <form onSubmit={submit} className="card mx-auto mt-10 max-w-sm space-y-4 text-center">
      <Lock className="mx-auto h-8 w-8 text-brand-400" />
      <h1 className="text-lg font-semibold">Enter admin PIN</h1>
      <input
        className="input text-center text-2xl tracking-[0.5em]"
        type="password"
        inputMode="numeric"
        autoComplete="off"
        maxLength={12}
        autoFocus
        value={pin}
        onChange={(e) => setPin(e.target.value.replace(/\D/g, ""))}
      />
      {error && <p className="text-sm text-red-400">{error}</p>}
      <button className="btn btn-primary w-full" disabled={busy || pin.length < 6}>
        {busy ? "Checking..." : "Unlock"}
      </button>
    </form>
  );
}

function Stat({ label, value, sub }: { label: string; value: number | string; sub?: string }) {
  return (
    <div className="card">
      <div className="text-xs uppercase tracking-wide text-brand-300/80">{label}</div>
      <div className="mt-1 text-3xl font-semibold tabular-nums">{value}</div>
      {sub && <div className="mt-1 text-xs text-zinc-500">{sub}</div>}
    </div>
  );
}

function Dashboard({ onExpired }: { onExpired: () => void }) {
  const [stats, setStats] = useState<Stats | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [tab, setTab] = useState<"communities" | "users" | "raffles">("communities");
  const [search, setSearch] = useState("");

  const load = useCallback(() => {
    setError(null);
    api<Stats>("/admin/stats")
      .then(setStats)
      .catch((e) => (e instanceof ApiError && e.status === 401 ? onExpired() : setError(e.message)));
  }, [onExpired]);
  useEffect(load, [load]);

  if (!stats) return error ? <ErrorBox error={error} /> : <Loading />;
  const t = stats.totals;
  const q = search.trim().toLowerCase();
  const has = (...v: (string | null)[]) => !q || v.some((x) => x?.toLowerCase().includes(q));

  return (
    <div className="space-y-6">
      <ErrorBox error={error} />
      <div className="flex items-center justify-between">
        <h1 className="text-2xl font-bold">Statistics</h1>
        <button className="btn btn-ghost" onClick={load}>
          Refresh
        </button>
      </div>

      <div className="grid grid-cols-2 gap-3 md:grid-cols-4">
        <Stat label="Raffles created" value={t.raffles} sub={`${t.active} active · ${t.ended} ended · ${t.cancelled} cancelled`} />
        <Stat
          label="Communities"
          value={t.communities ?? "?"}
          sub={`bot installed · ${t.communitiesWithRaffles} ran a raffle`}
        />
        <Stat label="Users logged in" value={t.users} sub={`${t.creators} created a raffle`} />
        <Stat label="Entries" value={t.entries} sub={`${t.winners} winners`} />
      </div>

      <div className="card">
        <div className="mb-4 flex flex-wrap items-center justify-between gap-3">
          <div className="flex flex-wrap gap-1">
            {(
              [
                ["communities", `Communities (${stats.communities.length})`],
                ["users", `Users (${stats.users.length})`],
                ["raffles", `Recent raffles (${stats.recentRaffles.length})`],
              ] as const
            ).map(([k, label]) => (
              <button
                key={k}
                onClick={() => setTab(k)}
                className={`rounded-lg px-3 py-1.5 text-sm ${tab === k ? "bg-brand-500/15 text-brand-200 ring-1 ring-brand-500/30" : "text-zinc-400 hover:text-zinc-200"}`}
              >
                {label}
              </button>
            ))}
          </div>
          <input className="input sm:max-w-60" placeholder="Search" value={search} onChange={(e) => setSearch(e.target.value)} />
        </div>

        <div className="overflow-x-auto">
          {tab === "communities" && (
            <table className="w-full text-left text-sm">
              <thead className="text-xs uppercase text-zinc-500">
                <tr>
                  <th className="py-2 pr-4">Community</th>
                  <th className="py-2 pr-4">Bot</th>
                  <th className="py-2 pr-4 text-right">Raffles</th>
                  <th className="py-2 pr-4 text-right">Entries</th>
                  <th className="py-2">Last raffle</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-zinc-800">
                {stats.communities
                  .filter((c) => has(c.name, c.id))
                  .map((c) => (
                    <tr key={c.id}>
                      <td className="py-2 pr-4">
                        <div className="flex items-center gap-2">
                          {guildIcon(c) ? (
                            <img src={guildIcon(c)!} className="h-7 w-7 rounded-full" alt="" />
                          ) : (
                            <div className="grid h-7 w-7 place-items-center rounded-full bg-zinc-800 text-xs">
                              {(c.name ?? "?")[0]}
                            </div>
                          )}
                          <div>
                            <div>{c.name ?? <span className="text-zinc-500">Unknown server</span>}</div>
                            <div className="text-xs text-zinc-500">{c.id}</div>
                          </div>
                        </div>
                      </td>
                      <td className="py-2 pr-4">
                        {c.botPresent === null ? (
                          <span className="text-zinc-500">?</span>
                        ) : c.botPresent ? (
                          <span className="text-emerald-400">Installed</span>
                        ) : (
                          <span className="text-zinc-500">Removed</span>
                        )}
                      </td>
                      <td className="py-2 pr-4 text-right tabular-nums">{c.raffles}</td>
                      <td className="py-2 pr-4 text-right tabular-nums">{c.entries}</td>
                      <td className="py-2 text-xs text-zinc-500">{c.lastRaffleAt ? formatDate(c.lastRaffleAt) : "—"}</td>
                    </tr>
                  ))}
              </tbody>
            </table>
          )}

          {tab === "users" && (
            <table className="w-full text-left text-sm">
              <thead className="text-xs uppercase text-zinc-500">
                <tr>
                  <th className="py-2 pr-4">User</th>
                  <th className="py-2 pr-4 text-right">Raffles created</th>
                  <th className="py-2 pr-4">First login</th>
                  <th className="py-2">Last login</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-zinc-800">
                {stats.users
                  .filter((u) => has(u.username, u.id))
                  .map((u) => (
                    <tr key={u.id}>
                      <td className="py-2 pr-4">
                        <div className="flex items-center gap-2">
                          <img src={userAvatar(u)} className="h-7 w-7 rounded-full" alt="" />
                          <div>
                            <div>{u.username}</div>
                            <div className="text-xs text-zinc-500">{u.id}</div>
                          </div>
                        </div>
                      </td>
                      <td className="py-2 pr-4 text-right tabular-nums">{u.rafflesCreated}</td>
                      <td className="py-2 pr-4 text-xs text-zinc-500">{formatDate(u.firstLoginAt)}</td>
                      <td className="py-2 text-xs text-zinc-500">{u.lastLoginAt ? formatDate(u.lastLoginAt) : "—"}</td>
                    </tr>
                  ))}
              </tbody>
            </table>
          )}

          {tab === "raffles" && (
            <table className="w-full text-left text-sm">
              <thead className="text-xs uppercase text-zinc-500">
                <tr>
                  <th className="py-2 pr-4">Raffle</th>
                  <th className="py-2 pr-4">Community</th>
                  <th className="py-2 pr-4">Host</th>
                  <th className="py-2 pr-4">Allocations</th>
                  <th className="py-2 pr-4 text-right">Entries</th>
                  <th className="py-2 pr-4">Status</th>
                  <th className="py-2">Created</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-zinc-800">
                {stats.recentRaffles
                  .filter((r) => has(r.title, r.guildName, r.hostName))
                  .map((r) => (
                    <tr key={r.id}>
                      <td className="py-2 pr-4">
                        <div>{r.title}</div>
                        {r.chain && <div className="text-xs text-zinc-500">{r.chain}</div>}
                      </td>
                      <td className="py-2 pr-4">{r.guildName ?? <span className="text-zinc-500">{r.guildId}</span>}</td>
                      <td className="py-2 pr-4">{r.hostName ?? "—"}</td>
                      <td className="py-2 pr-4">{r.allocations}</td>
                      <td className="py-2 pr-4 text-right tabular-nums">{r.entries}</td>
                      <td className="py-2 pr-4 text-xs">{r.status}</td>
                      <td className="py-2 text-xs text-zinc-500">{formatDate(r.createdAt)}</td>
                    </tr>
                  ))}
              </tbody>
            </table>
          )}
        </div>
      </div>
    </div>
  );
}
