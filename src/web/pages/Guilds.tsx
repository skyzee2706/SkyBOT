import { useEffect, useState } from "react";
import { Link } from "react-router-dom";
import { api, guildIcon, type GuildSummary } from "../api";
import { ErrorBox, Loading } from "../components";

export function GuildsPage() {
  const [guilds, setGuilds] = useState<GuildSummary[] | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    api<GuildSummary[]>("/guilds").then(setGuilds).catch((e) => setError(e.message));
  }, []);

  return (
    <div>
      <h1 className="mb-1 text-2xl font-bold">Select a Server</h1>
      <p className="mb-6 text-sm text-zinc-400">Servers where you're an admin (Manage Server) or have a raffle manager role.</p>
      <ErrorBox error={error} />
      {!guilds && !error && <Loading />}
      {guilds?.length === 0 && <p className="text-zinc-400">You don't manage any servers yet.</p>}
      <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
        {guilds?.map((g) => {
          const icon = guildIcon(g);
          const inner = (
            <>
              {icon ? (
                <img src={icon} className="h-12 w-12 rounded-xl" alt="" />
              ) : (
                <div className="flex h-12 w-12 items-center justify-center rounded-xl bg-zinc-800 font-semibold">
                  {g.name.slice(0, 2)}
                </div>
              )}
              <div className="min-w-0 flex-1">
                <div className="truncate font-medium">{g.name}</div>
                <div className={`text-xs ${g.botPresent ? "text-emerald-400" : "text-zinc-500"}`}>
                  {g.botPresent ? "Bot active · manage raffles" : "Bot not added · click to invite"}
                </div>
              </div>
            </>
          );
          const cls = "card flex items-center gap-3 transition hover:border-zinc-600";
          return g.botPresent ? (
            <Link key={g.id} to={`/server/${g.id}`} className={cls}>
              {inner}
            </Link>
          ) : (
            <a key={g.id} href={g.inviteUrl} target="_blank" rel="noreferrer" className={`${cls} opacity-70`}>
              {inner}
            </a>
          );
        })}
      </div>
      {guilds?.some((g) => !g.botPresent) && (
        <p className="mt-6 text-xs text-zinc-500">After inviting the bot, refresh this page (the list is cached for about 1 minute).</p>
      )}
    </div>
  );
}
