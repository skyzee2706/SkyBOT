import { useEffect, useState } from "react";
import { Link, Route, Routes } from "react-router-dom";
import { api, avatarUrl, type Me } from "./api";
import { GuildsPage } from "./pages/Guilds";
import { GuildPage } from "./pages/Guild";
import { CreateRafflePage } from "./pages/CreateRaffle";
import { RafflePage } from "./pages/Raffle";

export function App() {
  const [me, setMe] = useState<Me | null | undefined>(undefined);

  useEffect(() => {
    api<Me>("/me")
      .then(setMe)
      .catch(() => setMe(null));
  }, []);

  const logout = async () => {
    await api("/auth/logout", { method: "POST" });
    setMe(null);
  };

  if (me === undefined) return <div className="p-10 text-center text-zinc-500">Loading...</div>;
  if (me === null) return <Landing />;

  const avatar = avatarUrl(me);
  return (
    <div className="min-h-screen">
      <header className="border-b border-zinc-800 bg-zinc-950/80 backdrop-blur">
        <div className="mx-auto flex max-w-5xl items-center justify-between px-4 py-3">
          <Link to="/" className="flex items-center gap-2 font-semibold">
            <span className="text-xl">🎟️</span> Raffle Bot
          </Link>
          <div className="flex items-center gap-3 text-sm">
            {avatar && <img src={avatar} className="h-7 w-7 rounded-full" alt="" />}
            <span className="hidden sm:inline text-zinc-300">{me.username}</span>
            <button onClick={logout} className="text-zinc-400 hover:text-zinc-200">
              Log out
            </button>
          </div>
        </div>
      </header>
      <main className="mx-auto max-w-5xl px-4 py-8">
        <Routes>
          <Route path="/" element={<GuildsPage />} />
          <Route path="/g/:guildId" element={<GuildPage />} />
          <Route path="/g/:guildId/new" element={<CreateRafflePage />} />
          <Route path="/r/:id" element={<RafflePage />} />
          <Route path="*" element={<p className="text-zinc-400">Page not found.</p>} />
        </Routes>
      </main>
    </div>
  );
}

function Landing() {
  return (
    <div className="flex min-h-screen flex-col items-center justify-center px-4 text-center">
      <div className="mb-4 text-6xl">🎟️</div>
      <h1 className="mb-3 text-4xl font-bold tracking-tight">Raffle Bot</h1>
      <p className="mb-8 max-w-md text-zinc-400">
        Create raffles on the web, post giveaways to Discord automatically, check entry requirements and draw winners
        fairly.
      </p>
      <a href="/api/auth/login" className="btn btn-primary px-6 py-3 text-base">
        Log in with Discord
      </a>
    </div>
  );
}
