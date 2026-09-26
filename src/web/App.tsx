import { useEffect, useRef, useState, type ReactNode } from "react";
import { Link, NavLink, Navigate, Route, Routes, useLocation, useNavigate, useParams } from "react-router-dom";
import { api, avatarUrl, loginUrl, type Me } from "./api";
import { GuildsPage } from "./pages/Guilds";
import { GuildPage } from "./pages/Guild";
import { CreateRafflePage } from "./pages/CreateRaffle";
import { RafflePage } from "./pages/Raffle";
import { Footer } from "./Credits";
import { AdminPage } from "./pages/Admin";
import { PublicRafflePage } from "./pages/PublicRaffle";
import { RafflesListPage } from "./pages/RafflesList";

// Web bisa dibuka tanpa login: daftar raffle & halaman raffle publik.
// Membuat / mengelola raffle butuh login Discord.
export function App() {
  const { pathname } = useLocation();
  const isAdmin = pathname.replace(/\/$/, "") === "/admin";
  const [me, setMe] = useState<Me | null | undefined>(undefined);

  useEffect(() => {
    if (isAdmin) return; // halaman admin memakai PIN, bukan login Discord
    api<Me>("/me")
      .then(setMe)
      .catch(() => setMe(null));
  }, [isAdmin]);

  if (isAdmin) return <AdminPage />;

  const auth = (el: ReactNode) => <RequireLogin me={me}>{el}</RequireLogin>;
  return (
    <div className="flex min-h-screen flex-col">
      <Header me={me} onLogout={() => setMe(null)} />
      <main className="mx-auto w-full max-w-5xl flex-1 px-4 py-8">
        <Routes>
          <Route path="/" element={<RafflesListPage />} />
          <Route path="/raffle/:id" element={<PublicRafflePage />} />
          <Route path="/manage" element={auth(<GuildsPage />)} />
          <Route path="/server/:guildId" element={auth(<GuildPage />)} />
          <Route path="/server/:guildId/new" element={auth(<CreateRafflePage />)} />
          <Route path="/r/:id" element={auth(<RafflePage />)} />
          {/* Link lama (/g/...) tetap jalan */}
          <Route path="/g/:guildId" element={<OldGuildLink />} />
          <Route path="/g/:guildId/new" element={<OldGuildLink suffix="/new" />} />
          <Route path="*" element={<p className="text-zinc-400">Page not found.</p>} />
        </Routes>
      </main>
      <Footer />
    </div>
  );
}

function Header({ me, onLogout }: { me: Me | null | undefined; onLogout: () => void }) {
  const { pathname } = useLocation();
  const navigate = useNavigate();
  const [open, setOpen] = useState(false);
  const menuRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!open) return;
    const close = (e: MouseEvent) => !menuRef.current?.contains(e.target as Node) && setOpen(false);
    document.addEventListener("mousedown", close);
    return () => document.removeEventListener("mousedown", close);
  }, [open]);

  const logout = async () => {
    await api("/auth/logout", { method: "POST" });
    setOpen(false);
    onLogout();
    // Halaman kelola butuh login; kembali ke daftar raffle
    if (!pathname.startsWith("/raffle/") && pathname !== "/") navigate("/");
  };

  const nav = ({ isActive }: { isActive: boolean }) =>
    `rounded-lg px-3 py-1.5 text-sm ${isActive ? "bg-zinc-800 text-white" : "text-zinc-400 hover:text-zinc-200"}`;
  const avatar = me ? avatarUrl(me) : null;

  return (
    <header className="border-b border-zinc-800 bg-zinc-950/80 backdrop-blur">
      <div className="mx-auto flex max-w-5xl items-center justify-between gap-3 px-4 py-3">
        <div className="flex items-center gap-1 sm:gap-4">
          <Link to="/" className="mr-1 flex items-center gap-2 font-semibold">
            <span className="text-xl">🎟️</span> <span className="hidden sm:inline">SkyBOT Raffle</span>
          </Link>
          <NavLink to="/" end className={nav}>
            Raffles
          </NavLink>
          <NavLink to="/manage" className={({ isActive }) => nav({ isActive: isActive || /^\/(server|r)\//.test(pathname) })}>
            Create Raffle
          </NavLink>
        </div>
        {me === undefined ? (
          <div className="h-8 w-20" />
        ) : me ? (
          <div ref={menuRef} className="relative">
            <button onClick={() => setOpen((o) => !o)} className="flex items-center gap-2 rounded-lg px-2 py-1 text-sm hover:bg-zinc-800">
              {avatar ? (
                <img src={avatar} className="h-7 w-7 rounded-full" alt="" />
              ) : (
                <div className="grid h-7 w-7 place-items-center rounded-full bg-zinc-700 text-xs">{me.username[0]}</div>
              )}
              <span className="hidden text-zinc-300 sm:inline">{me.username}</span>
              <span className="text-xs text-zinc-500">▾</span>
            </button>
            {open && (
              <div className="absolute right-0 z-30 mt-1 w-44 rounded-lg border border-zinc-700 bg-zinc-900 p-1 shadow-xl">
                <Link to="/manage" onClick={() => setOpen(false)} className="block rounded-md px-3 py-2 text-sm hover:bg-zinc-800">
                  My servers
                </Link>
                <button onClick={logout} className="block w-full rounded-md px-3 py-2 text-left text-sm text-red-400 hover:bg-zinc-800">
                  Log out
                </button>
              </div>
            )}
          </div>
        ) : (
          <a href={loginUrl(pathname)} className="btn btn-primary px-4 py-1.5 text-sm">
            Log in
          </a>
        )}
      </div>
    </header>
  );
}

// Halaman kelola: minta login dulu, lalu kembali ke halaman yang sama
function RequireLogin({ me, children }: { me: Me | null | undefined; children: ReactNode }) {
  const { pathname } = useLocation();
  if (me === undefined) return <div className="py-10 text-center text-zinc-500">Loading...</div>;
  if (me) return <>{children}</>;
  return (
    <div className="card mx-auto mt-6 max-w-md space-y-4 text-center">
      <div className="text-4xl">🎟️</div>
      <h1 className="text-xl font-semibold">Log in to create raffles</h1>
      <p className="text-sm text-zinc-400">
        Log in with Discord to create and manage raffles for servers where you're an admin or have a raffle manager role.
      </p>
      <a href={loginUrl(pathname)} className="btn btn-primary w-full py-3">
        Log in with Discord
      </a>
    </div>
  );
}

function OldGuildLink({ suffix = "" }: { suffix?: string }) {
  const { guildId } = useParams();
  return <Navigate to={`/server/${guildId}${suffix}`} replace />;
}
