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
import { LandingPage } from "./pages/Landing";
import { MyEntriesPage } from "./pages/MyEntries";
import { ChevronDown } from "lucide-react";
import { LogoMark } from "./Logo";

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

  const auth = (el: ReactNode, kind: LoginKind = "create") => (
    <RequireLogin me={me} kind={kind}>
      {el}
    </RequireLogin>
  );
  return (
    <div className="flex min-h-screen flex-col">
      <Header me={me} onLogout={() => setMe(null)} />
      <main className="mx-auto w-full max-w-5xl flex-1 px-4 py-8">
        <Routes>
          <Route path="/" element={<LandingPage />} />
          <Route path="/raffles" element={<RafflesListPage />} />
          <Route path="/entries" element={auth(<MyEntriesPage />, "entries")} />
          <Route path="/raffle/:id" element={<PublicRafflePage />} />
          <Route path="/create" element={auth(<GuildsPage />)} />
          {/* Link lama /manage tetap jalan */}
          <Route path="/manage" element={<Navigate to="/create" replace />} />
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
    if (!pathname.startsWith("/raffle") && pathname !== "/") navigate("/");
  };

  const nav = ({ isActive }: { isActive: boolean }) =>
    `rounded-lg px-3 py-1.5 text-sm ${isActive ? "bg-brand-500/15 text-brand-200 ring-1 ring-brand-500/30" : "text-zinc-400 hover:text-zinc-200"}`;
  const avatar = me ? avatarUrl(me) : null;

  return (
    <header className="border-b border-brand-500/20 bg-zinc-950/80 backdrop-blur">
      <div className="mx-auto flex max-w-5xl items-center justify-between gap-3 px-4 py-3">
        <div className="flex items-center gap-1 sm:gap-4">
          <Link to="/" className="mr-1 flex items-center gap-2 font-semibold">
            <LogoMark /> <span className="hidden text-brand-50 sm:inline">SkyBOT <span className="text-brand-400">Raffle</span></span>
          </Link>
          <NavLink to="/raffles" className={({ isActive }) => nav({ isActive: isActive || pathname.startsWith("/raffle/") })}>
            Raffles
          </NavLink>
          {/* Di layar kecil "My Entries" ada di menu akun */}
          <NavLink to="/entries" className={(s) => `${nav(s)} hidden sm:inline`}>
            My Entries
          </NavLink>
          <NavLink to="/create" className={({ isActive }) => nav({ isActive: isActive || /^\/(server|r)\//.test(pathname) })}>
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
              <ChevronDown className="h-4 w-4 text-zinc-500" />
            </button>
            {open && (
              <div className="absolute right-0 z-30 mt-1 w-44 rounded-lg border border-zinc-700 bg-zinc-900 p-1 shadow-xl">
                <Link to="/entries" onClick={() => setOpen(false)} className="block rounded-md px-3 py-2 text-sm hover:bg-zinc-800">
                  My entries
                </Link>
                <Link to="/create" onClick={() => setOpen(false)} className="block rounded-md px-3 py-2 text-sm hover:bg-zinc-800">
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
type LoginKind = "create" | "entries";
const LOGIN_COPY: Record<LoginKind, { title: string; text: string }> = {
  create: {
    title: "Log in to create raffles",
    text: "Log in with Discord to create and manage raffles for servers where you're an admin or have a raffle manager role.",
  },
  entries: {
    title: "Log in to see your entries",
    text: "Log in with Discord to track every raffle you've entered and see which allowlist spots you've won.",
  },
};

function RequireLogin({ me, kind, children }: { me: Me | null | undefined; kind: LoginKind; children: ReactNode }) {
  const { pathname } = useLocation();
  if (me === undefined) return <div className="py-10 text-center text-zinc-500">Loading...</div>;
  if (me) return <>{children}</>;
  return (
    <div className="card mx-auto mt-6 max-w-md space-y-4 text-center">
      <LogoMark className="mx-auto h-12 w-12" />
      <h1 className="text-xl font-semibold">{LOGIN_COPY[kind].title}</h1>
      <p className="text-sm text-zinc-400">{LOGIN_COPY[kind].text}</p>
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
